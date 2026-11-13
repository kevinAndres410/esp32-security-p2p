#include "crypto.h"

#include <string.h>
#include <stdlib.h>
#include "psa/crypto.h"
#include "config.h"

static int hex_value(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

static bool decode_aes_key(const char *key_hex, uint8_t key[32]) {
    if (!key_hex || strlen(key_hex) != 64) return false;
    for (size_t i = 0; i < 32; ++i) {
        int high = hex_value(key_hex[i * 2]);
        int low = hex_value(key_hex[i * 2 + 1]);
        if (high < 0 || low < 0) return false;
        key[i] = (uint8_t)((high << 4) | low);
    }
    return true;
}

static bool import_aes_key(const char *key_hex, psa_key_usage_t usage, mbedtls_svc_key_id_t *key_id) {
    uint8_t key[32];
    if (!key_id || !decode_aes_key(key_hex, key) || psa_crypto_init() != PSA_SUCCESS) return false;
    psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attributes, PSA_KEY_TYPE_AES);
    psa_set_key_bits(&attributes, 256);
    psa_set_key_usage_flags(&attributes, usage);
    psa_set_key_algorithm(&attributes, PSA_ALG_GCM);
    psa_status_t status = psa_import_key(&attributes, key, sizeof(key), key_id);
    psa_reset_key_attributes(&attributes);
    return status == PSA_SUCCESS;
}

bool crypto_hmac_sha256(const char *key, const uint8_t *data, size_t data_len, uint8_t out[32]) {
    if (!key || !data || !out || psa_crypto_init() != PSA_SUCCESS) return false;

    psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
    mbedtls_svc_key_id_t key_id = {0};
    size_t output_length = 0;
    psa_set_key_type(&attributes, PSA_KEY_TYPE_HMAC);
    psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_SIGN_MESSAGE);
    psa_set_key_algorithm(&attributes, PSA_ALG_HMAC(PSA_ALG_SHA_256));

    psa_status_t status = psa_import_key(&attributes, (const uint8_t *)key, strlen(key), &key_id);
    psa_reset_key_attributes(&attributes);
    if (status != PSA_SUCCESS) return false;

    status = psa_mac_compute(key_id, PSA_ALG_HMAC(PSA_ALG_SHA_256), data, data_len,
                             out, 32, &output_length);
    (void)psa_destroy_key(key_id);
    return status == PSA_SUCCESS && output_length == 32;
}

bool crypto_hmac_hex(const char *key, const char *message, char out[65]) {
    static const char hex[] = "0123456789abcdef";
    uint8_t digest[32];
    if (!crypto_hmac_sha256(key, (const uint8_t *)message, strlen(message), digest)) return false;
    for (size_t i = 0; i < sizeof(digest); ++i) {
        out[i * 2] = hex[digest[i] >> 4];
        out[i * 2 + 1] = hex[digest[i] & 0x0f];
    }
    out[64] = '\0';
    return true;
}

bool crypto_constant_time_equal(const uint8_t *left, const uint8_t *right, size_t len) {
    uint8_t difference = 0;
    for (size_t i = 0; i < len; ++i) difference |= left[i] ^ right[i];
    return difference == 0;
}

bool crypto_aes256_gcm_encrypt(const char *key_hex, const uint8_t nonce[12],
                               const uint8_t *aad, size_t aad_len,
                               const uint8_t *plaintext, size_t plaintext_len,
                               uint8_t *ciphertext, uint8_t tag[16]) {
    mbedtls_svc_key_id_t key_id = {0}; size_t output_len = 0;
    uint8_t output[ESPNOW_MAX_PAYLOAD + 16];
    if (!nonce || !ciphertext || !tag || plaintext_len > ESPNOW_MAX_PAYLOAD ||
        !import_aes_key(key_hex, PSA_KEY_USAGE_ENCRYPT, &key_id)) return false;
    psa_status_t status = psa_aead_encrypt(key_id, PSA_ALG_GCM, nonce, 12, aad, aad_len,
                                           plaintext, plaintext_len, output, sizeof(output), &output_len);
    (void)psa_destroy_key(key_id);
    if (status != PSA_SUCCESS || output_len != plaintext_len + 16) return false;
    if (plaintext_len) memcpy(ciphertext, output, plaintext_len);
    memcpy(tag, output + plaintext_len, 16);
    return true;
}

bool crypto_aes256_gcm_decrypt(const char *key_hex, const uint8_t nonce[12],
                               const uint8_t *aad, size_t aad_len,
                               const uint8_t *ciphertext, size_t ciphertext_len,
                               const uint8_t tag[16], uint8_t *plaintext) {
    mbedtls_svc_key_id_t key_id = {0}; size_t output_len = 0;
    uint8_t input[ESPNOW_MAX_PAYLOAD + 16];
    if (!nonce || !ciphertext || !tag || !plaintext || ciphertext_len > ESPNOW_MAX_PAYLOAD ||
        !import_aes_key(key_hex, PSA_KEY_USAGE_DECRYPT, &key_id)) return false;
    if (ciphertext_len) memcpy(input, ciphertext, ciphertext_len);
    memcpy(input + ciphertext_len, tag, 16);
    psa_status_t status = psa_aead_decrypt(key_id, PSA_ALG_GCM, nonce, 12, aad, aad_len,
                                           input, ciphertext_len + 16, plaintext, ciphertext_len, &output_len);
    (void)psa_destroy_key(key_id);
    return status == PSA_SUCCESS && output_len == ciphertext_len;
}

bool crypto_aes256_gcm_decrypt_buffer(const char *key_hex, const uint8_t nonce[12],
                                      const uint8_t *aad, size_t aad_len,
                                      const uint8_t *ciphertext, size_t ciphertext_len,
                                      const uint8_t tag[16], uint8_t *plaintext,
                                      size_t plaintext_capacity) {
    if (!nonce || !ciphertext || !tag || !plaintext || ciphertext_len > plaintext_capacity ||
        ciphertext_len > 4096) return false;
    mbedtls_svc_key_id_t key_id = {0};
    if (!import_aes_key(key_hex, PSA_KEY_USAGE_DECRYPT, &key_id)) return false;
    uint8_t *combined = malloc(ciphertext_len + 16);
    if (!combined) { (void)psa_destroy_key(key_id); return false; }
    memcpy(combined, ciphertext, ciphertext_len);
    memcpy(combined + ciphertext_len, tag, 16);
    size_t output_len = 0;
    psa_status_t status = psa_aead_decrypt(key_id, PSA_ALG_GCM, nonce, 12,
        aad, aad_len, combined, ciphertext_len + 16,
        plaintext, plaintext_capacity, &output_len);
    free(combined);
    (void)psa_destroy_key(key_id);
    return status == PSA_SUCCESS && output_len == ciphertext_len;
}
