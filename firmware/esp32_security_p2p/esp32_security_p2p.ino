// Sprint 4 - Semana 2
// Prueba de cifrado/descifrado y rotación de claves portados desde
// backend/src/crypto/cipher.js y keyManager.js.

#include "crypto.h"
#include "key_manager.h"

void setup() {
  Serial.begin(115200);
  delay(1000);

  keyManagerInit();
  startRotation(5); // misma cadencia que el backend (5 minutos)

  String key = getCurrentKey();
  String mensaje = "Hola desde nodo ESP32";

  String cifrado = encrypt(mensaje, key);
  Serial.print("Mensaje original: ");
  Serial.println(mensaje);
  Serial.print("Cifrado:          ");
  Serial.println(cifrado);

  String descifrado = decrypt(cifrado, key);
  Serial.print("Descifrado:       ");
  Serial.println(descifrado);

  Serial.println(descifrado == mensaje ? "OK: cifrado/descifrado correcto" : "ERROR: no coincide");
}

void loop() {
  keyManagerUpdate();
  // TODO (cuando lleguen los ESP32 físicos): WiFi + comunicación real con el simulador/backend
}