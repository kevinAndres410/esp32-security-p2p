const crypto = require('crypto');
const db = require('../models/db');
const { emitEstadoRed } = require('../websocket/socket');
const { MAX_PEERS } = require('../services/gatewayConfig.service');

const hashCode = (code) => crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
const normalizeMac = (mac) => {
  const compact = String(mac || '').replace(/[:-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(compact) ? compact.match(/.{2}/g).join(':') : null;
};
const isAdvanced = (userId) => ['avanzado', 'master_admin'].includes(
  db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(userId)?.rol
);

function listKits(req, res) {
  const kits = db.prepare(`SELECT k.id, k.gateway_id, k.gateway_mac, k.created_at,
    k.gateway_last_seen_at,
    CASE WHEN k.gateway_last_seen_at IS NOT NULL AND
      (julianday('now') - julianday(k.gateway_last_seen_at)) * 86400 <= 45
      THEN 1 ELSE 0 END AS gateway_online,
    (SELECT COUNT(*) FROM kit_devices d WHERE d.kit_id = k.id AND d.desired_state = 'active') AS device_count,
    k.config_version, k.applied_version,
    k.gateway_control_secret_ciphertext IS NOT NULL AS dynamic_config_enabled
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
    WHERE d.kit_id = ? AND d.desired_state = 'active' AND d.detected_at IS NOT NULL
      AND (datetime(d.detected_at) >= datetime('now', '-120 seconds')
        OR r.status IN ('pending', 'approved'))
    ORDER BY d.device_id`).all(kit.id);
  res.json(rows);
}

function listInventory(req, res) {
  const kit = ownKit(req, res);
  if (!kit) return;
  res.json(db.prepare(`SELECT d.id, d.device_id, d.mac_address, d.component_role,
    d.detected_at, d.detected_transport, d.desired_version,
    (SELECT status FROM kit_device_operations o WHERE o.kit_id = d.kit_id
      AND o.device_id = d.device_id ORDER BY o.id DESC LIMIT 1) AS operation_status,
    CASE WHEN n.admission_status = 'approved' AND n.ultima_actividad IS NOT NULL
      AND (julianday('now') - julianday(n.ultima_actividad)) * 86400 <= 45
      THEN 1 ELSE 0 END AS connected
    FROM kit_devices d LEFT JOIN nodos n ON n.device_id = d.device_id
    WHERE d.kit_id = ? AND d.desired_state = 'active' ORDER BY d.component_role`).all(kit.id));
}

const activationHash = (code) => crypto.createHash('sha256')
  .update(String(code || '').trim().toUpperCase()).digest('hex');

function listOperations(req, res) {
  const kit = ownKit(req, res);
  if (!kit) return;
  res.json(db.prepare(`SELECT id, action, device_id, old_device_id, component_role,
    config_version, status, created_at, gateway_applied_at, first_seen_at
    FROM kit_device_operations WHERE kit_id = ? ORDER BY id DESC LIMIT 30`).all(kit.id));
}

function createOperation(req, res) {
  const kit = ownKit(req, res);
  if (!kit) return;
  if (!kit.gateway_control_secret_ciphertext) {
    return res.status(409).json({ error: 'El Gateway todavía no tiene aprovisionamiento dinámico' });
  }
  const action = String(req.body?.action || '');
  if (!['add', 'replace', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'Acción inválida' });
  }
  const oldDeviceId = String(req.body?.deviceId || '').trim();
  const code = String(req.body?.activationCode || '').trim();
  if (action !== 'add' && !oldDeviceId) return res.status(400).json({ error: 'Selecciona un nodo del kit' });
  if (action !== 'remove' && !/^[A-Za-z0-9-]{20,128}$/.test(code)) {
    return res.status(400).json({ error: 'Código de activación inválido' });
  }
  try {
    const operation = db.transaction(() => {
      const old = action === 'add' ? null : db.prepare(`SELECT * FROM kit_devices
        WHERE kit_id = ? AND device_id = ? AND desired_state = 'active'`).get(kit.id, oldDeviceId);
      if (action !== 'add' && !old) throw Object.assign(new Error('Nodo fuera del kit'), { status: 404 });
      const factory = action === 'remove' ? null : db.prepare(`SELECT * FROM factory_nodes
        WHERE kit_id = ? AND activation_hash = ? AND assigned_at IS NULL`)
        .get(kit.id, activationHash(code));
      if (action !== 'remove' && !factory) {
        throw Object.assign(new Error('Placa no aprovisionada para este kit o código ya utilizado'), { status: 403 });
      }
      const occupied = db.prepare(`SELECT COUNT(*) AS n FROM kit_devices
        WHERE kit_id = ? AND desired_state = 'active'`).get(kit.id).n;
      if (action === 'add' && occupied >= MAX_PEERS) {
        throw Object.assign(new Error(`El Gateway admite hasta ${MAX_PEERS} nodos`), { status: 409 });
      }
      const role = old?.component_role || (() => {
        const used = new Set(db.prepare(`SELECT component_role FROM kit_devices
          WHERE kit_id = ? AND desired_state = 'active'`).all(kit.id).map((row) => row.component_role));
        for (let i = 1; i <= MAX_PEERS; i += 1) if (!used.has(`node_${i}`)) return `node_${i}`;
        return null;
      })();
      if (!role) throw Object.assign(new Error('No hay espacio para otro nodo'), { status: 409 });
      const version = db.prepare(`UPDATE kits SET config_version = config_version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING config_version`).get(kit.id).config_version;
      if (old) {
        db.prepare(`UPDATE kit_device_operations SET status = 'superseded'
          WHERE kit_id = ? AND device_id = ? AND status IN ('pending_gateway', 'awaiting_telemetry')`)
          .run(kit.id, old.device_id);
        db.prepare(`UPDATE kit_devices SET desired_state = 'removed', desired_version = ?,
          hmac_key = '', lmk_hex = NULL WHERE id = ?`)
          .run(version, old.id);
        db.prepare(`UPDATE nodos SET estado = 'bloqueado', admission_status = 'revoked',
          clave_actual = NULL, clave_anterior = NULL WHERE device_id = ?`)
          .run(old.device_id);
        db.prepare("UPDATE factory_nodes SET hmac_key = '', lmk_hex = '' WHERE device_id = ? AND assigned_at IS NOT NULL")
          .run(old.device_id);
      }
      if (factory) {
        db.prepare(`INSERT INTO kit_devices
          (kit_id, device_id, mac_address, hmac_key, lmk_hex, component_role,
            identifier_type, desired_state, desired_version)
          VALUES (?, ?, ?, ?, ?, ?, 'id', 'active', ?)`).run(
          kit.id, factory.device_id, factory.mac_address, factory.hmac_key,
          factory.lmk_hex, role, version);
        db.prepare('UPDATE factory_nodes SET assigned_at = CURRENT_TIMESTAMP WHERE id = ?').run(factory.id);
        db.prepare(`INSERT INTO nodos
          (device_id, mac_address, descripcion, estado, clave_actual, admission_status, ultima_actividad)
          VALUES (?, ?, ?, 'pendiente', ?, 'pending', NULL)`).run(
          factory.device_id, factory.mac_address, `Kit ${kit.gateway_id}`, factory.hmac_key);
      }
      const deviceId = factory?.device_id || old.device_id;
      const created = db.prepare(`INSERT INTO kit_device_operations
        (kit_id, action, device_id, old_device_id, component_role, config_version, requested_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        kit.id, action, deviceId, action === 'replace' ? old.device_id : null,
        role, version, req.usuario.id);
      db.prepare(`INSERT INTO admin_audit_log
        (actor_user_id, action, entity_type, entity_id, metadata_json)
        VALUES (?, ?, 'kit', ?, ?)`).run(req.usuario.id,
          `kit.node_${action}`, String(kit.id), JSON.stringify({ deviceId, oldDeviceId: old?.device_id, role, version }));
      return { id: Number(created.lastInsertRowid), action, deviceId, configVersion: version,
        status: 'pending_gateway' };
    })();
    emitEstadoRed();
    res.status(202).json(operation);
  } catch (error) {
    res.status(error.status || (String(error.message).includes('UNIQUE constraint') ? 409 : 500))
      .json({ error: error.status ? error.message : 'No se pudo actualizar el kit' });
  }
}

// The owner can replace the physical board in a slot after removing its old
// node registration. The logical device ID and provisioned key stay in that slot.
function replaceNodeHardware(req, res) {
  const kit = ownKit(req, res);
  if (!kit) return;
  if (kit.gateway_control_secret_ciphertext) {
    return res.status(409).json({ error: 'Usa el flujo de reemplazo con código de activación' });
  }
  if (!isAdvanced(req.usuario.id)) return res.status(403).json({ error: 'Acceso técnico requerido' });
  const mac = normalizeMac(req.body?.macAddress);
  if (!mac) return res.status(400).json({ error: 'MAC física inválida' });
  const deviceId = req.params.deviceId;
  try {
    const updated = db.transaction(() => {
      const current = db.prepare(`SELECT id, device_id, mac_address, component_role
        FROM kit_devices WHERE kit_id = ? AND device_id = ?`).get(kit.id, deviceId);
      if (!current) return { status: 404, error: 'Nodo fuera del kit' };
      if (current.mac_address === mac) return { status: 409, error: 'La MAC nueva es igual a la actual' };
      if (db.prepare('SELECT id FROM nodos WHERE device_id = ?').get(deviceId)) {
        return { status: 409, error: 'Elimina primero el registro del nodo anterior en Gestión de nodos' };
      }
      if (db.prepare('SELECT id FROM kit_devices WHERE mac_address = ?').get(mac) ||
          db.prepare('SELECT id FROM nodos WHERE mac_address = ?').get(mac)) {
        return { status: 409, error: 'La MAC ya está registrada' };
      }
      db.prepare('DELETE FROM device_requests WHERE kit_device_id = ?').run(current.id);
      db.prepare(`UPDATE kit_devices SET mac_address = ?, detected_at = NULL,
        detected_transport = NULL WHERE id = ?`).run(mac, current.id);
      db.prepare(`INSERT INTO admin_audit_log
        (actor_user_id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'kit.node_hardware_replaced', 'kit', ?, ?)`).run(req.usuario.id, String(kit.id),
          JSON.stringify({ deviceId, role: current.component_role, oldMac: current.mac_address, newMac: mac }));
      return { deviceId, componentRole: current.component_role, macAddress: mac };
    })();
    if (updated.error) return res.status(updated.status).json({ error: updated.error });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo sustituir la placa del kit' });
  }
}

function reportCandidate(req, res) {
  const { deviceId, macAddress, transport, nonce } = req.body || {};
  const mac = normalizeMac(macAddress);
  if (!deviceId || !mac || !['wifi', 'ble'].includes(transport) || !Number.isInteger(nonce)) {
    return res.status(400).json({ error: 'Reporte de descubrimiento inválido' });
  }
  const device = db.prepare(`SELECT d.*, k.gateway_id, k.scan_until FROM kit_devices d JOIN kits k ON k.id = d.kit_id
    WHERE d.device_id = ? AND d.mac_address = ? AND d.desired_state = 'active'`).get(deviceId, mac);
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
  if (kit.gateway_control_secret_ciphertext) {
    return res.status(409).json({ error: 'Usa la incorporación con código de activación' });
  }
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
  if (db.prepare('SELECT gateway_control_secret_ciphertext FROM kits WHERE id = ?')
    .get(record.kit_id)?.gateway_control_secret_ciphertext) {
    return res.status(409).json({ error: 'El kit usa incorporación dinámica' });
  }
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
      db.prepare(`INSERT INTO admin_audit_log
        (actor_user_id, action, entity_type, entity_id, metadata_json)
        VALUES (?, ?, 'device_request', ?, ?)`)
        .run(req.usuario.id, approve ? 'device.approved' : 'device.rejected', String(id),
          JSON.stringify({ deviceId: record.device_id, kitId: record.kit_id, reason }));
    })();
  } catch (error) { return res.status(409).json({ error: error.message }); }
  emitEstadoRed();
  res.json({ id, status: approve ? 'approved' : 'rejected' });
}

module.exports = { listKits, claimKit, startScan, listCandidates, listInventory, reportCandidate,
  createRequest, listRequests, decide, replaceNodeHardware, listOperations, createOperation,
  normalizeMac, hashCode };
