#include "esp_log.h"
#include "esp_mac.h"
#include <string.h>
#include "nvs_flash.h"
#include "config.h"
#include "espnow_transport.h"
#include "gateway.h"
#include "node.h"
#include "ble_discovery.h"

void app_main(void) {
    const uint8_t unset_mac[6] = {0};
    if (DEVICE_ROLE == DEVICE_ROLE_NODE && memcmp(NODE_EXPECTED_MAC, unset_mac, 6) != 0) {
        uint8_t physical_mac[6];
        ESP_ERROR_CHECK(esp_read_mac(physical_mac, ESP_MAC_WIFI_STA));
        if (memcmp(physical_mac, NODE_EXPECTED_MAC, 6) != 0) {
            ESP_LOGE("provisioning", "Firmware de nodo grabado en una placa distinta");
            return;
        }
    }
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(espnow_transport_init(DEVICE_ROLE == DEVICE_ROLE_GATEWAY) ? ESP_OK : ESP_FAIL);
    (void)ble_discovery_start(DEVICE_ROLE == DEVICE_ROLE_GATEWAY);
    if (DEVICE_ROLE == DEVICE_ROLE_GATEWAY) gateway_run();
    else node_run();
}
