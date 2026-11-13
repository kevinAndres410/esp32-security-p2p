#include "config.h"

#ifndef DEVICE_PROFILE
#define DEVICE_PROFILE 0
#endif

/* Plantilla sin credenciales. Genere config.c con generate_kit_config.js
 * y un manifiesto local antes de compilar un kit real. */
const uint8_t GATEWAY_MAC[6] = { 0 };
const uint8_t ESPNOW_PMK[16] = { 0 };

#if DEVICE_PROFILE == 0
const device_role_t DEVICE_ROLE = DEVICE_ROLE_GATEWAY;
const char *DEVICE_ID = "gateway-example";
#elif DEVICE_PROFILE >= 1 && DEVICE_PROFILE <= 3
const device_role_t DEVICE_ROLE = DEVICE_ROLE_NODE;
const char *DEVICE_ID = "node-example";
#else
#error "DEVICE_PROFILE must be 0..3"
#endif

const char *NODE_HMAC_KEY_HEX = "";
const uint8_t GATEWAY_LMK[16] = { 0 };
const uint8_t NODE_EXPECTED_MAC[6] = { 0 };
const char *GATEWAY_CONTROL_KEY_HEX = "";
const uint8_t ESPNOW_CHANNEL = 1;
const char *WIFI_SSID = "REPLACE_ME";
const char *WIFI_PASSWORD = "REPLACE_ME";
const char *UPSTREAM_URL = "https://example.invalid/api/gateway/sync";
const node_peer_config_t GATEWAY_PEERS[] = { { 0 } };
const size_t GATEWAY_PEER_COUNT = 0;
