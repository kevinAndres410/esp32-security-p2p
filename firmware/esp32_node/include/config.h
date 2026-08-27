#ifndef CONFIG_H
#define CONFIG_H

// ===== WiFi =====
#define WIFI_SSID     "TU_RED_WIFI"
#define WIFI_PASSWORD "TU_PASSWORD_WIFI"

// ===== Backend (esp32-security-p2p) =====
#define BACKEND_HOST  "192.168.1.100"  // IP local de la máquina donde corre backend/src/index.js
#define BACKEND_PORT  5000

// ===== Identidad del nodo =====
// Debe coincidir EXACTAMENTE con un nodo ya registrado vía:
//   POST /api/nodes  { "deviceId": "esp32-001" }
// CLAVE_COMPARTIDA es la "claveActual" que ese endpoint devuelve UNA sola vez.
// Guárdala aquí tal cual (string hexadecimal de 64 caracteres, sin decodificar).
#define DEVICE_ID          "esp32-001"
#define CLAVE_COMPARTIDA   "PEGA_AQUI_LA_CLAVE_HEX_DEVUELTA_AL_REGISTRAR"

// ===== Heartbeat =====
#define HEARTBEAT_INTERVAL_MS 10000

#endif
