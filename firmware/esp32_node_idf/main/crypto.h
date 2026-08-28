#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool crypto_hmac_sha256(const char *key, const uint8_t *data, size_t data_len, uint8_t out[32]);
bool crypto_hmac_hex(const char *key, const char *message, char out[65]);
bool crypto_constant_time_equal(const uint8_t *left, const uint8_t *right, size_t len);
