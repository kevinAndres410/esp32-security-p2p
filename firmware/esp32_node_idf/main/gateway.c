#include "gateway.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
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
#include "ble_discovery.h"

static const char *TAG = "gateway";
static EventGroupHandle_t wifi_events;
#define WIFI_CONNECTED_BIT BIT0
#define MAX_GATEWAY_PEERS 7
static uint32_t gateway_sequence;
static node_peer_config_t runtime_peers[MAX_GATEWAY_PEERS];
static char runtime_ids[MAX_GATEWAY_PEERS][24];
static char active_keys[MAX_GATEWAY_PEERS][65];
static char pending_keys[MAX_GATEWAY_PEERS][65];
static bool key_rotation_pending[MAX_GATEWAY_PEERS];
static TickType_t discovery_last_report[MAX_GATEWAY_PEERS];
static size_t runtime_peer_count;
static uint32_t applied_config_version;
static bool dynamic_active;
static uint8_t applied_snapshot_digest[32];

static bool persist_dynamic_snapshot(void);

static size_t peer_index(const node_peer_config_t *peer) { return (size_t)(peer - runtime_peers); }
static const char *peer_key(const node_peer_config_t *peer) { return active_keys[peer_index(peer)]; }

static void initialize_static_peers(void) {
    runtime_peer_count = GATEWAY_PEER_COUNT <= MAX_GATEWAY_PEERS ? GATEWAY_PEER_COUNT : 0;
    for (size_t i = 0; i < runtime_peer_count; ++i) {
        runtime_peers[i] = GATEWAY_PEERS[i];
        strncpy(runtime_ids[i], GATEWAY_PEERS[i].device_id, sizeof(runtime_ids[i]) - 1);
        runtime_ids[i][sizeof(runtime_ids[i]) - 1] = '\0';
        runtime_peers[i].device_id = runtime_ids[i];
        runtime_peers[i].hmac_key_hex = active_keys[i];
    }
}

static void load_gateway_keys(void) {
    nvs_handle_t nvs;
    if (nvs_open("gateway_keys", NVS_READWRITE, &nvs) != ESP_OK) return;
    bool changed = false;
    for (size_t i = 0; i < runtime_peer_count; ++i) {
        const node_peer_config_t *peer = &runtime_peers[i];
        if (!peer->provisioned) continue;
        strncpy(active_keys[i], GATEWAY_PEERS[i].hmac_key_hex, 64);
        active_keys[i][64] = '\0';
        char key_name[16], mac_name[16];
        snprintf(key_name, sizeof(key_name), "key_%u", (unsigned)i);
        snprintf(mac_name, sizeof(mac_name), "mac_%u", (unsigned)i);
        uint8_t stored_mac[6];
        size_t mac_length = sizeof(stored_mac);
        bool has_mac = nvs_get_blob(nvs, mac_name, stored_mac, &mac_length) == ESP_OK &&
                       mac_length == sizeof(stored_mac);
        bool replaced = has_mac && memcmp(stored_mac, peer->mac, sizeof(stored_mac)) != 0;
        if (!replaced && (has_mac || !peer->reset_legacy_key)) {
            size_t key_length = sizeof(active_keys[i]);
            (void)nvs_get_str(nvs, key_name, active_keys[i], &key_length);
        } else {
            (void)nvs_set_str(nvs, key_name, active_keys[i]);
            changed = true;
            ESP_LOGI(TAG, "Provisioning key for replacement %s", peer->device_id);
        }
        if (!has_mac || replaced) {
            (void)nvs_set_blob(nvs, mac_name, peer->mac, sizeof(peer->mac));
            changed = true;
        }
    }
    if (changed) (void)nvs_commit(nvs);
    nvs_close(nvs);
}

static void save_gateway_key(size_t index) {
    if (dynamic_active) {
        if (!persist_dynamic_snapshot()) ESP_LOGE(TAG, "No se pudo conservar la clave rotada");
        return;
    }
    nvs_handle_t nvs; char name[16];
    if (nvs_open("gateway_keys", NVS_READWRITE, &nvs) != ESP_OK) return;
    snprintf(name, sizeof(name), "key_%u", (unsigned)index);
    (void)nvs_set_str(nvs, name, active_keys[index]);
    (void)nvs_commit(nvs);
    nvs_close(nvs);
}

static const node_peer_config_t *find_peer(const char *device_id, const uint8_t mac[6]) {
    if (strnlen(device_id, sizeof(((protocol_frame_t *)0)->device_id)) == sizeof(((protocol_frame_t *)0)->device_id)) return NULL;
    for (size_t i = 0; i < runtime_peer_count; ++i) {
        const node_peer_config_t *peer = &runtime_peers[i];
        if (!peer->provisioned) continue;
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
        uint8_t primary_channel = 0;
        wifi_second_chan_t secondary_channel = WIFI_SECOND_CHAN_NONE;
        (void)esp_wifi_get_channel(&primary_channel, &secondary_channel);
        ESP_LOGI(TAG, "Gateway Wi-Fi connected; IP=" IPSTR ", channel=%u",
                 IP2STR(&event->ip_info.ip), primary_channel);
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

typedef struct { char *body; size_t capacity; size_t length; } http_response_t;

static esp_err_t http_event_handler(esp_http_client_event_t *event) {
    http_response_t *response = event->user_data;
    if (event->event_id == HTTP_EVENT_ON_DATA && response && event->data_len > 0) {
        size_t writable = response->capacity > response->length + 1
            ? response->capacity - response->length - 1 : 0;
        size_t copy = event->data_len < (int)writable ? (size_t)event->data_len : writable;
        if (copy) {
            memcpy(response->body + response->length, event->data, copy);
            response->length += copy;
            response->body[response->length] = '\0';
        }
    }
    return ESP_OK;
}

static int hex_digit(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

static bool decode_hex(const char *source, uint8_t *output, size_t count) {
    if (!source || strlen(source) != count * 2) return false;
    for (size_t i = 0; i < count; ++i) {
        int high = hex_digit(source[i * 2]), low = hex_digit(source[i * 2 + 1]);
        if (high < 0 || low < 0) return false;
        output[i] = (uint8_t)((high << 4) | low);
    }
    return true;
}

static bool save_snapshot_json(const char *snapshot) {
    nvs_handle_t nvs;
    if (nvs_open("gw_registry", NVS_READWRITE, &nvs) != ESP_OK) return false;
    esp_err_t result = nvs_set_str(nvs, "snapshot", snapshot);
    if (result == ESP_OK) result = nvs_commit(nvs);
    nvs_close(nvs);
    return result == ESP_OK;
}

static bool persist_dynamic_snapshot(void) {
    cJSON *root = cJSON_CreateObject();
    cJSON *peers = cJSON_AddArrayToObject(root, "peers");
    cJSON_AddNumberToObject(root, "version", applied_config_version);
    for (size_t i = 0; i < runtime_peer_count; ++i) {
        const node_peer_config_t *peer = &runtime_peers[i];
        char mac[18], lmk[33];
        static const char hex[] = "0123456789abcdef";
        snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X",
            peer->mac[0], peer->mac[1], peer->mac[2], peer->mac[3], peer->mac[4], peer->mac[5]);
        for (size_t j = 0; j < 16; ++j) {
            lmk[j * 2] = hex[peer->lmk[j] >> 4];
            lmk[j * 2 + 1] = hex[peer->lmk[j] & 15];
        }
        lmk[32] = '\0';
        cJSON *entry = cJSON_CreateObject();
        cJSON_AddStringToObject(entry, "deviceId", peer->device_id);
        cJSON_AddStringToObject(entry, "mac", mac);
        cJSON_AddStringToObject(entry, "key", active_keys[i]);
        cJSON_AddStringToObject(entry, "lmk", lmk);
        cJSON_AddItemToArray(peers, entry);
    }
    char *snapshot = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!snapshot) return false;
    bool saved = save_snapshot_json(snapshot);
    if (saved) (void)crypto_hmac_sha256(GATEWAY_CONTROL_KEY_HEX,
        (const uint8_t *)snapshot, strlen(snapshot), applied_snapshot_digest);
    cJSON_free(snapshot);
    return saved;
}

static bool apply_snapshot(const char *snapshot, bool persist) {
    cJSON *root = cJSON_Parse(snapshot);
    cJSON *version = root ? cJSON_GetObjectItemCaseSensitive(root, "version") : NULL;
    cJSON *entries = root ? cJSON_GetObjectItemCaseSensitive(root, "peers") : NULL;
    if (!cJSON_IsNumber(version) || version->valuedouble < 1 ||
        version->valuedouble > UINT32_MAX || !cJSON_IsArray(entries) ||
        cJSON_GetArraySize(entries) > MAX_GATEWAY_PEERS) { cJSON_Delete(root); return false; }
    size_t count = (size_t)cJSON_GetArraySize(entries);
    node_peer_config_t proposed[MAX_GATEWAY_PEERS] = {0};
    char ids[MAX_GATEWAY_PEERS][24] = {{0}}, keys[MAX_GATEWAY_PEERS][65] = {{0}};
    bool valid = true;
    for (size_t i = 0; i < count && valid; ++i) {
        cJSON *entry = cJSON_GetArrayItem(entries, (int)i);
        cJSON *id = cJSON_GetObjectItemCaseSensitive(entry, "deviceId");
        cJSON *mac = cJSON_GetObjectItemCaseSensitive(entry, "mac");
        cJSON *key = cJSON_GetObjectItemCaseSensitive(entry, "key");
        cJSON *lmk = cJSON_GetObjectItemCaseSensitive(entry, "lmk");
        cJSON *previous_key = cJSON_GetObjectItemCaseSensitive(entry, "previousKey");
        if (!cJSON_IsString(id) || !cJSON_IsString(mac) || !cJSON_IsString(key) ||
            !cJSON_IsString(lmk) || !id->valuestring[0] || strlen(id->valuestring) >= sizeof(ids[i]) ||
            strlen(key->valuestring) != 64 || strlen(mac->valuestring) != 17 ||
            (previous_key && (!cJSON_IsString(previous_key) ||
                strlen(previous_key->valuestring) != 64))) { valid = false; break; }
        for (size_t j = 0; j < 64; ++j) if (hex_digit(key->valuestring[j]) < 0) valid = false;
        if (previous_key) for (size_t j = 0; j < 64; ++j)
            if (hex_digit(previous_key->valuestring[j]) < 0) valid = false;
        for (size_t j = 0; j < i; ++j)
            if (strcmp(ids[j], id->valuestring) == 0) valid = false;
        if (!valid) break;
        for (size_t j = 0; j < 6; ++j) {
            int high = hex_digit(mac->valuestring[j * 3]);
            int low = hex_digit(mac->valuestring[j * 3 + 1]);
            if (high < 0 || low < 0 || (j < 5 && mac->valuestring[j * 3 + 2] != ':')) {
                valid = false;
                break;
            }
            proposed[i].mac[j] = (uint8_t)((high << 4) | low);
        }
        valid = valid && decode_hex(lmk->valuestring, proposed[i].lmk, 16);
        for (size_t j = 0; j < i; ++j)
            if (memcmp(proposed[j].mac, proposed[i].mac, 6) == 0) valid = false;
        if (!valid) break;
        strcpy(ids[i], id->valuestring);
        strcpy(keys[i], key->valuestring);
        if (previous_key) {
            for (size_t j = 0; j < runtime_peer_count; ++j) {
                if (strcmp(runtime_peers[j].device_id, ids[i]) == 0 &&
                    memcmp(runtime_peers[j].mac, proposed[i].mac, 6) == 0) {
                    if (strcmp(active_keys[j], key->valuestring) != 0 &&
                        strcmp(active_keys[j], previous_key->valuestring) != 0) {
                        valid = false;
                    } else {
                        strcpy(keys[i], active_keys[j]);
                    }
                    break;
                }
            }
        }
        if (!valid) break;
        proposed[i].device_id = ids[i];
        proposed[i].hmac_key_hex = keys[i];
        proposed[i].provisioned = true;
    }
    if (!valid) { cJSON_Delete(root); return false; }
    if (!espnow_transport_replace_peers(runtime_peers, runtime_peer_count, proposed, count)) {
        cJSON_Delete(root); return false;
    }
    if (persist && !save_snapshot_json(snapshot)) {
        (void)espnow_transport_replace_peers(proposed, count, runtime_peers, runtime_peer_count);
        cJSON_Delete(root); return false;
    }
    for (size_t i = 0; i < count; ++i) {
        strcpy(runtime_ids[i], ids[i]);
        strcpy(active_keys[i], keys[i]);
        runtime_peers[i] = proposed[i];
        runtime_peers[i].device_id = runtime_ids[i];
        runtime_peers[i].hmac_key_hex = active_keys[i];
    }
    runtime_peer_count = count;
    applied_config_version = (uint32_t)version->valuedouble;
    dynamic_active = true;
    (void)crypto_hmac_sha256(GATEWAY_CONTROL_KEY_HEX,
        (const uint8_t *)snapshot, strlen(snapshot), applied_snapshot_digest);
    memset(key_rotation_pending, 0, sizeof(key_rotation_pending));
    memset(discovery_last_report, 0, sizeof(discovery_last_report));
    cJSON_Delete(root);
    ESP_LOGI(TAG, "Configuración v%" PRIu32 " aplicada con %u nodos",
        applied_config_version, (unsigned)count);
    return true;
}

static void load_cached_snapshot(void) {
    if (!GATEWAY_CONTROL_KEY_HEX || strlen(GATEWAY_CONTROL_KEY_HEX) != 64) return;
    nvs_handle_t nvs;
    if (nvs_open("gw_registry", NVS_READONLY, &nvs) != ESP_OK) return;
    size_t length = 0;
    if (nvs_get_str(nvs, "snapshot", NULL, &length) == ESP_OK && length > 0 && length <= 4096) {
        char *snapshot = malloc(length);
        if (snapshot) {
            if (nvs_get_str(nvs, "snapshot", snapshot, &length) == ESP_OK &&
                !apply_snapshot(snapshot, false)) ESP_LOGW(TAG, "Configuración guardada inválida");
            free(snapshot);
        }
    }
    nvs_close(nvs);
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

    char response_body[1024] = {0};
    http_response_t response = { .body = response_body, .capacity = sizeof(response_body) };
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
    if (result == ESP_OK && status >= 200 && status < 300) {
        process_commands(peer, response.body);
        if (frame->type == PROTOCOL_HEARTBEAT) {
            char acknowledgment[24];
            snprintf(acknowledgment, sizeof(acknowledgment), "perf:%" PRIu32, frame->sequence);
            (void)send_to_node(peer, PROTOCOL_ACK, acknowledgment);
        }
    } else {
        ESP_LOGW(TAG, "Upstream sync failed: %s, HTTP %d", esp_err_to_name(result), status);
    }
}

/* Only a frame authenticated with the kit's existing ESP-NOW key reaches this
 * function. The backend also checks its factory inventory before exposing it
 * as a candidate; arbitrary Wi-Fi devices are never offered to users. */
static void report_candidate(const node_peer_config_t *peer, const char *transport, uint32_t nonce) {
    size_t index = peer_index(peer);
    TickType_t now = xTaskGetTickCount();
    if (discovery_last_report[index] && now - discovery_last_report[index] < pdMS_TO_TICKS(15000)) return;
    discovery_last_report[index] = now;
    char mac[18];
    snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X",
             peer->mac[0], peer->mac[1], peer->mac[2], peer->mac[3], peer->mac[4], peer->mac[5]);
    char signed_value[128];
    snprintf(signed_value, sizeof(signed_value), "%s:%s:%s:%" PRIu32,
             peer->device_id, mac, transport, nonce);
    char signature[65];
    if (!crypto_hmac_hex(peer_key(peer), signed_value, signature)) return;
    cJSON *json = cJSON_CreateObject();
    if (!json) return;
    cJSON_AddStringToObject(json, "deviceId", peer->device_id);
    cJSON_AddStringToObject(json, "macAddress", mac);
    cJSON_AddStringToObject(json, "transport", transport);
    cJSON_AddNumberToObject(json, "nonce", nonce);
    char *body = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (!body) return;
    char url[256];
    const char *suffix = strstr(UPSTREAM_URL, "/api/gateway/sync");
    if (!suffix || (size_t)(suffix - UPSTREAM_URL) + sizeof("/api/kits/discovery") >= sizeof(url)) {
        cJSON_free(body); return;
    }
    size_t prefix = (size_t)(suffix - UPSTREAM_URL);
    memcpy(url, UPSTREAM_URL, prefix);
    strcpy(url + prefix, "/api/kits/discovery");
    esp_http_client_config_t config = { .url = url, .method = HTTP_METHOD_POST,
                                        .crt_bundle_attach = esp_crt_bundle_attach,
                                        .timeout_ms = 1000 };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client) {
        esp_http_client_set_header(client, "Content-Type", "application/json");
        esp_http_client_set_header(client, "x-kit-signature", signature);
        esp_http_client_set_post_field(client, body, strlen(body));
        esp_err_t result = esp_http_client_perform(client);
        int status = esp_http_client_get_status_code(client);
        if (result != ESP_OK || status != 200)
            ESP_LOGD(TAG, "Candidate report deferred for %s", peer->device_id);
        esp_http_client_cleanup(client);
    }
    cJSON_free(body);
}

static bool control_url(char url[256], const char *suffix) {
    const char *marker = strstr(UPSTREAM_URL, "/api/gateway/sync");
    if (!marker) return false;
    size_t prefix = (size_t)(marker - UPSTREAM_URL);
    if (prefix + strlen(suffix) + 1 > 256) return false;
    memcpy(url, UPSTREAM_URL, prefix);
    strcpy(url + prefix, suffix);
    return true;
}

static void acknowledge_config(uint32_t version, const char *nonce) {
    char url[256], signed_value[128], signature[65], body[48];
    if (!control_url(url, "/api/gateway/config/ack")) return;
    snprintf(signed_value, sizeof(signed_value), "ack:%s:%" PRIu32 ":%s", DEVICE_ID, version, nonce);
    if (!crypto_hmac_hex(GATEWAY_CONTROL_KEY_HEX, signed_value, signature)) return;
    snprintf(body, sizeof(body), "{\"version\":%" PRIu32 "}", version);
    esp_http_client_config_t config = { .url = url, .method = HTTP_METHOD_POST,
        .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = 3000 };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return;
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "x-gateway-id", DEVICE_ID);
    esp_http_client_set_header(client, "x-gateway-nonce", nonce);
    esp_http_client_set_header(client, "x-gateway-signature", signature);
    esp_http_client_set_post_field(client, body, strlen(body));
    esp_err_t result = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    if (result != ESP_OK || status != 200)
        ESP_LOGW(TAG, "Confirmación de configuración aplazada: HTTP %d", status);
}

static void poll_config(void) {
    char url[256], nonce[33], signed_value[128], signature[65];
    if (!control_url(url, "/api/gateway/config")) return;
    snprintf(nonce, sizeof(nonce), "%08" PRIx32 "%08" PRIx32 "%08" PRIx32 "%08" PRIx32,
        esp_random(), esp_random(), esp_random(), esp_random());
    snprintf(signed_value, sizeof(signed_value), "config:%s:%s", DEVICE_ID, nonce);
    if (!crypto_hmac_hex(GATEWAY_CONTROL_KEY_HEX, signed_value, signature)) return;
    char *body = calloc(1, 8192);
    if (!body) return;
    http_response_t response = { .body = body, .capacity = 8192 };
    esp_http_client_config_t config = { .url = url, .method = HTTP_METHOD_GET,
        .event_handler = http_event_handler, .user_data = &response,
        .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = 3000 };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) { free(body); return; }
    esp_http_client_set_header(client, "x-gateway-id", DEVICE_ID);
    esp_http_client_set_header(client, "x-gateway-nonce", nonce);
    esp_http_client_set_header(client, "x-gateway-signature", signature);
    esp_err_t result = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    if (result != ESP_OK || status != 200) { free(body); return; }
    cJSON *outer = cJSON_Parse(body);
    cJSON *version = outer ? cJSON_GetObjectItemCaseSensitive(outer, "version") : NULL;
    cJSON *iv_hex = outer ? cJSON_GetObjectItemCaseSensitive(outer, "iv") : NULL;
    cJSON *tag_hex = outer ? cJSON_GetObjectItemCaseSensitive(outer, "tag") : NULL;
    cJSON *cipher_hex = outer ? cJSON_GetObjectItemCaseSensitive(outer, "ciphertext") : NULL;
    bool valid = cJSON_IsNumber(version) && version->valuedouble >= 1 &&
        version->valuedouble <= UINT32_MAX && cJSON_IsString(iv_hex) &&
        cJSON_IsString(tag_hex) && cJSON_IsString(cipher_hex);
    size_t cipher_length = valid ? strlen(cipher_hex->valuestring) / 2 : 0;
    uint8_t iv[12], tag[16];
    valid = valid && cipher_length > 0 && cipher_length <= 4096 &&
        strlen(cipher_hex->valuestring) == cipher_length * 2 &&
        decode_hex(iv_hex->valuestring, iv, sizeof(iv)) &&
        decode_hex(tag_hex->valuestring, tag, sizeof(tag));
    uint8_t *ciphertext = valid ? malloc(cipher_length) : NULL;
    uint8_t *plaintext = valid ? malloc(cipher_length + 1) : NULL;
    if (valid && ciphertext && plaintext) {
        char aad[128];
        snprintf(aad, sizeof(aad), "%s:%s:%" PRIu32,
            DEVICE_ID, nonce, (uint32_t)version->valuedouble);
        valid = decode_hex(cipher_hex->valuestring, ciphertext, cipher_length) &&
            crypto_aes256_gcm_decrypt_buffer(GATEWAY_CONTROL_KEY_HEX, iv,
                (const uint8_t *)aad, strlen(aad), ciphertext, cipher_length, tag,
                plaintext, cipher_length);
        if (valid) {
            plaintext[cipher_length] = '\0';
            uint32_t desired_version = (uint32_t)version->valuedouble;
            cJSON *inner = cJSON_Parse((const char *)plaintext);
            cJSON *inner_version = inner ? cJSON_GetObjectItemCaseSensitive(inner, "version") : NULL;
            bool matching = cJSON_IsNumber(inner_version) &&
                inner_version->valuedouble == (double)desired_version;
            cJSON_Delete(inner);
            uint8_t desired_digest[32];
            bool unchanged = matching && dynamic_active && desired_version == applied_config_version &&
                crypto_hmac_sha256(GATEWAY_CONTROL_KEY_HEX, plaintext, cipher_length, desired_digest) &&
                crypto_constant_time_equal(desired_digest, applied_snapshot_digest, sizeof(desired_digest));
            if (matching && (unchanged || apply_snapshot((const char *)plaintext, true)))
                acknowledge_config(desired_version, nonce);
        }
    }
    free(ciphertext);
    free(plaintext);
    cJSON_Delete(outer);
    free(body);
}

void gateway_run(void) {
    gateway_sequence = esp_random();
    if (GATEWAY_PEER_COUNT > MAX_GATEWAY_PEERS) { ESP_LOGE(TAG, "Too many configured peers"); return; }
    initialize_static_peers();
    load_gateway_keys();
    load_cached_snapshot();
    if (!connect_wifi()) ESP_LOGW(TAG, "Wi-Fi unavailable; receiving ESP-NOW only");
    TickType_t last_config_poll = 0;
    while (true) {
        TickType_t now = xTaskGetTickCount();
        if (GATEWAY_CONTROL_KEY_HEX && strlen(GATEWAY_CONTROL_KEY_HEX) == 64 &&
            wifi_events && (xEventGroupGetBits(wifi_events) & WIFI_CONNECTED_BIT) &&
            (!last_config_poll || now - last_config_poll >= pdMS_TO_TICKS(10000))) {
            last_config_poll = now;
            poll_config();
        }
        uint8_t ble_mac[6];
        while (ble_discovery_receive(ble_mac)) {
            for (size_t i = 0; i < runtime_peer_count; ++i) {
                if (runtime_peers[i].provisioned && memcmp(runtime_peers[i].mac, ble_mac, 6) == 0)
                    report_candidate(&runtime_peers[i], "ble", esp_random());
            }
        }
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
        if (!protocol_decrypt_payload((protocol_frame_t *)frame, peer_key(peer))) continue;
        report_candidate(peer, "wifi", frame->sequence);
        forward_to_server(peer, frame);
    }
}
