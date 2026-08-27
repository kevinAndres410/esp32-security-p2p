#ifndef KEY_MANAGER_H
#define KEY_MANAGER_H

#include <Arduino.h>

// Llamar una vez en setup(): genera la clave inicial.
void keyManagerInit();

// Llamar en cada loop(): revisa de forma NO bloqueante si toca rotar
// (equivalente ESP32 del setInterval() que usa keyManager.js en Node).
void keyManagerUpdate();

String getCurrentKey();

// Fuerza una rotación manual inmediata. Devuelve la nueva clave.
String rotateKey();

// Activa la rotación automática cada `intervalMinutes` minutos.
void startRotation(unsigned long intervalMinutes = 5);

// Detiene la rotación automática.
void stopRotation();

#endif