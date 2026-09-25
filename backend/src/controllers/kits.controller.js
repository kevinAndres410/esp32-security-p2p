const crypto = require('crypto');
const db = require('../models/db');
const { emitEstadoRed } = require('../websocket/socket');

const hashCode = (code) => crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
const normalizeMac = (mac) => {
  const compact = String(mac || '').replace(/[:-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(compact) ? compact.match(/.{2}/g).join(':') : null;
};
const isAdvanced = (userId) => db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(userId)?.rol === 'avanzado';

function listKits(req, res) {
  const kits = db.prepare(`SELECT k.id, k.gateway_id, k.gateway_mac, k.created_at,
    (SELECT COUNT(*) FROM kit_devices d WHERE d.kit_id = k.id) AS device_count
    FROM kits k WHERE k.owner_user_id = ? ORDER BY k.id`).all(req.usuario.id);
  res.json(kits);
}

function claimKit(req, res) {
  const code = String(req.body?.claimCode || '').trim();
  if (code.length < 12 || code.length > 128) return res.status(400).json({ error: 'Código de kit inválido' });
  const kit = db.prepare('SELECT id, gateway_id, owner_user_id FROM kits WHERE claim_code_hash = ?').get(hashCode(code));
  if (!kit) return res.status(404).json({ error: 'Kit no encontrado' });
  if (kit.owner_user_id && kit.owner_user_id !== req.usuario.id) return res.status(409).json({ error: 'Este kit ya fue reclamado' });
  if (!kit.owner_user_id) {
    const claimed = db.prepare('UPDATE kits SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL')
      .run(req.usuario.id, kit.id);
    if (!claimed.changes) return res.status(409).json({ error: 'Este kit ya fue reclamado' });
  }
  res.json({ id: kit.id, gatewayId: kit.gateway_id });
}

function ownKit(req, res) {
  const kit = db.prepare('SELECT * FROM kits WHERE id = ?').get(req.params.kitId);
  if (!kit || kit.owner_user_id !== req.usuario.id) {
    res.status(404).json({ error: 'Kit no encontrado' });
    return null;
  }
  return kit;
}

function startScan(req, res) {
  const kit = ownKit(req, res);
  if (!kit) return;
  db.prepare("UPDATE kits SET scan_until = datetime('now', '+45 seconds') WHERE id = ?").run(kit.id);
  res.status(202).json({ kitId: kit.id, scanSeconds: 45 });
}

function listCandidates(req, res) {
  const kit = ownKit(req, res);
  if (!kit) return;
  const rows = db.prepare(`SELECT d.id, d.device_id, d.mac_address, d.detected_at, d.detected_transport,
    r.id AS request_id, r.status AS request_status
    FROM kit_devices d LEFT JOIN device_requests r ON r.id = (
      SELECT id FROM device_requests WHERE kit_device_id = d.id ORDER BY id DESC LIMIT 1)
    WHERE d.kit_id = ? AND d.detected_at IS NOT NULL
      AND (datetime(d.detected_at) >= datetime('now', '-120 seconds')
        OR r.status IN ('pending', 'approved'))
    ORDER BY d.device_id`).all(kit.id);
  res.json(rows);
}

function listInventory(req, res) {
  const kit = ownKit(req, res);
  if (!kit) return;
  if (!isAdvanced(req.usuario.id)) return res.status(403).json({ error: 'Inventario técnico restringido' });
  res.json(db.prepare(`SELECT id, device_id, mac_address, detected_at, detected_transport
    FROM kit_devices WHERE kit_id = ? ORDER BY device_id`).all(kit.id));
}

function reportCandidate(req, res) {
  const { deviceId, macAddress, transport, nonce } = req.body || {};
  const mac = normalizeMac(macAddress);
  if (!deviceId || !mac || !['wifi', 'ble'].includes(transport) || !Number.isInteger(nonce)) {
    return res.status(400).json({ error: 'Reporte de descubrimiento inválido' });
  }
  const device = db.prepare(`SELECT d.*, k.gateway_id, k.scan_until FROM kit_devices d JOIN kits k ON k.id = d.kit_id
    WHERE d.device_id = ? AND d.mac_address = ?`).get(deviceId, mac);
  if (!device) return res.status(403).json({ error: 'Dispositivo ajeno al kit' });
  const signature = String(req.headers['x-kit-signature'] || '');
  const key = db.prepare('SELECT clave_actual FROM nodos WHERE device_id = ?').get(deviceId)?.clave_actual || device.hmac_key;
  const expected = crypto.createHmac('sha256', key).update(`${deviceId}:${mac}:${transport}:${nonce}`).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(signature) ||
      !crypto.timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Firma de kit inválida' });
  }
  const scanning = device.scan_until && db.prepare("SELECT 1 AS ok WHERE datetime(?) >= datetime('now')")
    .get(device.scan_until);
  if (!scanning) return res.status(202).json({ accepted: false });
  db.prepare('UPDATE kit_devices SET detected_at = CURRENT_TIMESTAMP, detected_transport = ? WHERE id = ?')
    .run(transport, device.id);
  res.json({ accepted: true, gatewayId: device.gateway_id });
}

function createRequest(req, res) {
  const kit = ownKit(req, res);
  if (!kit) return;
  const device = db.prepare('SELECT * FROM kit_devices WHERE id = ? AND kit_id = ?')
    .get(req.body?.kitDeviceId, kit.id);
  if (!device) return res.status(404).json({ error: 'Dispositivo ajeno al kit' });
  const method = req.body?.method === 'manual' ? 'manual' : 'automatic';
  if (method === 'manual' && !isAdvanced(req.usuario.id)) return res.status(403).json({ error: 'Registro manual restringido' });
  if (method === 'automatic' && (!device.detected_at ||
      !db.prepare("SELECT 1 AS ok WHERE datetime(?) >= datetime('now', '-120 seconds')").get(device.detected_at))) {
    return res.status(409).json({ error: 'Vuelve a buscar: el Gateway aún no detecta este dispositivo' });
  }
  const last = db.prepare('SELECT id, status FROM device_requests WHERE kit_device_id = ? ORDER BY id DESC LIMIT 1').get(device.id);
  if (last && ['pending', 'approved'].includes(last.status)) return res.status(200).json(last);
  const result = db.prepare(`INSERT INTO device_requests (kit_device_id, requester_user_id, method)
    VALUES (?, ?, ?)`).run(device.id, req.usuario.id, method);
  res.status(201).json({ id: result.lastInsertRowid, status: 'pending' });
}

function listRequests(req, res) {
  const advanced = isAdvanced(req.usuario.id);
  const rows = db.prepare(`SELECT r.id, r.status, r.method, r.created_at, r.decided_at, r.reason,
    d.device_id, d.mac_address, d.detected_transport, k.gateway_id,
    u.nombre AS requester_name
    FROM device_requests r JOIN kit_devices d ON d.id = r.kit_device_id
    JOIN kits k ON k.id = d.kit_id JOIN usuarios u ON u.id = r.requester_user_id
    WHERE (? = 1 OR r.requester_user_id = ?) ORDER BY r.id DESC`)
    .all(advanced ? 1 : 0, req.usuario.id);
  res.json(rows);
}

function decide(req, res) {
  if (!isAdvanced(req.usuario.id)) return res.status(403).json({ error: 'Acceso restringido a usuarios avanzados' });
  if (!['approve', 'reject'].includes(req.params.action)) return res.status(404).json({ error: 'Acción no encontrada' });
  const approve = req.params.action === 'approve';
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Solicitud inválida' });
  const record = db.prepare(`SELECT r.*, d.device_id, d.mac_address, d.hmac_key, d.kit_id, k.gateway_id
    FROM device_requests r JOIN kit_devices d ON d.id = r.kit_device_id
    JOIN kits k ON k.id = d.kit_id WHERE r.id = ?`).get(id);
  if (!record) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (record.status !== 'pending') {
    const requestedStatus = approve ? 'approved' : 'rejected';
    if (record.status === requestedStatus) return res.json({ id, status: requestedStatus, alreadyDecided: true });
    return res.status(409).json({ error: 'Solicitud ya decidida' });
  }
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!approve && !reason) return res.status(400).json({ error: 'Indica un motivo de rechazo' });
  try {
    db.transaction(() => {
      const changed = db.prepare(`UPDATE device_requests SET status = ?, decided_by = ?,
        decided_at = CURRENT_TIMESTAMP, reason = ? WHERE id = ? AND status = 'pending'`)
        .run(approve ? 'approved' : 'rejected', req.usuario.id, reason || null, id);
      if (!changed.changes) throw new Error('Solicitud ya decidida');
      if (approve) {
        db.prepare(`INSERT INTO nodos (device_id, mac_address, descripcion, estado, clave_actual, admission_status)
          VALUES (?, ?, ?, 'pendiente', ?, 'approved')
          ON CONFLICT(device_id) DO UPDATE SET estado = 'pendiente', admission_status = 'approved'
          WHERE nodos.mac_address = excluded.mac_address`)
          .run(record.device_id, record.mac_address, `Kit ${record.gateway_id}`, record.hmac_key);
      }
      db.prepare('INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)')
        .run(approve ? 'aprobacion' : 'rechazo',
          `${approve ? 'Aprobado' : 'Rechazado'} ${record.device_id} del kit ${record.gateway_id}`, record.device_id);
    })();
  } catch (error) { return res.status(409).json({ error: error.message }); }
  emitEstadoRed();
  res.json({ id, status: approve ? 'approved' : 'rejected' });
}

module.exports = { listKits, claimKit, startScan, listCandidates, listInventory, reportCandidate,
  createRequest, listRequests, decide, normalizeMac, hashCode };
