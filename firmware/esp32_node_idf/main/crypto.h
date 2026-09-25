#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool crypto_hmac_sha256(const char *key, const uint8_t *data, size_t data_len, uint8_t out[32]);
bool crypto_hmac_hex(const char *key, const char *message, char out[65]);
bool crypto_constant_time_equal(const uint8_t *left, const uint8_t *right, size_t len);
bool crypto_aes256_gcm_encrypt(const char *key_hex, const uint8_t nonce[12],
                               const uint8_t *aad, size_t aad_len,
                               const uint8_t *plaintext, size_t plaintext_len,
                               uint8_t *ciphertext, uint8_t tag[16]);
bool crypto_aes256_gcm_decrypt(const char *key_hex, const uint8_t nonce[12],
                               const uint8_t *aad, size_t aad_len,
                               const uint8_t *ciphertext, size_t ciphertext_len,
                               const uint8_t tag[16], uint8_t *plaintext);
