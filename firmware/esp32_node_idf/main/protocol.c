#include "protocol.h"

#include <string.h>
#include "crypto.h"

size_t protocol_frame_size(const protocol_frame_t *frame) {
    (void)frame;
    /* ESP-NOW permits 250 bytes; fixed-size frames avoid an ambiguous HMAC offset. */
    return sizeof(protocol_frame_t);
}

bool protocol_build(protocol_frame_t *frame, protocol_type_t type, uint32_t sequence,
                    const char *device_id, const uint8_t *payload, size_t payload_len,
                    const char *hmac_key) {
    if (!frame || !device_id || !hmac_key || payload_len > ESPNOW_MAX_PAYLOAD) return false;
    memset(frame, 0, sizeof(*frame));
    frame->magic = PROTOCOL_MAGIC;
    frame->version = PROTOCOL_VERSION;
    frame->type = (uint8_t)type;
    frame->sequence = sequence;
    strncpy(frame->device_id, device_id, sizeof(frame->device_id) - 1);
    frame->payload_len = (uint8_t)payload_len;
    if (payload_len > 0 && payload) memcpy(frame->payload, payload, payload_len);
    return crypto_hmac_sha256(hmac_key, (const uint8_t *)frame,
                              offsetof(protocol_frame_t, payload) + payload_len, frame->hmac);
}

bool protocol_verify(const protocol_frame_t *frame, size_t frame_len, const char *hmac_key) {
    uint8_t expected[32];
    if (!frame || !hmac_key || frame->magic != PROTOCOL_MAGIC || frame->version != PROTOCOL_VERSION ||
        frame->payload_len > ESPNOW_MAX_PAYLOAD || frame_len != sizeof(protocol_frame_t)) return false;
    if (!crypto_hmac_sha256(hmac_key, (const uint8_t *)frame,
                            offsetof(protocol_frame_t, payload) + frame->payload_len, expected)) return false;
    return crypto_constant_time_equal(expected, frame->hmac, sizeof(expected));
}
