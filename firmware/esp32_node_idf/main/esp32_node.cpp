/*
  esp32_node.cpp
  ---------------------------------------------------------------
  Firmware de un nodo ESP32-C3 Mini real para esp32-security-p2p (Sprint 4).
  Versión ESP-IDF, usando "arduino-esp32" como componente (ver
  main/idf_component.yml) — el código Arduino (setup/loop) se mantiene
  igual al de la versión PlatformIO; solo cambia el sistema de build.

  Responsabilidades:
    1. Conectarse a WiFi.
    2. Conectarse al backend por Socket.IO, namespace "/nodes".
    3. Resolver el reto de autenticación mutua (HMAC-SHA256) que
       envía backend/src/websocket/socket.js.
    4. Enviar heartbeat periódico una vez autenticado.
    5. Actualizar su clave cuando el backend la rota, y GUARDARLA en
       memoria no volátil (NVS) para que sobreviva a un reinicio.

  El chip C3 SÍ tiene aceleración por hardware para SHA/AES, así que
  mbedtls la usa automáticamente sin cambios en este código.

  IMPORTANTE sobre compatibilidad criptográfica:
    El backend calcula HMAC-SHA256 usando el STRING de la clave
    compartida tal cual está en la base de datos (una cadena hex de
    64 caracteres), NO los bytes que resultarían de decodificar ese
    hex. Aquí se replica exactamente ese comportamiento: se usa
    CLAVE_COMPARTIDA como arreglo de caracteres ASCII, igual que
    Node lo hace con crypto.createHmac('sha256', claveHexString).
*/

#include <Arduino.h>       // Necesario en ESP-IDF: en el .ino era implícito
#include <WiFi.h>
#include <SocketIOclient.h>
#include <ArduinoJson.h>
#include <Preferences.h>

#include "config.h"
#include "cipher.h"

SocketIOclient socketIO;
Preferences preferencias;

bool autenticado = false;
String claveActual;

unsigned long ultimoHeartbeat = 0;

// ===================== Envío de eventos Socket.IO =====================
// El namespace "/nodes" se antepone manualmente al payload, siguiendo
// el protocolo Socket.IO: "42/nodes,[\"evento\", {...}]"

void emitirEventoNodo(const String &evento, JsonDocument &datos) {
  String payload;
  serializeJson(datos, payload);

  String mensaje = "/nodes,[\"" + evento + "\"," + payload + "]";
  socketIO.sendEVENT(mensaje);
}

void unirseNamespaceNodos() {
  socketIO.send(sIOtype_CONNECT, "/nodes");
}

// ===================== Persistencia de la clave (NVS) =====================
// Guarda/recupera la clave compartida en memoria no volátil, para que un
// reinicio o corte de luz no deje al nodo con una clave vieja mientras el
// backend ya tiene una más reciente.

void cargarClaveGuardada() {
  preferencias.begin("nodo_cfg", false); // false = lectura/escritura

  // Si nunca se ha guardado nada, usa la clave inicial del config.h
  // y la guarda de una vez para dejar todo sincronizado desde el arranque.
  claveActual = preferencias.getString("clave", CLAVE_COMPARTIDA);

  if (!preferencias.isKey("clave")) {
    preferencias.putString("clave", claveActual);
  }

  Serial.println("[Clave] Cargada desde memoria persistente (NVS)");
}

void guardarClaveActual() {
  preferencias.putString("clave", claveActual);
  Serial.println("[Clave] Guardada en memoria persistente (NVS)");
}

// ===================== Lógica de autenticación mutua =====================

void manejarRetoAutenticacion(JsonDocument &doc) {
  // Payload: ["reto_autenticacion", { "reto": "..." }]
  String reto = doc[1]["reto"].as<String>();

  char respuestaBuf[65]; // 64 hex chars + '\0'
  calcular_hmac_sha256_hex(claveActual.c_str(), reto.c_str(), respuestaBuf);
  String respuesta = String(respuestaBuf);

  JsonDocument salida;
  salida["device_id"] = DEVICE_ID;
  salida["respuesta"] = respuesta;
  emitirEventoNodo("handshake_nodo", salida);

  Serial.println("[Auth] Reto recibido, respuesta enviada");
}

void manejarAuthOk() {
  autenticado = true;
  Serial.println("[Auth] Autenticación mutua exitosa");
}

void manejarAuthFallida(JsonDocument &doc) {
  autenticado = false;
  String motivo = doc[1]["motivo"] | "desconocido";
  Serial.printf("[Auth] Autenticación fallida: %s\n", motivo.c_str());
}

void manejarClaveRotada(JsonDocument &doc) {
  // Payload: ["clave_rotada_nodo", { "device_id": "...", "nuevaClave": "..." }]
  String deviceId = doc[1]["device_id"].as<String>();
  if (deviceId != DEVICE_ID) return;

  claveActual = doc[1]["nuevaClave"].as<String>();
  guardarClaveActual();
  Serial.println("[Clave] Actualizada por rotación del backend");
}

// ===================== Heartbeat =====================

void enviarHeartbeat() {
  JsonDocument datos;
  datos["device_id"] = DEVICE_ID;
  emitirEventoNodo("heartbeat", datos);
  Serial.println("[Heartbeat] Enviado");
}

// ===================== Manejador central de eventos Socket.IO =====================

void socketIOEvent(socketIOmessageType_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case sIOtype_DISCONNECT:
      autenticado = false;
      Serial.println("[Socket.IO] Desconectado");
      break;

    case sIOtype_CONNECT:
      Serial.println("[Socket.IO] Conectado, uniéndose a namespace /nodes");
      unirseNamespaceNodos();
      break;

    case sIOtype_EVENT: {
      // payload llega como: ["nombreEvento", { ...datos }]
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        Serial.printf("[Socket.IO] Error parseando evento: %s\n", err.c_str());
        return;
      }

      String evento = doc[0].as<String>();

      if (evento == "reto_autenticacion") {
        manejarRetoAutenticacion(doc);
      } else if (evento == "auth_ok") {
        manejarAuthOk();
      } else if (evento == "auth_fallida") {
        manejarAuthFallida(doc);
      } else if (evento == "clave_rotada_nodo") {
        manejarClaveRotada(doc);
      }
      break;
    }

    default:
      break;
  }
}

// ===================== Setup / Loop =====================

void conectarWiFi() {
  Serial.printf("Conectando a WiFi: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }

  Serial.println();
  Serial.printf("WiFi conectado, IP: %s\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);

  // El ESP32-C3 Mini suele usar USB nativo (no chip puente USB-UART):
  // esta espera evita perder los primeros mensajes por Serial mientras
  // el sistema operativo enumera el puerto. Tiene timeout para no
  // bloquear el arranque si no hay monitor serial conectado.
  unsigned long inicioEspera = millis();
  while (!Serial && millis() - inicioEspera < 3000) {
    delay(10);
  }
  delay(300);

  cargarClaveGuardada();
  conectarWiFi();

  socketIO.begin(BACKEND_HOST, BACKEND_PORT, "/socket.io/?EIO=4");
  socketIO.onEvent(socketIOEvent);

  Serial.printf("[Nodo %s] Inicializado, conectando al backend...\n", DEVICE_ID);
}

void loop() {
  socketIO.loop();

  if (autenticado && millis() - ultimoHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    ultimoHeartbeat = millis();
    enviarHeartbeat();
  }
}
