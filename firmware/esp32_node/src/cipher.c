#include "cipher.h"

#include <string.h>
#include <mbedtls/md.h>

static void bytes_a_hex(const uint8_t *buf, size_t len, char *salida) {
  static const char HEX_CHARS[] = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    salida[i * 2]     = HEX_CHARS[(buf[i] >> 4) & 0x0F];
    salida[i * 2 + 1] = HEX_CHARS[buf[i] & 0x0F];
  }
  salida[len * 2] = '\0';
}

void calcular_hmac_sha256_hex(const char *clave, const char *mensaje, char *salidaHex) {
  const mbedtls_md_info_t *mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  uint8_t digest[32];

  mbedtls_md_hmac(
    mdInfo,
    (const unsigned char *)clave, strlen(clave),
    (const unsigned char *)mensaje, strlen(mensaje),
    digest
  );

  bytes_a_hex(digest, sizeof(digest), salidaHex);
}
