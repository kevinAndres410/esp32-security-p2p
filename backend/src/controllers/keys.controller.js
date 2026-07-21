const crypto = require('crypto');
const db = require('../models/db');
const { emitEstadoRed, emitAlerta, emitirClaveRotada } = require('../websocket/socket');

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
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

  const nuevaClave = crypto.randomBytes(32).toString('hex');
  db.prepare(`UPDATE nodos SET clave_actual = ? WHERE device_id = ?`).run(nuevaClave, deviceId);

  db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
    .run('rotacion', `Clave rotada manualmente para nodo ${deviceId}`, deviceId);

  // Notifica al nodo real (ESP32) por WebSocket para que reemplace su copia local
  emitirClaveRotada(deviceId, nuevaClave);
  emitEstadoRed();
  emitAlerta({ nodo_id: deviceId, tipo: 'rotacion', mensaje: `Clave rotada: ${deviceId}` });

  res.json({ deviceId, claveActual: nuevaClave.substring(0, 16) + '...' });
}

module.exports = { getKeyInfo, rotateKey };
