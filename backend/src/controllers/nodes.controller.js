const crypto = require('crypto');
const db = require('../models/db');
const { emitEstadoRed, emitAlerta } = require('../websocket/socket');

// GET /api/nodes
function listNodes(req, res) {
  const nodos = db.prepare(`SELECT * FROM nodos ORDER BY registrado_en DESC`).all();
  res.json(nodos);
}

// GET /api/nodes/:deviceId
function getNode(req, res) {
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(req.params.deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
  res.json(nodo);
}

// POST /api/nodes  -> registrar nodo nuevo
function registerNode(req, res) {
  const { deviceId, descripcion } = req.body;
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId es requerido' });
  }

  const existente = db.prepare(`SELECT id FROM nodos WHERE device_id = ?`).get(deviceId);
  if (existente) return res.status(409).json({ error: 'El nodo ya está registrado' });

  const claveActual = crypto.randomBytes(32).toString('hex');

  db.prepare(`INSERT INTO nodos (device_id, descripcion, estado, clave_actual) VALUES (?, ?, 'pendiente', ?)`)
    .run(deviceId, descripcion || null, claveActual);

  db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
    .run('registro', `Nodo ${deviceId} registrado`, deviceId);

  emitEstadoRed();
  emitAlerta({ nodo_id: deviceId, tipo: 'info', mensaje: `Nuevo nodo registrado: ${deviceId}` });

  // La clave compartida solo se retorna una vez, en el registro,
  // para que el ESP32 la guarde en su firmware.
  res.status(201).json({ deviceId, claveActual });
}

// PATCH /api/nodes/:deviceId/block
function blockNode(req, res) {
  const { deviceId } = req.params;
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

  db.prepare(`UPDATE nodos SET estado = 'bloqueado' WHERE device_id = ?`).run(deviceId);
  db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
    .run('bloqueo', `Nodo ${deviceId} bloqueado manualmente`, deviceId);

  emitEstadoRed();
  emitAlerta({ nodo_id: deviceId, tipo: 'warning', mensaje: `Nodo bloqueado: ${deviceId}` });
  res.json({ deviceId, estado: 'bloqueado' });
}

// PATCH /api/nodes/:deviceId/unblock
function unblockNode(req, res) {
  const { deviceId } = req.params;
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

  db.prepare(`UPDATE nodos SET estado = 'activo' WHERE device_id = ?`).run(deviceId);
  emitEstadoRed();
  res.json({ deviceId, estado: 'activo' });
}

// DELETE /api/nodes/:deviceId
function deleteNode(req, res) {
  const { deviceId } = req.params;
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

  db.prepare(`DELETE FROM nodos WHERE device_id = ?`).run(deviceId);
  db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
    .run('eliminacion', `Nodo ${deviceId} eliminado del sistema`, deviceId);

  emitEstadoRed();
  res.json({ message: 'Nodo eliminado' });
}

module.exports = { listNodes, getNode, registerNode, blockNode, unblockNode, deleteNode };
