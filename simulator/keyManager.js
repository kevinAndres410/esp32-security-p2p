const { generateKey } = require('./cipher');

let currentKey = generateKey();
let rotationInterval = null;

function getCurrentKey() {
  return currentKey;
}

function rotateKey() {
  const oldKey = currentKey;
  currentKey = generateKey();
  console.log(`[KeyManager] Clave rotada: ${new Date().toISOString()}`);
  return { oldKey, newKey: currentKey };
}

function startRotation(intervalMinutes = 5) {
  if (rotationInterval) clearInterval(rotationInterval);
  rotationInterval = setInterval(() => {
    rotateKey();
  }, intervalMinutes * 60 * 1000);
  console.log(`[KeyManager] Rotación automática cada ${intervalMinutes} minutos`);
}

function stopRotation() {
  if (rotationInterval) {
    clearInterval(rotationInterval);
    rotationInterval = null;
    console.log('[KeyManager] Rotación detenida');
  }
}

module.exports = { getCurrentKey, rotateKey, startRotation, stopRotation };