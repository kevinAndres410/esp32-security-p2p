#pragma once
#include <stdbool.h>
#include <stdint.h>

/* BLE announces the ESP-NOW identity of a kit node. Operational traffic stays
 * on the already authenticated ESP-NOW link. */
bool ble_discovery_start(bool gateway_role);
bool ble_discovery_receive(uint8_t wifi_mac[6]);
