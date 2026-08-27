#ifndef CIPHER_H
#define CIPHER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Calcula HMAC-SHA256(clave, mensaje) y lo escribe como string hexadecimal
 * en minúsculas en "salidaHex".
 *
 * Equivalente exacto a, en el backend (Node):
 *   crypto.createHmac('sha256', clave).update(mensaje).digest('hex')
 *
 * "clave" y "mensaje" se usan como strings ASCII (terminados en '\0'),
 * NO se decodifican de hex a bytes — así es como Node trata el string
 * de la clave por defecto, y aquí se replica igual.
 *
 * "salidaHex" debe apuntar a un buffer de al menos 65 bytes
 * (64 caracteres hex + terminador nulo).
 */
void calcular_hmac_sha256_hex(const char *clave, const char *mensaje, char *salidaHex);

#ifdef __cplusplus
}
#endif

#endif // CIPHER_H
