// Puerto de backend/src/crypto/cipher.js al firmware ESP32.
// Usa mbedtls (incluido en el core de Arduino para ESP32) para AES-256-CBC,
// manteniendo el mismo formato de salida "ivHex:cifradoHex" que el backend Node.js,
// para que un nodo físico y el simulador puedan intercambiar mensajes cifrados
// sin diferencias de formato.

#include "crypto.h"
#include "mbedtls/aes.h"
#include "esp_system.h"
#include <string.h>

static const char HEX_CHARS[] = "0123456789abcdef";
static const size_t KEY_BYTES = 32; // AES-256
static const size_t IV_BYTES = 16;  // Tamaño de bloque AES

static String bytesToHex(const uint8_t *data, size_t len) {
  String out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out += HEX_CHARS[(data[i] >> 4) & 0xF];
    out += HEX_CHARS[data[i] & 0xF];
  }
  return out;
}

static int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static bool hexToBytes(const String &hex, uint8_t *out, size_t outLen) {
  if ((size_t)hex.length() != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    int hi = hexNibble(hex[i * 2]);
    int lo = hexNibble(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return true;
}

String generateKey() {
  uint8_t key[KEY_BYTES];
  for (size_t i = 0; i < KEY_BYTES; i++) {
    key[i] = (uint8_t)(esp_random() & 0xFF);
  }
  return bytesToHex(key, KEY_BYTES);
}

String encrypt(const String &plaintext, const String &keyHex) {
  uint8_t key[KEY_BYTES];
  if (!hexToBytes(keyHex, key, KEY_BYTES)) return "";

  uint8_t iv[IV_BYTES];
  for (size_t i = 0; i < IV_BYTES; i++) iv[i] = (uint8_t)(esp_random() & 0xFF);

  uint8_t ivWork[IV_BYTES];
  memcpy(ivWork, iv, IV_BYTES);

  size_t plainLen = plaintext.length();
  size_t padLen = IV_BYTES - (plainLen % IV_BYTES);
  size_t paddedLen = plainLen + padLen;

  uint8_t *padded = (uint8_t *)malloc(paddedLen);
  uint8_t *cipherBuf = (uint8_t *)malloc(paddedLen);
  if (!padded || !cipherBuf) {
    free(padded);
    free(cipherBuf);
    return "";
  }

  memcpy(padded, plaintext.c_str(), plainLen);
  for (size_t i = plainLen; i < paddedLen; i++) padded[i] = (uint8_t)padLen;

  mbedtls_aes_context ctx;
  mbedtls_aes_init(&ctx);
  mbedtls_aes_setkey_enc(&ctx, key, 256);
  mbedtls_aes_crypt_cbc(&ctx, MBEDTLS_AES_ENCRYPT, paddedLen, ivWork, padded, cipherBuf);
  mbedtls_aes_free(&ctx);

  String result = bytesToHex(iv, IV_BYTES) + ":" + bytesToHex(cipherBuf, paddedLen);

  free(padded);
  free(cipherBuf);
  return result;
}

String decrypt(const String &encryptedData, const String &keyHex) {
  int sep = encryptedData.indexOf(':');
  if (sep < 0) return "";

  String ivHex = encryptedData.substring(0, sep);
  String cipherHex = encryptedData.substring(sep + 1);

  uint8_t key[KEY_BYTES];
  if (!hexToBytes(keyHex, key, KEY_BYTES)) return "";

  uint8_t iv[IV_BYTES];
  if (!hexToBytes(ivHex, iv, IV_BYTES)) return "";

  size_t cipherLen = cipherHex.length() / 2;
  if (cipherLen == 0 || cipherLen % IV_BYTES != 0) return "";

  uint8_t *cipherBuf = (uint8_t *)malloc(cipherLen);
  uint8_t *plainBuf = (uint8_t *)malloc(cipherLen);
  if (!cipherBuf || !plainBuf || !hexToBytes(cipherHex, cipherBuf, cipherLen)) {
    free(cipherBuf);
    free(plainBuf);
    return "";
  }

  mbedtls_aes_context ctx;
  mbedtls_aes_init(&ctx);
  mbedtls_aes_setkey_dec(&ctx, key, 256);
  mbedtls_aes_crypt_cbc(&ctx, MBEDTLS_AES_DECRYPT, cipherLen, iv, cipherBuf, plainBuf);
  mbedtls_aes_free(&ctx);

  size_t padLen = plainBuf[cipherLen - 1];
  size_t plainLen = (padLen > 0 && padLen <= IV_BYTES && padLen <= cipherLen)
                       ? cipherLen - padLen
                       : cipherLen;

  String result;
  result.reserve(plainLen);
  for (size_t i = 0; i < plainLen; i++) result += (char)plainBuf[i];

  free(cipherBuf);
  free(plainBuf);
  return result;
}