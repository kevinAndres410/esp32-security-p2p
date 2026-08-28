#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "protocol.h"

typedef struct {
    uint8_t source_mac[6];
    size_t length;
    uint8_t data[sizeof(protocol_frame_t)];
} espnow_received_t;

bool espnow_transport_init(bool gateway_role);
bool espnow_transport_send(const uint8_t destination[6], const protocol_frame_t *frame);
bool espnow_transport_receive(espnow_received_t *received, uint32_t timeout_ms);
