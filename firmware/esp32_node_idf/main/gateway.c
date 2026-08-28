#include "gateway.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "cJSON.h"
#include "config.h"
#include "crypto.h"
#include "espnow_transport.h"
#include "protocol.h"

static const char *TAG = "gateway";
static EventGroupHandle_t wifi_events;
#define WIFI_CONNECTED_BIT BIT0
static uint32_t gateway_sequence;
static char active_keys[16][65];
static char pending_keys[16][65];
static bool key_rotation_pending[16];

static size_t peer_index(const node_peer_config_t *peer) { return (size_t)(peer - GATEWAY_PEERS); }
static const char *peer_key(const node_peer_config_t *peer) { return active_keys[peer_index(peer)]; }

static void load_gateway_keys(void) {
    nvs_handle_t nvs;
    if (nvs_open("gateway_keys", NVS_READWRITE, &nvs) != ESP_OK) return;
    for (size_t i = 0; i < GATEWAY_PEER_COUNT; ++i) {
        strncpy(active_keys[i], GATEWAY_PEERS[i].hmac_key_hex, 64);
        active_keys[i][64] = '\0';
        char name[12]; size_t length = sizeof(active_keys[i]);
        snprintf(name, sizeof(name), "key_%u", (unsigned)i);
        (void)nvs_get_str(nvs, name, active_keys[i], &length);
    }
    nvs_close(nvs);
}

static void save_gateway_key(size_t index) {
    nvs_handle_t nvs; char name[12];
    if (nvs_open("gateway_keys", NVS_READWRITE, &nvs) != ESP_OK) return;
    snprintf(name, sizeof(name), "key_%u", (unsigned)index);
    (void)nvs_set_str(nvs, name, active_keys[index]);
    (void)nvs_commit(nvs);
    nvs_close(nvs);
}

static const node_peer_config_t *find_peer(const char *device_id, const uint8_t mac[6]) {
    if (strnlen(device_id, sizeof(((protocol_frame_t *)0)->device_id)) == sizeof(((protocol_frame_t *)0)->device_id)) return NULL;
    for (size_t i = 0; i < GATEWAY_PEER_COUNT; ++i) {
        const node_peer_config_t *peer = &GATEWAY_PEERS[i];
        if (strcmp(peer->device_id, device_id) == 0 && memcmp(peer->mac, mac, 6) == 0) return peer;
    }
    return NULL;
}

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) esp_wifi_connect();
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(wifi_events, WIFI_CONNECTED_BIT);
        esp_wifi_connect();
    }
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = data;
        ESP_LOGI(TAG, "Gateway Wi-Fi connected; IP=" IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(wifi_events, WIFI_CONNECTED_BIT);
    }
}

static bool connect_wifi(void) {
    wifi_events = xEventGroupCreate();
    if (!wifi_events || esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL) != ESP_OK ||
        esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL) != ESP_OK) return false;
    wifi_config_t config = { .sta = { .threshold.authmode = WIFI_AUTH_WPA2_PSK } };
    strncpy((char *)config.sta.ssid, WIFI_SSID, sizeof(config.sta.ssid) - 1);
    strncpy((char *)config.sta.password, WIFI_PASSWORD, sizeof(config.sta.password) - 1);
    if (esp_wifi_set_config(WIFI_IF_STA, &config) != ESP_OK || esp_wifi_connect() != ESP_OK) return false;
    return (xEventGroupWaitBits(wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE,
                                pdMS_TO_TICKS(30000)) & WIFI_CONNECTED_BIT) != 0;
}

typedef struct { char body[1024]; size_t length; } http_response_t;

static esp_err_t http_event_handler(esp_http_client_event_t *event) {
    http_response_t *response = event->user_data;
    if (event->event_id == HTTP_EVENT_ON_DATA && response && event->data_len > 0) {
        size_t writable = sizeof(response->body) - response->length - 1;
        size_t copy = event->data_len < (int)writable ? (size_t)event->data_len : writable;
        if (copy) {
            memcpy(response->body + response->length, event->data, copy);
            response->length += copy;
            response->body[response->length] = '\0';
        }
    }
    return ESP_OK;
}

static bool send_to_node(const node_peer_config_t *peer, protocol_type_t type, const char *payload) {
    protocol_frame_t outgoing;
    size_t length = strlen(payload);
    if (length > ESPNOW_MAX_PAYLOAD) return false;
    return protocol_build(&outgoing, type, ++gateway_sequence, peer->device_id, (const uint8_t *)payload, length, peer_key(peer)) &&
           espnow_transport_send(peer->mac, &outgoing);
}

static void process_commands(const node_peer_config_t *peer, const char *body) {
    cJSON *json = cJSON_Parse(body);
    cJSON *commands = json ? cJSON_GetObjectItemCaseSensitive(json, "commands") : NULL;
    if (!cJSON_IsArray(commands)) { cJSON_Delete(json); return; }
    cJSON *command;
    cJSON_ArrayForEach(command, commands) {
        cJSON *device_id = cJSON_GetObjectItemCaseSensitive(command, "deviceId");
        cJSON *type = cJSON_GetObjectItemCaseSensitive(command, "type");
        cJSON *payload = cJSON_GetObjectItemCaseSensitive(command, "payload");
        if (!cJSON_IsString(device_id) || !cJSON_IsString(type) || strcmp(device_id->valuestring, peer->device_id) != 0) continue;
        if (strcmp(type->valuestring, "rotate_key") == 0 && cJSON_IsString(payload) && strlen(payload->valuestring) == 64) {
            if (send_to_node(peer, PROTOCOL_KEY_ROTATE, payload->valuestring)) {
                size_t index = peer_index(peer);
                memcpy(pending_keys[index], payload->valuestring, 64);
                pending_keys[index][64] = '\0';
                key_rotation_pending[index] = true;
            }
        } else if (strcmp(type->valuestring, "command") == 0 && cJSON_IsString(payload)) {
            (void)send_to_node(peer, PROTOCOL_COMMAND, payload->valuestring);
        }
    }
    cJSON_Delete(json);
}

static void forward_to_server(const node_peer_config_t *peer, const protocol_frame_t *frame) {
    char payload[ESPNOW_MAX_PAYLOAD + 1] = {0};
    memcpy(payload, frame->payload, frame->payload_len);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "deviceId", peer->device_id);
    cJSON_AddNumberToObject(json, "sequence", frame->sequence);
    cJSON_AddNumberToObject(json, "type", frame->type);
    cJSON_AddStringToObject(json, "payload", payload);
    char *body = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (!body) return;

    char timestamp[16];
    snprintf(timestamp, sizeof(timestamp), "%" PRIu32, (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS));
    char signed_value[64];
    snprintf(signed_value, sizeof(signed_value), "%s:%s", peer->device_id, timestamp);
    char signature[65];
    if (!crypto_hmac_hex(peer_key(peer), signed_value, signature)) { cJSON_free(body); return; }

    http_response_t response = {0};
    esp_http_client_config_t config = { .url = UPSTREAM_URL, .method = HTTP_METHOD_POST,
                                        .event_handler = http_event_handler, .user_data = &response,
                                        .crt_bundle_attach = esp_crt_bundle_attach,
                                        .timeout_ms = 8000 };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) { cJSON_free(body); return; }
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "x-device-id", peer->device_id);
    esp_http_client_set_header(client, "x-node-timestamp", timestamp);
    esp_http_client_set_header(client, "x-node-signature", signature);
    esp_http_client_set_post_field(client, body, strlen(body));
    esp_err_t result = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    cJSON_free(body);
    if (result == ESP_OK && status >= 200 && status < 300) process_commands(peer, response.body);
    else ESP_LOGW(TAG, "Upstream sync failed: %s, HTTP %d", esp_err_to_name(result), status);
}

void gateway_run(void) {
    gateway_sequence = esp_random();
    if (GATEWAY_PEER_COUNT > 16) { ESP_LOGE(TAG, "Too many configured peers"); return; }
    load_gateway_keys();
    if (!connect_wifi()) ESP_LOGW(TAG, "Wi-Fi unavailable; receiving ESP-NOW only");
    while (true) {
        espnow_received_t received;
        if (!espnow_transport_receive(&received, 1000)) continue;
        const protocol_frame_t *frame = (const protocol_frame_t *)received.data;
        if (received.length < offsetof(protocol_frame_t, hmac)) continue;
        const node_peer_config_t *peer = find_peer(frame->device_id, received.source_mac);
        if (!peer) continue;
        size_t index = peer_index(peer);
        if (!protocol_verify(frame, received.length, peer_key(peer))) {
            if (!key_rotation_pending[index] || frame->type != PROTOCOL_ACK ||
                !protocol_verify(frame, received.length, pending_keys[index])) continue;
            memcpy(active_keys[index], pending_keys[index], sizeof(active_keys[index]));
            key_rotation_pending[index] = false;
            save_gateway_key(index);
            ESP_LOGI(TAG, "Key rotation acknowledged by %s", peer->device_id);
        }
        forward_to_server(peer, frame);
    }
}
