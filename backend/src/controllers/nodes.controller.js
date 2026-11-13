const db = require('../models/db');
const { emitEstadoRed, emitAlerta } = require('../websocket/socket');

// GET /api/nodes
function listNodes(req, res) {
  const role = db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(req.usuario.id)?.rol;
  const advanced = ['avanzado', 'master_admin'].includes(role);
  const nodos = db.prepare(`SELECT id, device_id, mac_address, descripcion,
    CASE
      WHEN estado IN ('bloqueado', 'pendiente') THEN estado
      WHEN ultima_actividad IS NOT NULL
        AND (julianday('now') - julianday(ultima_actividad)) * 86400 <= 45 THEN 'activo'
      ELSE 'desconectado'
    END AS estado,
    ultima_actividad,
    registrado_en, clave_rotada_en FROM nodos
    WHERE admission_status != 'revoked' AND (? = 1 OR device_id IN (SELECT d.device_id FROM kit_devices d
      JOIN kits k ON k.id = d.kit_id WHERE k.owner_user_id = ?))
    ORDER BY registrado_en DESC`).all(advanced ? 1 : 0, req.usuario.id);
  res.json(nodos);
}

// GET /api/nodes/:deviceId
function getNode(req, res) {
  const role = db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(req.usuario.id)?.rol;
  const advanced = ['avanzado', 'master_admin'].includes(role);
  const nodo = db.prepare(`SELECT id, device_id, mac_address, descripcion,
    CASE
      WHEN estado IN ('bloqueado', 'pendiente') THEN estado
      WHEN ultima_actividad IS NOT NULL
        AND (julianday('now') - julianday(ultima_actividad)) * 86400 <= 45 THEN 'activo'
      ELSE 'desconectado'
    END AS estado,
    ultima_actividad,
    registrado_en, clave_rotada_en FROM nodos WHERE device_id = ? AND admission_status != 'revoked'
    AND (? = 1 OR device_id IN (SELECT d.device_id FROM kit_devices d
      JOIN kits k ON k.id = d.kit_id WHERE k.owner_user_id = ?))`)
    .get(req.params.deviceId, advanced ? 1 : 0, req.usuario.id);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
  res.json(nodo);
}

// POST /api/nodes  -> registrar nodo nuevo
function registerNode(req, res) {
  if (!['avanzado', 'master_admin'].includes(
    db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(req.usuario.id)?.rol
  )) {
    return res.status(403).json({ error: 'Registro manual restringido al rol Experimentado' });
  }
  const { deviceId, descripcion, macAddress } = req.body;
  const { normalizeMac } = require('./kits.controller');
  const normalizedMac = normalizeMac(macAddress);
  if (!deviceId || !normalizedMac) return res.status(400).json({ error: 'Identificador y MAC válidos requeridos' });
  const inventory = db.prepare(`SELECT d.*, k.owner_user_id FROM kit_devices d JOIN kits k ON k.id = d.kit_id
    WHERE d.device_id = ? AND d.mac_address = ?`).get(deviceId, normalizedMac);
  if (!inventory || inventory.owner_user_id !== req.usuario.id) {
    return res.status(403).json({ error: 'Solo se admiten nodos del kit asignado a tu cuenta' });
  }
  if (db.prepare('SELECT gateway_control_secret_ciphertext FROM kits WHERE id = ?')
    .get(inventory.kit_id)?.gateway_control_secret_ciphertext) {
    return res.status(409).json({ error: 'Usa el flujo de incorporación del kit' });
  }
  const existing = db.prepare('SELECT id FROM nodos WHERE device_id = ? OR mac_address = ?').get(deviceId, normalizedMac);
  if (existing) return res.status(409).json({ error: 'El nodo ya está registrado' });
  const pending = db.prepare("SELECT id FROM device_requests WHERE kit_device_id = ? AND status = 'pending'").get(inventory.id);
  if (pending) return res.status(409).json({ error: 'Ya existe una solicitud pendiente' });
  const result = db.prepare(`INSERT INTO device_requests (kit_device_id, requester_user_id, method, reason)
    VALUES (?, ?, 'manual', ?)`).run(inventory.id, req.usuario.id, String(descripcion || '').slice(0, 200));
  res.status(201).json({ requestId: result.lastInsertRowid, deviceId, macAddress: normalizedMac, estado: 'pendiente' });
}

// PATCH /api/nodes/:deviceId/block
function blockNode(req, res) {
  const { deviceId } = req.params;
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });

  db.prepare(`UPDATE nodos SET estado = 'bloqueado' WHERE device_id = ?`).run(deviceId);
  db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
    .run('bloqueo', `Nodo ${deviceId} bloqueado manualmente`, deviceId);
  db.prepare(`INSERT INTO admin_audit_log
    (actor_user_id, action, entity_type, entity_id, metadata_json)
    VALUES (?, 'node.blocked', 'node', ?, '{}')`).run(req.usuario.id, deviceId);

  emitEstadoRed();
  emitAlerta({ nodo_id: deviceId, tipo: 'warning', mensaje: `Nodo bloqueado: ${deviceId}` });
  res.json({ deviceId, estado: 'bloqueado' });
}

// PATCH /api/nodes/:deviceId/unblock
function unblockNode(req, res) {
  const { deviceId } = req.params;
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
  if (nodo.admission_status !== 'approved') return res.status(409).json({ error: 'Nodo pendiente de aprobación' });

  db.prepare(`UPDATE nodos SET estado = 'activo' WHERE device_id = ?`).run(deviceId);
  db.prepare(`INSERT INTO admin_audit_log
    (actor_user_id, action, entity_type, entity_id, metadata_json)
    VALUES (?, 'node.unblocked', 'node', ?, '{}')`).run(req.usuario.id, deviceId);
  emitEstadoRed();
  res.json({ deviceId, estado: 'activo' });
}

// DELETE /api/nodes/:deviceId
function deleteNode(req, res) {
  const { deviceId } = req.params;
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);
  if (!nodo) return res.status(404).json({ error: 'Nodo no encontrado' });
  if (db.prepare(`SELECT 1 FROM kit_devices d JOIN kits k ON k.id = d.kit_id
    WHERE d.device_id = ? AND d.desired_state = 'active'
      AND k.gateway_control_secret_ciphertext IS NOT NULL`).get(deviceId)) {
    return res.status(409).json({ error: 'Retira el nodo desde Mis dispositivos para revocar su acceso al Gateway' });
  }

  db.prepare(`UPDATE device_requests SET status = 'revoked', decided_at = CURRENT_TIMESTAMP
    WHERE kit_device_id IN (SELECT id FROM kit_devices WHERE device_id = ?) AND status = 'approved'`)
    .run(deviceId);
  db.prepare(`DELETE FROM nodos WHERE device_id = ?`).run(deviceId);
  db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
    .run('eliminacion', `Nodo ${deviceId} eliminado del sistema`, deviceId);
  db.prepare(`INSERT INTO admin_audit_log
    (actor_user_id, action, entity_type, entity_id, metadata_json)
    VALUES (?, 'node.deleted', 'node', ?, '{}')`).run(req.usuario.id, deviceId);

  emitEstadoRed();
  res.json({ message: 'Nodo eliminado' });
}

module.exports = { listNodes, getNode, registerNode, blockNode, unblockNode, deleteNode };
