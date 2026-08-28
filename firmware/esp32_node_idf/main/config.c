#include "config.h"

/* Provisioning example. Replace every value before flashing real hardware.
 * ESP-NOW is bound to the Wi-Fi channel. When the gateway joins an AP, this
 * channel must be the AP channel and all nodes must use the same value. */
const device_role_t DEVICE_ROLE = DEVICE_ROLE_GATEWAY;
const char *DEVICE_ID = "esp32-001";
const char *NODE_HMAC_KEY_HEX = "PEGA_AQUI_LA_CLAVE_HEX_DE_64_CARACTERES";
const uint8_t GATEWAY_MAC[6] = { 0x24, 0x6F, 0x28, 0x00, 0x00, 0x01 };
const uint8_t GATEWAY_LMK[16] = { 0x0c, 0x42, 0xa1, 0x7d, 0x38, 0xf0, 0x65, 0x99,
                                  0x15, 0xb2, 0x4e, 0xd0, 0x8a, 0x76, 0x31, 0x5c };
const uint8_t ESPNOW_PMK[16] = { 0x9a, 0x11, 0x63, 0xe4, 0x37, 0x55, 0x8c, 0x20,
                                  0x44, 0xba, 0x19, 0xde, 0x76, 0x03, 0x9f, 0xc2 };
const uint8_t ESPNOW_CHANNEL = 6;

const char *WIFI_SSID = "LENOVO_INGENIERO";
const char *WIFI_PASSWORD = "12345678";
/* HTTPS is required in production. The current backend has no matching route yet. */
const char *UPSTREAM_URL = "https://tu-servidor.example/api/gateway/sync";

const node_peer_config_t GATEWAY_PEERS[] = {
    {
        .device_id = "esp32-001",
        .hmac_key_hex = "PEGA_AQUI_LA_CLAVE_HEX_DE_64_CARACTERES",
        .mac = { 0x24, 0x6F, 0x28, 0x00, 0x00, 0x11 },
        .lmk = { 0x0c, 0x42, 0xa1, 0x7d, 0x38, 0xf0, 0x65, 0x99,
                 0x15, 0xb2, 0x4e, 0xd0, 0x8a, 0x76, 0x31, 0x5c },
    },
};
const size_t GATEWAY_PEER_COUNT = sizeof(GATEWAY_PEERS) / sizeof(GATEWAY_PEERS[0]);
