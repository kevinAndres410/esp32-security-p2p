#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "config.h"

#define PROTOCOL_MAGIC 0x5044u /* "PD" */
#define PROTOCOL_VERSION 1u

typedef enum {
    PROTOCOL_HEARTBEAT = 1,
    PROTOCOL_COMMAND = 2,
    PROTOCOL_KEY_ROTATE = 3,
    PROTOCOL_ACK = 4,
} protocol_type_t;

typedef struct __attribute__((packed)) {
    uint16_t magic;
    uint8_t version;
    uint8_t type;
    uint32_t sequence;
    char device_id[24];
    uint8_t payload_len;
    uint8_t payload[ESPNOW_MAX_PAYLOAD];
    uint8_t hmac[32];
} protocol_frame_t;

size_t protocol_frame_size(const protocol_frame_t *frame);
bool protocol_build(protocol_frame_t *frame, protocol_type_t type, uint32_t sequence,
                    const char *device_id, const uint8_t *payload, size_t payload_len,
                    const char *hmac_key);
bool protocol_verify(const protocol_frame_t *frame, size_t frame_len, const char *hmac_key);
