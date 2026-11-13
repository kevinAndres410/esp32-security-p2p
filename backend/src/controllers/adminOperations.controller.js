const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const db = require('../models/db');
const { decryptSecret } = require('../crypto/secretVault');
const { currentInterval, applyRotationSchedule, SETTING } = require('../services/rotationScheduler.service');

const ROLES = new Set(['basico', 'avanzado']);
const TABLES = [
  'usuarios', 'nodos', 'eventos', 'solicitudes_acceso_avanzado',
  'muestras_rendimiento', 'wifi_networks', 'kits', 'kit_devices', 'device_requests',
  'factory_nodes', 'kit_device_operations', 'gateway_config_nonces',
  'wifi_config', 'admin_audit_log', 'app_settings',
];

function audit(actor, action, entityType, entityId, metadata = {}) {
  db.prepare(`INSERT INTO admin_audit_log
    (actor_user_id, action, entity_type, entity_id, metadata_json)
    VALUES (?, ?, ?, ?, ?)`)
    .run(actor, action, entityType, String(entityId), JSON.stringify(metadata));
}

function intId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function listUsers(req, res) {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
  const rows = db.prepare(`SELECT u.id, u.nombre, u.email, u.rol, u.bloqueado,
    u.estado_acceso_avanzado, u.tiene_conocimiento_tecnico, u.creado_en,
    (SELECT COUNT(*) FROM kits k WHERE k.owner_user_id = u.id) AS kit_count
    FROM usuarios u ORDER BY u.id DESC`).all();
  res.json(rows.filter((user) => !q || `${user.id} ${user.nombre} ${user.email}`.toLowerCase().includes(q)));
}

function updateUser(req, res) {
  const id = intId(req.params.id);
  const user = id && db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const role = req.body?.role === undefined ? user.rol : String(req.body.role);
  const blocked = req.body?.blocked === undefined ? Boolean(user.bloqueado) : req.body.blocked;
  if (user.rol === 'master_admin') {
    return res.status(409).json({ error: 'La cuenta de Administrador Maestro no se puede modificar desde este panel' });
  }
  if (!ROLES.has(role) || typeof blocked !== 'boolean') return res.status(400).json({ error: 'Rol o bloqueo inválido' });
  db.transaction(() => {
    db.prepare(`UPDATE usuarios SET rol = ?, bloqueado = ?, intentos_fallidos = 0,
      token_version = token_version + 1,
      estado_acceso_avanzado = CASE WHEN ? = 'avanzado' THEN 'approved'
        WHEN ? = 'basico' THEN 'none' ELSE estado_acceso_avanzado END
      WHERE id = ?`).run(role, blocked ? 1 : 0, role, role, id);
    audit(req.usuario.id, 'user.updated', 'user', id, { role, blocked });
  })();
  res.json({ id, role, blocked, sessionsRevoked: true });
}

function listAccessRequests(req, res) {
  res.json(db.prepare(`SELECT s.id, s.usuario_id AS userId, u.nombre AS userName,
    u.email, s.estado AS status, s.motivo AS reason, s.solicitado_en AS requestedAt,
    s.revisado_en AS reviewedAt FROM solicitudes_acceso_avanzado s
    JOIN usuarios u ON u.id = s.usuario_id ORDER BY s.id DESC LIMIT 300`).all());
}

function decideAccess(req, res) {
  const id = intId(req.params.id);
  const decision = String(req.body?.decision || '');
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!id || !['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Decisión inválida' });
  if (decision === 'rejected' && !reason) return res.status(400).json({ error: 'Indica un motivo de rechazo' });
  try {
    db.transaction(() => {
      const pending = db.prepare(`SELECT s.*, u.rol FROM solicitudes_acceso_avanzado s
        JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = ?`).get(id);
      if (!pending) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
      if (pending.estado !== 'pending' || pending.rol !== 'basico') throw Object.assign(new Error('Solicitud ya resuelta'), { status: 409 });
      db.prepare(`UPDATE solicitudes_acceso_avanzado SET estado = ?, motivo = ?, revisado_en = CURRENT_TIMESTAMP
        WHERE id = ?`).run(decision, reason || pending.motivo, id);
      db.prepare(`UPDATE usuarios SET rol = ?, estado_acceso_avanzado = ?, token_version = token_version + 1
        WHERE id = ?`).run(decision === 'approved' ? 'avanzado' : 'basico', decision, pending.usuario_id);
      audit(req.usuario.id, 'access.decided', 'access_request', id, { decision, userId: pending.usuario_id, reason });
    })();
  } catch (error) { return res.status(error.status || 500).json({ error: error.message }); }
  res.json({ id, status: decision });
}

function listDeviceRequests(req, res) {
  res.json(db.prepare(`SELECT r.id, r.status, r.method, r.created_at,
    r.decided_at, r.reason, d.device_id, d.mac_address,
    k.id AS kit_id, k.gateway_id, u.nombre AS requester_name
    FROM device_requests r JOIN kit_devices d ON d.id = r.kit_device_id
    JOIN kits k ON k.id = d.kit_id JOIN usuarios u ON u.id = r.requester_user_id
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.id DESC LIMIT 300`).all());
}

function assignKit(req, res) {
  const kitId = intId(req.params.id);
  const ownerId = req.body?.ownerUserId === null ? null : intId(req.body?.ownerUserId);
  if (!kitId || (req.body?.ownerUserId !== null && !ownerId)) return res.status(400).json({ error: 'Usuario o kit inválido' });
  const kit = db.prepare('SELECT id, owner_user_id FROM kits WHERE id = ?').get(kitId);
  if (!kit) return res.status(404).json({ error: 'Kit no encontrado' });
  if (ownerId && !db.prepare('SELECT id FROM usuarios WHERE id = ? AND bloqueado = 0').get(ownerId)) {
    return res.status(404).json({ error: 'Usuario destino no encontrado o bloqueado' });
  }
  db.transaction(() => {
    // Conservar el historial y revocar aprobaciones del propietario anterior.
    db.prepare(`UPDATE device_requests SET status = 'revoked', decided_by = ?,
      decided_at = CURRENT_TIMESTAMP, reason = 'Transferencia de kit'
      WHERE kit_device_id IN (SELECT id FROM kit_devices WHERE kit_id = ?)
      AND status IN ('pending', 'approved')`).run(req.usuario.id, kitId);
    db.prepare(`UPDATE nodos SET admission_status = 'pending', estado = 'pendiente'
      WHERE device_id IN (SELECT device_id FROM kit_devices WHERE kit_id = ?)`).run(kitId);
    db.prepare('UPDATE kits SET owner_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ownerId, kitId);
    audit(req.usuario.id, 'kit.assigned', 'kit', kitId, { previousOwnerId: kit.owner_user_id, ownerUserId: ownerId });
  })();
  res.json({ id: kitId, ownerUserId: ownerId });
}

function getMonitoring(req, res) {
  const counts = {
    users: db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n,
    kits: db.prepare('SELECT COUNT(*) AS n FROM kits').get().n,
    pendingAccess: db.prepare("SELECT COUNT(*) AS n FROM solicitudes_acceso_avanzado WHERE estado = 'pending'").get().n,
    pendingDevices: db.prepare("SELECT COUNT(*) AS n FROM device_requests WHERE status = 'pending'").get().n,
    nodesOnline: db.prepare(`SELECT COUNT(*) AS n FROM nodos WHERE admission_status = 'approved'
      AND estado NOT IN ('bloqueado', 'pendiente') AND ultima_actividad IS NOT NULL
      AND (julianday('now') - julianday(ultima_actividad)) * 86400 <= 45`).get().n,
    nodesOffline: db.prepare(`SELECT COUNT(*) AS n FROM nodos WHERE admission_status = 'approved'
      AND estado != 'bloqueado' AND (ultima_actividad IS NULL OR
      (julianday('now') - julianday(ultima_actividad)) * 86400 > 45)`).get().n,
  };
  const nodes = db.prepare(`SELECT n.device_id, n.estado, n.ultima_actividad,
    k.id AS kit_id, k.gateway_id,
    m.rtt_ms, m.heap_libre_bytes, m.cpu_porcentaje, m.recibido_en
    FROM nodos n LEFT JOIN kit_devices d ON d.device_id = n.device_id
    LEFT JOIN kits k ON k.id = d.kit_id
    LEFT JOIN muestras_rendimiento m ON m.rowid = (
      SELECT rowid FROM muestras_rendimiento WHERE device_id = n.device_id
      ORDER BY recibido_en DESC LIMIT 1)
    ORDER BY n.ultima_actividad ASC LIMIT 300`).all();
  const recentEvents = db.prepare('SELECT id, tipo, mensaje, nodo_id, creado_en FROM eventos ORDER BY id DESC LIMIT 40').all();
  res.json({ counts, nodes, recentEvents, checkedAt: new Date().toISOString() });
}

function listAudit(req, res) {
  const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
  const rows = db.prepare(`SELECT a.id, a.action, a.entity_type, a.entity_id,
    a.metadata_json, a.created_at, u.nombre AS actor_name, u.email AS actor_email
    FROM admin_audit_log a LEFT JOIN usuarios u ON u.id = a.actor_user_id
    ORDER BY a.id DESC LIMIT ?`).all(limit);
  res.json(rows.map(({ metadata_json, ...row }) => ({ ...row, metadata: JSON.parse(metadata_json || '{}') })));
}

function getSettings(req, res) {
  res.json({ rotationMinutes: currentInterval(), gatewayAdapterConfigured: Boolean(process.env.WIFI_PROVISIONING_URL) });
}

function updateSettings(req, res) {
  const minutes = Number(req.body?.rotationMinutes);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) {
    return res.status(400).json({ error: 'El intervalo debe ser de 1 a 1440 minutos' });
  }
  db.transaction(() => {
    db.prepare(`INSERT INTO app_settings (key, value, updated_by)
      VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
      .run(SETTING, String(minutes), req.usuario.id);
    audit(req.usuario.id, 'settings.updated', 'settings', SETTING, { rotationMinutes: minutes });
  })();
  applyRotationSchedule();
  res.json({ rotationMinutes: minutes });
}

function getHealth(req, res) {
  const dbCheck = db.pragma('quick_check', { simple: true });
  res.json({
    backend: 'online', database: dbCheck === 'ok' ? 'ok' : 'error',
    gatewayAdapter: process.env.WIFI_PROVISIONING_URL ? 'configured' : 'unconfigured',
    rotationMinutes: currentInterval(), uptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
  });
}

async function downloadBackup(req, res) {
  const backupPath = path.join(os.tmpdir(), `securemesh-${crypto.randomUUID()}.sqlite`);
  try {
    await db.backup(backupPath);
    audit(req.usuario.id, 'backup.downloaded', 'database', 'full');
    res.download(backupPath, `securemesh-backup-${new Date().toISOString().slice(0, 10)}.sqlite`, () => {
      fs.rm(backupPath, { force: true }, () => {});
    });
  } catch (error) {
    fs.rm(backupPath, { force: true }, () => {});
    res.status(500).json({ error: 'No se pudo crear la copia de seguridad' });
  }
}

async function restoreBackup(req, res) {
  if (req.headers['x-restore-confirmation'] !== 'RESTAURAR') {
    return res.status(400).json({ error: 'Confirmación de restauración requerida' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length < 100 ||
      req.body.subarray(0, 16).toString() !== 'SQLite format 3\0') {
    return res.status(400).json({ error: 'Archivo SQLite inválido' });
  }
  const incomingPath = path.join(os.tmpdir(), `securemesh-incoming-${crypto.randomUUID()}.sqlite`);
  const safetyPath = path.join(os.tmpdir(), `securemesh-before-restore-${crypto.randomUUID()}.sqlite`);
  let candidate;
  try {
    fs.writeFileSync(incomingPath, req.body, { flag: 'wx' });
    candidate = new Database(incomingPath, { readonly: true, fileMustExist: true });
    if (candidate.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Copia corrupta');
    for (const table of TABLES) {
      const source = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!source) throw new Error(`La copia no contiene ${table}`);
      const currentColumns = db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name).join(',');
      const sourceColumns = candidate.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name).join(',');
      if (currentColumns !== sourceColumns) throw new Error('La copia usa una versión de esquema diferente');
    }
    const masters = candidate.prepare("SELECT id FROM usuarios WHERE rol = 'master_admin' AND bloqueado = 0").all();
    if (masters.length !== 1) throw new Error('La copia debe contener exactamente un Administrador Maestro activo');
    const admin = masters[0];
    const wifi = candidate.prepare('SELECT password_ciphertext FROM wifi_config WHERE id = 1').get();
    if (wifi?.password_ciphertext) decryptSecret(wifi.password_ciphertext);
    for (const network of candidate.prepare('SELECT password_ciphertext FROM wifi_networks').all()) {
      if (network.password_ciphertext) decryptSecret(network.password_ciphertext);
    }
    for (const kit of candidate.prepare('SELECT gateway_control_secret_ciphertext FROM kits').all()) {
      if (kit.gateway_control_secret_ciphertext) decryptSecret(kit.gateway_control_secret_ciphertext);
    }
    candidate.close(); candidate = null;
    await db.backup(safetyPath);
    db.exec(`ATTACH DATABASE '${incomingPath.replace(/'/g, "''")}' AS incoming_backup`);
    try {
      db.transaction(() => {
        for (const table of [...TABLES].reverse()) db.prepare(`DELETE FROM main.${table}`).run();
        for (const table of TABLES) db.prepare(`INSERT INTO main.${table} SELECT * FROM incoming_backup.${table}`).run();
        db.prepare('UPDATE usuarios SET token_version = token_version + 1').run();
        const fkErrors = db.pragma('foreign_key_check');
        if (fkErrors.length) throw new Error('La copia contiene relaciones inválidas');
        audit(admin.id, 'backup.restored', 'database', 'full');
      })();
    } finally { db.exec('DETACH DATABASE incoming_backup'); }
    applyRotationSchedule();
    res.json({ restored: true, message: 'Copia restaurada. Vuelve a iniciar sesión.' });
  } catch (error) {
    res.status(400).json({ error: error.message || 'No se pudo restaurar la copia' });
  } finally {
    if (candidate?.open) candidate.close();
    fs.rm(incomingPath, { force: true }, () => {});
    fs.rm(safetyPath, { force: true }, () => {});
  }
}

module.exports = {
  listUsers, updateUser, listAccessRequests, decideAccess,
  listDeviceRequests, assignKit, getMonitoring, listAudit,
  getSettings, updateSettings, getHealth, downloadBackup, restoreBackup,
};
