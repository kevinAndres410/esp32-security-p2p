// Puerto de backend/src/crypto/keyManager.js al firmware ESP32.
// Node usa setInterval(); en un microcontrolador no hay que bloquear el loop(),
// así que aquí se usa un patrón basado en millis() no bloqueante:
// keyManagerUpdate() debe llamarse en cada vuelta del loop() principal.

#include "key_manager.h"
#include "crypto.h"

static String currentKey;
static bool rotationActive = false;
static unsigned long intervalMs = 5UL * 60UL * 1000UL; // 5 minutos por defecto
static unsigned long lastRotation = 0;

void keyManagerInit() {
  currentKey = generateKey();
  lastRotation = millis();
  Serial.println("[KeyManager] Clave inicial generada");
}

String getCurrentKey() {
  return currentKey;
}

String rotateKey() {
  currentKey = generateKey();
  lastRotation = millis();
  Serial.print("[KeyManager] Clave rotada en t=");
  Serial.println(lastRotation);
  return currentKey;
}

void startRotation(unsigned long intervalMinutes) {
  intervalMs = intervalMinutes * 60UL * 1000UL;
  rotationActive = true;
  lastRotation = millis();
  Serial.print("[KeyManager] Rotación automática cada ");
  Serial.print(intervalMinutes);
  Serial.println(" minutos");
}

void stopRotation() {
  rotationActive = false;
  Serial.println("[KeyManager] Rotación detenida");
}

void keyManagerUpdate() {
  if (!rotationActive) return;
  if (millis() - lastRotation >= intervalMs) {
    rotateKey();
  }
}