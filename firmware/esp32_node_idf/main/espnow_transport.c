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

static uint8_t select_node_channel(void) {
    wifi_scan_config_t scan = {
        .ssid = (uint8_t *)WIFI_SSID,
        .show_hidden = true,
    };
    wifi_ap_record_t access_point = {0};
    uint16_t count = 1;

    if (esp_wifi_scan_start(&scan, true) == ESP_OK &&
        esp_wifi_scan_get_ap_records(&count, &access_point) == ESP_OK && count > 0) {
        ESP_LOGI(TAG, "Detected channel %u for SSID '%s'", access_point.primary, WIFI_SSID);
        return access_point.primary;
    }

    ESP_LOGW(TAG, "SSID '%s' not found; using fallback channel %u", WIFI_SSID, ESPNOW_CHANNEL);
    return ESPNOW_CHANNEL;
}

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
    /* Channel 0 follows the current Wi-Fi radio channel. This is required when
     * a Windows hotspot changes channel after being restarted. */
    peer.channel = 0;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = true;
    return esp_now_add_peer(&peer) == ESP_OK;
}

bool espnow_transport_init(bool gateway_role) {
    if (esp_netif_init() != ESP_OK || esp_event_loop_create_default() != ESP_OK) return false;
    /* This owns the STA DHCP client. Without it the radio can associate with
     * an AP but IP_EVENT_STA_GOT_IP is never emitted. */
    if (!esp_netif_create_default_wifi_sta()) return false;
    wifi_init_config_t wifi_cfg = WIFI_INIT_CONFIG_DEFAULT();
    if (esp_wifi_init(&wifi_cfg) != ESP_OK || esp_wifi_set_mode(WIFI_MODE_STA) != ESP_OK || esp_wifi_start() != ESP_OK) return false;
    if (!gateway_role) {
        uint8_t channel = select_node_channel();
        if (esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE) != ESP_OK) return false;
    }
    if (esp_now_init() != ESP_OK || esp_now_set_pmk(ESPNOW_PMK) != ESP_OK) return false;
    receive_queue = xQueueCreate(12, sizeof(espnow_received_t));
    if (!receive_queue || esp_now_register_recv_cb(receive_callback) != ESP_OK) return false;

    if (gateway_role) {
        for (size_t i = 0; i < GATEWAY_PEER_COUNT; ++i)
            if (GATEWAY_PEERS[i].provisioned &&
                !add_peer(GATEWAY_PEERS[i].mac, GATEWAY_PEERS[i].lmk)) return false;
    } else if (!add_peer(GATEWAY_MAC, GATEWAY_LMK)) {
        return false;
    }
    uint8_t active_channel = 0;
    wifi_second_chan_t secondary = WIFI_SECOND_CHAN_NONE;
    (void)esp_wifi_get_channel(&active_channel, &secondary);
    ESP_LOGI(TAG, "ESP-NOW ready on channel %u", active_channel);
    return true;
}

bool espnow_transport_send(const uint8_t destination[6], const protocol_frame_t *frame) {
    return destination && frame && esp_now_send(destination, (const uint8_t *)frame, protocol_frame_size(frame)) == ESP_OK;
}

bool espnow_transport_receive(espnow_received_t *received, uint32_t timeout_ms) {
    return received && xQueueReceive(receive_queue, received, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}

bool espnow_transport_replace_peers(const node_peer_config_t *old_peers, size_t old_count,
                                    const node_peer_config_t *new_peers, size_t new_count) {
    for (size_t i = 0; i < old_count; ++i)
        if (old_peers[i].provisioned && esp_now_is_peer_exist(old_peers[i].mac))
            (void)esp_now_del_peer(old_peers[i].mac);
    for (size_t i = 0; i < new_count; ++i) {
        if (!new_peers[i].provisioned || add_peer(new_peers[i].mac, new_peers[i].lmk)) continue;
        for (size_t j = 0; j < i; ++j)
            if (new_peers[j].provisioned && esp_now_is_peer_exist(new_peers[j].mac))
                (void)esp_now_del_peer(new_peers[j].mac);
        for (size_t j = 0; j < old_count; ++j)
            if (old_peers[j].provisioned) (void)add_peer(old_peers[j].mac, old_peers[j].lmk);
        ESP_LOGE(TAG, "No se pudo aplicar la lista de pares; se restauró la anterior");
        return false;
    }
    return true;
}
