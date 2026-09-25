#include "node.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "config.h"
#include "espnow_transport.h"
#include "protocol.h"

static const char *TAG = "node";
static char active_key[65];
static char previous_key[65];
static uint32_t last_gateway_sequence;
static uint32_t node_sequence;
static uint32_t heartbeat_sequence;
static uint32_t pending_heartbeat_frame;
static int64_t pending_heartbeat_sent_us;
static int last_rtt_ms = -1;
static uint32_t previous_runtime_total;
static uint32_t previous_runtime_idle;

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

static uint32_t send_frame(protocol_type_t type, const uint8_t *payload, size_t payload_len) {
    protocol_frame_t frame;
    uint32_t sequence = ++node_sequence;
    if (!protocol_build(&frame, type, sequence, DEVICE_ID, payload, payload_len, active_key)) return 0;
    if (!espnow_transport_send(GATEWAY_MAC, &frame)) {
        ESP_LOGW(TAG, "ESP-NOW send failed");
        return 0;
    }
    return sequence;
}

static unsigned read_cpu_percentage_x100(void) {
    UBaseType_t capacity = uxTaskGetNumberOfTasks() + 4;
    TaskStatus_t *tasks = pvPortMalloc(capacity * sizeof(*tasks));
    if (!tasks) return 0;

    configRUN_TIME_COUNTER_TYPE ignored_total = 0;
    UBaseType_t count = uxTaskGetSystemState(tasks, capacity, &ignored_total);
    uint32_t runtime_total = 0;
    uint32_t runtime_idle = 0;
    for (UBaseType_t i = 0; i < count; ++i) {
        runtime_total += (uint32_t)tasks[i].ulRunTimeCounter;
        if (strncmp(tasks[i].pcTaskName, "IDLE", 4) == 0) {
            runtime_idle += (uint32_t)tasks[i].ulRunTimeCounter;
        }
    }
    vPortFree(tasks);

    uint32_t delta_total = runtime_total - previous_runtime_total;
    uint32_t delta_idle = runtime_idle - previous_runtime_idle;
    previous_runtime_total = runtime_total;
    previous_runtime_idle = runtime_idle;
    if (!delta_total || delta_idle > delta_total) return 0;
    return (unsigned)(((uint64_t)(delta_total - delta_idle) * 10000U) / delta_total);
}

static void handle_gateway_frame(const espnow_received_t *received) {
    if (memcmp(received->source_mac, GATEWAY_MAC, sizeof(GATEWAY_MAC)) != 0) return;
    const protocol_frame_t *frame = (const protocol_frame_t *)received->data;
    if (!protocol_verify(frame, received->length, active_key) &&
        !protocol_verify(frame, received->length, previous_key)) return;
    const char *verified_key = protocol_verify(frame, received->length, active_key) ? active_key : previous_key;
    if (!protocol_decrypt_payload((protocol_frame_t *)frame, verified_key)) return;
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
    } else if (frame->type == PROTOCOL_ACK && frame->payload_len > 5 && frame->payload_len < 24) {
        char acknowledgment[24] = {0};
        memcpy(acknowledgment, frame->payload, frame->payload_len);
        if (strncmp(acknowledgment, "perf:", 5) == 0 &&
            (uint32_t)strtoul(acknowledgment + 5, NULL, 10) == pending_heartbeat_frame) {
            last_rtt_ms = (int)((esp_timer_get_time() - pending_heartbeat_sent_us) / 1000);
            ESP_LOGI(TAG, "End-to-end RTT: %d ms", last_rtt_ms);
        }
    }
}

void node_run(void) {
    load_key();
    node_sequence = esp_random();
    uint32_t elapsed = HEARTBEAT_INTERVAL_MS;
    while (true) {
        espnow_received_t received;
        if (espnow_transport_receive(&received, 250)) handle_gateway_frame(&received);
        elapsed += 250;
        if (elapsed >= HEARTBEAT_INTERVAL_MS) {
            char telemetry[ESPNOW_MAX_PAYLOAD + 1];
            int length = snprintf(telemetry, sizeof(telemetry),
                                  "{\"hb\":%lu,\"rtt\":%d,\"heap\":%lu,\"minHeap\":%lu,\"cpuX100\":%u,\"uptime\":%lu}",
                                  (unsigned long)++heartbeat_sequence,
                                  last_rtt_ms,
                                  (unsigned long)heap_caps_get_free_size(MALLOC_CAP_8BIT),
                                  (unsigned long)heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT),
                                  read_cpu_percentage_x100(),
                                  (unsigned long)(esp_timer_get_time() / 1000));
            if (length > 0 && length <= ESPNOW_MAX_PAYLOAD) {
                pending_heartbeat_sent_us = esp_timer_get_time();
                pending_heartbeat_frame = send_frame(PROTOCOL_HEARTBEAT,
                                                       (const uint8_t *)telemetry,
                                                       (size_t)length);
            }
            elapsed = 0;
        }
    }
}
