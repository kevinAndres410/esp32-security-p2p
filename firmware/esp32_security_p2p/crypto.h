#ifndef CRYPTO_H
#define CRYPTO_H

#include <Arduino.h>

// Cifra `plaintext` con la clave hex (64 caracteres = 32 bytes / AES-256-CBC).
// Devuelve un String en formato "ivHex:cifradoHex", exactamente igual que
// el cipher.js del backend (Node "crypto", aes-256-cbc).
String encrypt(const String &plaintext, const String &keyHex);

// Descifra un String en formato "ivHex:cifradoHex" usando la clave hex dada.
// Devuelve "" si el formato o la clave no son válidos.
String decrypt(const String &encryptedData, const String &keyHex);

// Genera una clave aleatoria de 32 bytes (64 caracteres hex),
// igual que generateKey() en cipher.js.
String generateKey();

#endif