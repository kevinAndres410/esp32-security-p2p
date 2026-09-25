#include "config.h"

#define PROFILE_GATEWAY 0
#define PROFILE_NODE_1  1
#define PROFILE_NODE_2  2
#define PROFILE_NODE_3  3

#ifndef DEVICE_PROFILE
#define DEVICE_PROFILE PROFILE_GATEWAY
#endif

/* Provisioning set for this installation. Nodes discover the hotspot channel
 * at boot; ESPNOW_CHANNEL is used only as a fallback when the SSID is absent. */
const uint8_t GATEWAY_MAC[6] = { 0xB0, 0x3F, 0xD3, 0x5B, 0x50, 0xB4 };
const uint8_t ESPNOW_PMK[16] = { 0xf5, 0x56, 0xda, 0x50, 0x1e, 0x72, 0x42, 0x2e,
                                  0xf3, 0xaf, 0x73, 0x2b, 0x0b, 0x35, 0x62, 0x73 };

#if DEVICE_PROFILE == PROFILE_GATEWAY
const device_role_t DEVICE_ROLE = DEVICE_ROLE_GATEWAY;
const char *DEVICE_ID = "gateway-001";
const char *NODE_HMAC_KEY_HEX = "";
const uint8_t GATEWAY_LMK[16] = { 0 };
#elif DEVICE_PROFILE == PROFILE_NODE_1
const device_role_t DEVICE_ROLE = DEVICE_ROLE_NODE;
const char *DEVICE_ID = "esp32-001";
const char *NODE_HMAC_KEY_HEX = "4ce5266230514250637bc6926aa8d20230b0363c6833d29f261c2eb610048cfa";
const uint8_t GATEWAY_LMK[16] = { 0xeb, 0x7f, 0x09, 0xca, 0xa6, 0xed, 0x8b, 0x2b,
                                  0x4e, 0x96, 0x5b, 0x72, 0xc6, 0x38, 0x1d, 0xca };
#elif DEVICE_PROFILE == PROFILE_NODE_2
const device_role_t DEVICE_ROLE = DEVICE_ROLE_NODE;
const char *DEVICE_ID = "esp32-002";
const char *NODE_HMAC_KEY_HEX = "c79aecc9bf8bda0cb4646c826d9c767aa3191473e14adc8306c11915da7e26f4";
const uint8_t GATEWAY_LMK[16] = { 0x22, 0x6c, 0xa9, 0x9e, 0x31, 0xb8, 0xd8, 0x5d,
                                  0xf9, 0xd8, 0x10, 0x0f, 0xbd, 0x0a, 0x49, 0x1f };
#elif DEVICE_PROFILE == PROFILE_NODE_3
const device_role_t DEVICE_ROLE = DEVICE_ROLE_NODE;
const char *DEVICE_ID = "esp32-003";
const char *NODE_HMAC_KEY_HEX = "93e1406dec25879f054fe5cbda0e05f38a69b0f563faa2cadbcb8f002597244d";
const uint8_t GATEWAY_LMK[16] = { 0x05, 0xe7, 0x28, 0x2c, 0x88, 0x6d, 0xec, 0xc1,
                                  0x37, 0x9a, 0x8c, 0xe7, 0x95, 0xc4, 0xc9, 0x6c };
#else
#error "DEVICE_PROFILE must be 0 (gateway) or 1..3 (nodes)"
#endif
/* Fallback used only if a node cannot discover the configured SSID. */
const uint8_t ESPNOW_CHANNEL = 1;

const char *WIFI_SSID = "DANIELRO 2884";
const char *WIFI_PASSWORD = "7(H5m652";
/* Backend local accesible desde el gateway en la misma red Wi-Fi. */
const char *UPSTREAM_URL = "http://192.168.137.1:5000/api/gateway/sync";

const node_peer_config_t GATEWAY_PEERS[] = {
    {
        .device_id = "esp32-001",
        .hmac_key_hex = "4ce5266230514250637bc6926aa8d20230b0363c6833d29f261c2eb610048cfa",
        .mac = { 0x20, 0x50, 0x0D, 0x17, 0xC8, 0xD0 },
        .lmk = { 0xeb, 0x7f, 0x09, 0xca, 0xa6, 0xed, 0x8b, 0x2b,
                 0x4e, 0x96, 0x5b, 0x72, 0xc6, 0x38, 0x1d, 0xca },
        .provisioned = true,
    },
    {
        .device_id = "esp32-002",
        .hmac_key_hex = "c79aecc9bf8bda0cb4646c826d9c767aa3191473e14adc8306c11915da7e26f4",
        .mac = { 0x04, 0xB2, 0x47, 0x54, 0xDA, 0x90 },
        .lmk = { 0x22, 0x6c, 0xa9, 0x9e, 0x31, 0xb8, 0xd8, 0x5d,
                 0xf9, 0xd8, 0x10, 0x0f, 0xbd, 0x0a, 0x49, 0x1f },
        .provisioned = true,
    },
    {
        .device_id = "esp32-003",
        .hmac_key_hex = "93e1406dec25879f054fe5cbda0e05f38a69b0f563faa2cadbcb8f002597244d",
        .mac = { 0x20, 0x50, 0x0D, 0x17, 0xEC, 0x64 },
        .lmk = { 0x05, 0xe7, 0x28, 0x2c, 0x88, 0x6d, 0xec, 0xc1,
                 0x37, 0x9a, 0x8c, 0xe7, 0x95, 0xc4, 0xc9, 0x6c },
        .provisioned = true,
    },
};
const size_t GATEWAY_PEER_COUNT = sizeof(GATEWAY_PEERS) / sizeof(GATEWAY_PEERS[0]);
