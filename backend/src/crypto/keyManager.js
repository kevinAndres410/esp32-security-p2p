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

function startRotation(intervalMinutes = 5, onRotation) {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error('El intervalo de rotación debe ser un número positivo de minutos');
  }
  if (rotationInterval) clearInterval(rotationInterval);
  rotationInterval = setInterval(() => {
    const rotation = rotateKey();
    if (typeof onRotation === 'function') {
      Promise.resolve(onRotation(rotation)).catch((error) => {
        console.error('[KeyManager] Falló la rotación automática:', error.message);
      });
    }
  }, intervalMinutes * 60 * 1000);
  // El temporizador no debe impedir un cierre limpio del servidor o las pruebas.
  if (typeof rotationInterval.unref === 'function') rotationInterval.unref();
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
