const db = require('../models/db');
const { emitEstadoRed } = require('../websocket/socket');
const { rotateNodeKey, rotateActiveNodeKeys } = require('../services/keyRotation.service');

// GET /api/keys/:deviceId
function getKeyInfo(req, res) {
  const nodo = db.prepare(`SELECT device_id, clave_actual, ultima_actividad FROM nodos WHERE device_id = ?`)
    .get(req.params.deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

  res.json({
    deviceId: nodo.device_id,
    claveActual: nodo.clave_actual.substring(0, 16) + '...',
    ultimaActividad: nodo.ultima_actividad,
  });
}

// POST /api/keys/:deviceId/rotate -> fuerza rotación manual de clave de un nodo específico
function rotateKey(req, res) {
  const { deviceId } = req.params;
  const result = rotateNodeKey(deviceId, 'manual');
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  db.prepare(`INSERT INTO admin_audit_log
    (actor_user_id, action, entity_type, entity_id, metadata_json)
    VALUES (?, 'key.rotated', 'node', ?, '{}')`).run(req.usuario.id, deviceId);
  emitEstadoRed();
  res.json({ deviceId, claveActual: result.newKey.substring(0, 16) + '...' });
}

function rotateAllKeys(req, res) {
  const rotations = rotateActiveNodeKeys('manual');
  db.prepare(`INSERT INTO admin_audit_log
    (actor_user_id, action, entity_type, entity_id, metadata_json)
    VALUES (?, 'key.rotated_all', 'nodes', 'all', ?)`)
    .run(req.usuario.id, JSON.stringify({ count: rotations.length }));
  res.json({ mensaje: 'Rotación global iniciada', nodosRotados: rotations.length });
}

module.exports = { getKeyInfo, rotateKey, rotateAllKeys };
