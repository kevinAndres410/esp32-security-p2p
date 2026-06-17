const { encrypt, decrypt } = require('./cipher');
const { getCurrentKey, rotateKey } = require('./keyManager');

class NodoESP32 {
  constructor(id) {
    this.id = id;
    this.key = getCurrentKey();
    console.log(`[Nodo ${this.id}] Iniciado con clave: ${this.key.substring(0, 16)}...`);
  }

  enviarMensaje(destinatario, mensaje) {
    const cifrado = encrypt(mensaje, this.key);
    console.log(`[Nodo ${this.id}] → Nodo ${destinatario.id} | Cifrado: ${cifrado.substring(0, 32)}...`);
    destinatario.recibirMensaje(this.id, cifrado, this.key);
  }

  recibirMensaje(origenId, cifrado, key) {
    const descifrado = decrypt(cifrado, key);
    console.log(`[Nodo ${this.id}] ← Nodo ${origenId} | Descifrado: "${descifrado}"`);
  }

  actualizarClave() {
    const { newKey } = rotateKey();
    this.key = newKey;
    console.log(`[Nodo ${this.id}] Clave actualizada: ${this.key.substring(0, 16)}...`);
  }
}

// Prueba de comunicación entre dos nodos
const nodoA = new NodoESP32('A');
const nodoB = new NodoESP32('B');

console.log('\n--- Prueba de comunicación P2P ---\n');
nodoA.enviarMensaje(nodoB, 'Hola Nodo B, conexión segura establecida');
nodoB.enviarMensaje(nodoA, 'Hola Nodo A, confirmado');

console.log('\n--- Prueba de rotación de claves ---\n');
nodoA.actualizarClave();
nodoB.actualizarClave();
nodoA.enviarMensaje(nodoB, 'Mensaje con nueva clave rotada');