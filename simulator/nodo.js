const { io } = require('socket.io-client');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./cipher');

class NodoESP32 {
  // deviceId y claveCompartida deben coincidir con un nodo ya registrado
  // en el backend vía POST /api/nodes (la clave la devuelve ese endpoint
  // una sola vez, al momento del registro).
  constructor(deviceId, claveCompartida, serverUrl = 'http://localhost:5000') {
    this.deviceId = deviceId;
    this.key = claveCompartida;
    this.autenticado = false;

    this.socket = io(`${serverUrl}/nodes`, { reconnection: true });
    this._configurarHandshake();
  }

  // ===== Autenticación mutua con el backend (Sprint 3) =====
  _configurarHandshake() {
    this.socket.on('connect', () => {
      console.log(`[Nodo ${this.deviceId}] Conectado al backend, esperando reto...`);
    });

    // Paso 1: el backend envía un reto, el nodo responde con HMAC(clave, reto)
    this.socket.on('reto_autenticacion', ({ reto }) => {
      const respuesta = crypto.createHmac('sha256', this.key).update(reto).digest('hex');
      this.socket.emit('handshake_nodo', { device_id: this.deviceId, respuesta });
    });

    this.socket.on('auth_ok', () => {
      this.autenticado = true;
      console.log(`[Nodo ${this.deviceId}] Autenticación mutua exitosa`);
      this._iniciarHeartbeat();
    });

    this.socket.on('auth_fallida', ({ motivo }) => {
      console.error(`[Nodo ${this.deviceId}] Autenticación fallida (${motivo})`);
    });

    // El backend puede rotar la clave del nodo (panel de rotación de claves);
    // el nodo debe actualizar su copia local sin perder la sesión.
    this.socket.on('clave_rotada_nodo', ({ device_id, nuevaClave }) => {
      if (device_id !== this.deviceId) return;
      this.key = nuevaClave;
      console.log(`[Nodo ${this.deviceId}] Clave actualizada por rotación del backend`);
    });

    this.socket.on('disconnect', () => {
      this.autenticado = false;
      clearInterval(this.heartbeatInterval);
      console.log(`[Nodo ${this.deviceId}] Desconectado del backend`);
    });
  }

  _iniciarHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.socket.emit('heartbeat', { device_id: this.deviceId });
    }, 10000);
  }

  // ===== Comunicación P2P directa entre nodos simulados =====
  // (mensajería cifrada entre nodos, no pasa por el backend; usa la misma
  // clave compartida que ya fue validada en el handshake de autenticación)
  enviarMensaje(destinatario, mensaje) {
    const cifrado = encrypt(mensaje, this.key);
    console.log(`[Nodo ${this.deviceId}] → Nodo ${destinatario.deviceId} | Cifrado: ${cifrado.substring(0, 32)}...`);
    destinatario.recibirMensaje(this.deviceId, cifrado, this.key);
  }

  recibirMensaje(origenId, cifrado, key) {
    const descifrado = decrypt(cifrado, key);
    console.log(`[Nodo ${this.deviceId}] ← Nodo ${origenId} | Descifrado: "${descifrado}"`);
  }
}

module.exports = NodoESP32;

// ===== Script de prueba: node nodo.js =====
if (require.main === module) {
  const NODO_A_ID = process.env.NODO_A_ID || 'esp32-A';
  const NODO_A_KEY = process.env.NODO_A_KEY;
  const NODO_B_ID = process.env.NODO_B_ID || 'esp32-B';
  const NODO_B_KEY = process.env.NODO_B_KEY;

  if (!NODO_A_KEY || !NODO_B_KEY) {
    console.error(
      'Faltan NODO_A_KEY / NODO_B_KEY.\n' +
      'Registra cada nodo primero: POST /api/nodes { "deviceId": "esp32-A" }\n' +
      'y usa la "claveActual" que responde ese endpoint como valor de estas variables.'
    );
    process.exit(1);
  }

  const nodoA = new NodoESP32(NODO_A_ID, NODO_A_KEY);
  const nodoB = new NodoESP32(NODO_B_ID, NODO_B_KEY);

  // Espera a que ambos nodos completen el handshake con el backend
  // antes de simular la comunicación P2P entre ellos.
  setTimeout(() => {
    console.log('\n--- Prueba de comunicación P2P ---\n');
    nodoA.enviarMensaje(nodoB, 'Hola Nodo B, conexión segura establecida');
    nodoB.enviarMensaje(nodoA, 'Hola Nodo A, confirmado');
  }, 2000);
}