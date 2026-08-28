#pragma once

#include <stddef.h>
#include <stdint.h>

/* Flash the same project on every board and select its role here. */
typedef enum { DEVICE_ROLE_NODE, DEVICE_ROLE_GATEWAY } device_role_t;

typedef struct {
    const char *device_id;
    const char *hmac_key_hex; /* 64 hex chars, kept as ASCII for compatibility with Node's HMAC. */
    uint8_t mac[6];
    uint8_t lmk[16];           /* ESP-NOW unicast link key; unique for every peer. */
} node_peer_config_t;

extern const device_role_t DEVICE_ROLE;
extern const char *DEVICE_ID;
extern const char *NODE_HMAC_KEY_HEX;
extern const uint8_t GATEWAY_MAC[6];
extern const uint8_t GATEWAY_LMK[16];
extern const uint8_t ESPNOW_PMK[16];
extern const uint8_t ESPNOW_CHANNEL;
extern const char *WIFI_SSID;
extern const char *WIFI_PASSWORD;
extern const char *UPSTREAM_URL;
extern const node_peer_config_t GATEWAY_PEERS[];
extern const size_t GATEWAY_PEER_COUNT;

#define ESPNOW_MAX_PAYLOAD          128
#define HEARTBEAT_INTERVAL_MS     10000
#define UPSTREAM_SYNC_INTERVAL_MS 10000
