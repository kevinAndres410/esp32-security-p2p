#include "esp_log.h"
#include "nvs_flash.h"
#include "config.h"
#include "espnow_transport.h"
#include "gateway.h"
#include "node.h"
#include "ble_discovery.h"

void app_main(void) {
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(espnow_transport_init(DEVICE_ROLE == DEVICE_ROLE_GATEWAY) ? ESP_OK : ESP_FAIL);
    (void)ble_discovery_start(DEVICE_ROLE == DEVICE_ROLE_GATEWAY);
    if (DEVICE_ROLE == DEVICE_ROLE_GATEWAY) gateway_run();
    else node_run();
}
