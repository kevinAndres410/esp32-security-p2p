const { generateKey } = require('../crypto/cipher');
const db = require('../models/db');
const { emitEstadoRed, emitAlerta, emitirClaveRotada } = require('../websocket/socket');

function rotateNodeKey(deviceId, origin = 'manual') {
  const node = db.prepare('SELECT device_id, estado, clave_actual, clave_anterior FROM nodos WHERE device_id = ?').get(deviceId);
  if (!node) return { ok: false, status: 404, error: 'Nodo no encontrado' };
  if (node.estado === 'bloqueado') return { ok: false, status: 409, error: 'No se rota la clave de un nodo bloqueado' };
  if (node.clave_anterior) return { ok: false, status: 409, error: 'El nodo ya tiene una rotación pendiente de confirmación' };

  const newKey = generateKey();
  db.prepare(`UPDATE nodos
              SET clave_anterior = clave_actual, clave_actual = ?, clave_rotada_en = CURRENT_TIMESTAMP
              WHERE device_id = ?`).run(newKey, deviceId);
  db.prepare('INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)')
    .run('rotacion', `Clave rotada ${origin}mente para nodo ${deviceId}`, deviceId);

  // El simulador la recibe por Socket.IO; el gateway físico la obtiene
  // mediante /api/gateway/sync mientras aún firma con la clave anterior.
  emitirClaveRotada(deviceId, newKey);
  emitAlerta({ nodo_id: deviceId, tipo: 'rotacion', mensaje: `Clave rotada: ${deviceId}` });
  return { ok: true, deviceId, newKey };
}

function rotateActiveNodeKeys(origin = 'automática') {
  const activeNodes = db.prepare("SELECT device_id FROM nodos WHERE estado = 'activo' AND clave_anterior IS NULL").all();
  const rotations = activeNodes.map(({ device_id }) => rotateNodeKey(device_id, origin));
  if (rotations.length) emitEstadoRed();
  return rotations;
}

module.exports = { rotateNodeKey, rotateActiveNodeKeys };
