#include "espnow_transport.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_now.h"
#include "esp_wifi.h"
#include "config.h"

static const char *TAG = "espnow";
static QueueHandle_t receive_queue;

static void receive_callback(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
    espnow_received_t received = {0};
    if (!info || !data || len <= 0 || len > (int)sizeof(received.data)) return;
    memcpy(received.source_mac, info->src_addr, sizeof(received.source_mac));
    memcpy(received.data, data, len);
    received.length = (size_t)len;
    (void)xQueueSend(receive_queue, &received, 0);
}

static bool add_peer(const uint8_t mac[6], const uint8_t lmk[16]) {
    if (esp_now_is_peer_exist(mac)) return true;
    esp_now_peer_info_t peer = {0};
    memcpy(peer.peer_addr, mac, ESP_NOW_ETH_ALEN);
    memcpy(peer.lmk, lmk, ESP_NOW_KEY_LEN);
    peer.channel = ESPNOW_CHANNEL;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = true;
    return esp_now_add_peer(&peer) == ESP_OK;
}

bool espnow_transport_init(bool gateway_role) {
    if (esp_netif_init() != ESP_OK || esp_event_loop_create_default() != ESP_OK) return false;
    wifi_init_config_t wifi_cfg = WIFI_INIT_CONFIG_DEFAULT();
    if (esp_wifi_init(&wifi_cfg) != ESP_OK || esp_wifi_set_mode(WIFI_MODE_STA) != ESP_OK || esp_wifi_start() != ESP_OK) return false;
    if (!gateway_role && esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK) return false;
    if (esp_now_init() != ESP_OK || esp_now_set_pmk(ESPNOW_PMK) != ESP_OK) return false;
    receive_queue = xQueueCreate(12, sizeof(espnow_received_t));
    if (!receive_queue || esp_now_register_recv_cb(receive_callback) != ESP_OK) return false;

    if (gateway_role) {
        for (size_t i = 0; i < GATEWAY_PEER_COUNT; ++i)
            if (!add_peer(GATEWAY_PEERS[i].mac, GATEWAY_PEERS[i].lmk)) return false;
    } else if (!add_peer(GATEWAY_MAC, GATEWAY_LMK)) {
        return false;
    }
    ESP_LOGI(TAG, "ESP-NOW ready on channel %u", ESPNOW_CHANNEL);
    return true;
}

bool espnow_transport_send(const uint8_t destination[6], const protocol_frame_t *frame) {
    return destination && frame && esp_now_send(destination, (const uint8_t *)frame, protocol_frame_size(frame)) == ESP_OK;
}

bool espnow_transport_receive(espnow_received_t *received, uint32_t timeout_ms) {
    return received && xQueueReceive(receive_queue, received, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}
