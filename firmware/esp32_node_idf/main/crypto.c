#include "crypto.h"

#include <string.h>
#include "psa/crypto.h"

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
