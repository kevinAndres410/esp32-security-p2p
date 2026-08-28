#include "node.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_random.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "config.h"
#include "espnow_transport.h"
#include "protocol.h"

static const char *TAG = "node";
static char active_key[65];
static char previous_key[65];
static uint32_t last_gateway_sequence;

static void load_key(void) {
    nvs_handle_t handle;
    size_t length = sizeof(active_key);
    if (nvs_open("secure_node", NVS_READWRITE, &handle) == ESP_OK &&
        nvs_get_str(handle, "hmac_key", active_key, &length) == ESP_OK) {
        nvs_close(handle);
        return;
    }
    strncpy(active_key, NODE_HMAC_KEY_HEX, sizeof(active_key) - 1);
    active_key[sizeof(active_key) - 1] = '\0';
    if (nvs_open("secure_node", NVS_READWRITE, &handle) == ESP_OK) {
        (void)nvs_set_str(handle, "hmac_key", active_key);
        (void)nvs_commit(handle);
        nvs_close(handle);
    }
}

static void persist_key(const char *key) {
    nvs_handle_t handle;
    if (nvs_open("secure_node", NVS_READWRITE, &handle) != ESP_OK) return;
    (void)nvs_set_str(handle, "hmac_key", key);
    (void)nvs_commit(handle);
    nvs_close(handle);
}

static void send_frame(protocol_type_t type, const uint8_t *payload, size_t payload_len) {
    protocol_frame_t frame;
    if (!protocol_build(&frame, type, esp_random(), DEVICE_ID, payload, payload_len, active_key)) return;
    if (!espnow_transport_send(GATEWAY_MAC, &frame)) ESP_LOGW(TAG, "ESP-NOW send failed");
}

static void handle_gateway_frame(const espnow_received_t *received) {
    if (memcmp(received->source_mac, GATEWAY_MAC, sizeof(GATEWAY_MAC)) != 0) return;
    const protocol_frame_t *frame = (const protocol_frame_t *)received->data;
    if (!protocol_verify(frame, received->length, active_key) &&
        !protocol_verify(frame, received->length, previous_key)) return;
    if (frame->sequence <= last_gateway_sequence) return; /* basic replay protection per boot */
    last_gateway_sequence = frame->sequence;

    if (frame->type == PROTOCOL_KEY_ROTATE && frame->payload_len == 64) {
        char new_key[65] = {0};
        memcpy(new_key, frame->payload, 64);
        memcpy(previous_key, active_key, sizeof(previous_key));
        memcpy(active_key, new_key, sizeof(active_key));
        persist_key(active_key);
        send_frame(PROTOCOL_ACK, (const uint8_t *)"key_rotated", 11);
        ESP_LOGI(TAG, "Key rotated from authenticated gateway command");
    } else if (frame->type == PROTOCOL_COMMAND) {
        /* Device-specific actuators belong here; commands are authenticated first. */
        send_frame(PROTOCOL_ACK, frame->payload, frame->payload_len);
    }
}

void node_run(void) {
    load_key();
    uint32_t elapsed = HEARTBEAT_INTERVAL_MS;
    while (true) {
        espnow_received_t received;
        if (espnow_transport_receive(&received, 250)) handle_gateway_frame(&received);
        elapsed += 250;
        if (elapsed >= HEARTBEAT_INTERVAL_MS) {
            send_frame(PROTOCOL_HEARTBEAT, (const uint8_t *)"online", 6);
            elapsed = 0;
        }
    }
}
