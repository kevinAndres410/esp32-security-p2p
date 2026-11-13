const db = require('../models/db');
const { startRotation } = require('../crypto/keyManager');
const { rotateActiveNodeKeys } = require('./keyRotation.service');

const SETTING = 'key_rotation_minutes';

function currentInterval() {
  const stored = Number(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING)?.value);
  const fallback = Number(process.env.KEY_ROTATION_MINUTES || 5);
  return stored >= 1 && stored <= 1440 ? stored : fallback;
}

function applyRotationSchedule() {
  const minutes = currentInterval();
  startRotation(minutes, () => {
    const rotations = rotateActiveNodeKeys();
    console.log(`[KeyManager] Rotación automática aplicada a ${rotations.length} nodo(s) activos`);
  });
  return minutes;
}

module.exports = { currentInterval, applyRotationSchedule, SETTING };
