// Sprint 4 - Semana 2
// Prueba de cifrado/descifrado y rotación de claves portados desde
// backend/src/crypto/cipher.js y keyManager.js.
// Validado en hardware físico: ESP32-C3 (USB-Serial/JTAG nativo).
//
// La prueba se repite cada 5 segundos en el loop() en vez de correr una
// sola vez en el setup(), para poder verla sin importar en qué momento
// se abra el Monitor Serie.

#include <Arduino.h>
#include "crypto.h"
#include "key_manager.h"

unsigned long lastTest = 0;

void setup() {
  Serial.begin(115200);
  delay(2000);

  keyManagerInit();
  startRotation(5); // misma cadencia que el backend (5 minutos)

  Serial.println("=== Nodo ESP32 iniciado ===");
}

void runTest() {
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
  Serial.println("---");
}

void loop() {
  keyManagerUpdate();

  if (millis() - lastTest >= 5000) {
    runTest();
    lastTest = millis();
  }
  // TODO (próximo paso): WiFi + comunicación real con el simulador/backend
}