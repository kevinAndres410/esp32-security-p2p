#include "ble_discovery.h"
#include "config.h"

#ifdef CONFIG_BT_NIMBLE_ENABLED
#include <string.h>
#include "esp_log.h"
#include "esp_mac.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "host/ble_gap.h"
#include "host/ble_hs.h"
#include "host/ble_hs_adv.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"

static const char *TAG = "kit_ble";
static const uint8_t service_uuid[16] = {
    0x8e, 0x54, 0x28, 0x17, 0x30, 0x84, 0x43, 0x9c,
    0xad, 0x44, 0x38, 0x61, 0x6b, 0x12, 0xc8, 0x10
};
static uint8_t advertisement[22];
static QueueHandle_t candidates;
static bool is_gateway;

static int gap_event(struct ble_gap_event *event, void *arg) {
    (void)arg;
    if (is_gateway && event->type == BLE_GAP_EVENT_DISC) {
        struct ble_hs_adv_fields fields = {0};
        if (ble_hs_adv_parse_fields(&fields, event->disc.data, event->disc.length_data) != 0 ||
            fields.svc_data_uuid128_len != sizeof(advertisement) ||
            memcmp(fields.svc_data_uuid128, service_uuid, sizeof(service_uuid)) != 0) return 0;
        uint8_t mac[6];
        memcpy(mac, fields.svc_data_uuid128 + sizeof(service_uuid), sizeof(mac));
        (void)xQueueSend(candidates, mac, 0);
    }
    return 0;
}

static void on_sync(void) {
    uint8_t address_type;
    if (ble_hs_id_infer_auto(0, &address_type) != 0) return;
    if (is_gateway) {
        struct ble_gap_disc_params params = {0};
        params.passive = 1;
        params.filter_duplicates = 0;
        if (ble_gap_disc(address_type, BLE_HS_FOREVER, &params, gap_event, NULL) != 0)
            ESP_LOGW(TAG, "BLE scan did not start");
    } else {
        struct ble_hs_adv_fields fields = {0};
        fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
        fields.svc_data_uuid128 = advertisement;
        fields.svc_data_uuid128_len = sizeof(advertisement);
        if (ble_gap_adv_set_fields(&fields) != 0) return;
        struct ble_gap_adv_params params = {0};
        params.conn_mode = BLE_GAP_CONN_MODE_NON;
        params.disc_mode = BLE_GAP_DISC_MODE_GEN;
        if (ble_gap_adv_start(address_type, NULL, BLE_HS_FOREVER, &params, gap_event, NULL) != 0)
            ESP_LOGW(TAG, "BLE advertising did not start");
    }
}

static void host_task(void *arg) {
    (void)arg;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

bool ble_discovery_start(bool gateway_role) {
    is_gateway = gateway_role;
    if (gateway_role) {
        candidates = xQueueCreate(12, 6);
        if (!candidates) return false;
    } else {
        memcpy(advertisement, service_uuid, sizeof(service_uuid));
        if (esp_read_mac(advertisement + sizeof(service_uuid), ESP_MAC_WIFI_STA) != ESP_OK) return false;
    }
    if (nimble_port_init() != ESP_OK) return false;
    ble_hs_cfg.sync_cb = on_sync;
    nimble_port_freertos_init(host_task);
    return true;
}

bool ble_discovery_receive(uint8_t wifi_mac[6]) {
    return is_gateway && candidates && xQueueReceive(candidates, wifi_mac, 0) == pdTRUE;
}
#else
bool ble_discovery_start(bool gateway_role) { (void)gateway_role; return false; }
bool ble_discovery_receive(uint8_t wifi_mac[6]) { (void)wifi_mac; return false; }
#endif
