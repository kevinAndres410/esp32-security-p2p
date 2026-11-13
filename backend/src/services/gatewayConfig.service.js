const crypto = require('crypto');
const db = require('../models/db');
const { decryptSecret } = require('../crypto/secretVault');

const MAX_PEERS = 7; // ESP32 build config: ESP_WIFI_ESPNOW_MAX_ENCRYPT_NUM=7.
const HEX_64 = /^[a-f0-9]{64}$/i;
const HEX_32 = /^[a-f0-9]{32}$/i;
const MAC = /^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i;

function controlKey(kit) {
  if (!kit?.gateway_control_secret_ciphertext) return null;
  const secret = decryptSecret(kit.gateway_control_secret_ciphertext);
  return HEX_64.test(secret || '') ? Buffer.from(secret, 'hex') : null;
}

function signed(kit, message, signature) {
  const key = controlKey(kit);
  if (!key || !HEX_64.test(signature || '')) return false;
  const expected = crypto.createHmac('sha256', key.toString('hex')).update(message).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function desiredPeers(kitId) {
  const peers = db.prepare(`SELECT d.device_id, d.mac_address, d.lmk_hex,
    COALESCE(n.clave_actual, d.hmac_key) AS hmac_key, n.clave_anterior
    FROM kit_devices d LEFT JOIN nodos n ON n.device_id = d.device_id
    WHERE d.kit_id = ? AND d.desired_state = 'active' ORDER BY d.id`).all(kitId);
  if (peers.length > MAX_PEERS) throw new Error(`El Gateway admite hasta ${MAX_PEERS} nodos cifrados`);
  if (peers.some((peer) => !MAC.test(peer.mac_address) || !HEX_64.test(peer.hmac_key || '') ||
      !HEX_32.test(peer.lmk_hex || '') ||
      (peer.clave_anterior && !HEX_64.test(peer.clave_anterior)))) {
    throw new Error('El kit contiene un nodo sin credenciales de fábrica completas');
  }
  return peers.map((peer) => ({
    deviceId: peer.device_id,
    mac: peer.mac_address,
    key: peer.hmac_key,
    lmk: peer.lmk_hex,
    ...(peer.clave_anterior ? { previousKey: peer.clave_anterior } : {}),
  }));
}

function fetchConfig(req, res) {
  const gatewayId = String(req.headers['x-gateway-id'] || '');
  const nonce = String(req.headers['x-gateway-nonce'] || '');
  const signature = String(req.headers['x-gateway-signature'] || '');
  const kit = db.prepare('SELECT * FROM kits WHERE gateway_id = ?').get(gatewayId);
  if (!HEX_32.test(nonce) || !signed(kit, `config:${gatewayId}:${nonce}`, signature)) {
    return res.status(401).json({ error: 'Gateway no autenticado' });
  }
  let peers;
  try { peers = desiredPeers(kit.id); }
  catch (error) { return res.status(409).json({ error: error.message }); }
  const inserted = db.prepare(`INSERT OR IGNORE INTO gateway_config_nonces
    (kit_id, nonce, config_version) VALUES (?, ?, ?)`).run(kit.id, nonce.toLowerCase(), kit.config_version);
  if (!inserted.changes) return res.status(409).json({ error: 'Nonce reutilizado' });
  db.prepare(`DELETE FROM gateway_config_nonces WHERE kit_id = ? AND nonce NOT IN
    (SELECT nonce FROM gateway_config_nonces WHERE kit_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 32)`)
    .run(kit.id, kit.id);
  db.prepare('UPDATE kits SET gateway_last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(kit.id);

  const key = controlKey(kit);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${gatewayId}:${nonce.toLowerCase()}:${kit.config_version}`));
  const payload = Buffer.from(JSON.stringify({ version: kit.config_version, peers }));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  res.json({ version: kit.config_version, iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'), ciphertext: encrypted.toString('hex') });
}

function acknowledgeConfig(req, res) {
  const gatewayId = String(req.headers['x-gateway-id'] || '');
  const nonce = String(req.headers['x-gateway-nonce'] || '').toLowerCase();
  const signature = String(req.headers['x-gateway-signature'] || '');
  const version = Number(req.body?.version);
  const kit = db.prepare('SELECT * FROM kits WHERE gateway_id = ?').get(gatewayId);
  if (!Number.isSafeInteger(version) || !HEX_32.test(nonce) ||
      !signed(kit, `ack:${gatewayId}:${version}:${nonce}`, signature)) {
    return res.status(401).json({ error: 'Gateway no autenticado' });
  }
  const issued = db.prepare(`SELECT acked_at FROM gateway_config_nonces
    WHERE kit_id = ? AND nonce = ? AND config_version = ?`).get(kit.id, nonce, version);
  if (!issued || version !== kit.config_version) {
    return res.status(409).json({ error: 'Versión de configuración obsoleta' });
  }
  if (!issued.acked_at) db.transaction(() => {
    db.prepare(`UPDATE gateway_config_nonces SET acked_at = CURRENT_TIMESTAMP
      WHERE kit_id = ? AND nonce = ?`).run(kit.id, nonce);
    db.prepare(`UPDATE kits SET applied_version = ?, gateway_last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(version, kit.id);
    db.prepare(`UPDATE kit_device_operations SET
      status = CASE WHEN action = 'remove' THEN 'removed' ELSE 'awaiting_telemetry' END,
      gateway_applied_at = CURRENT_TIMESTAMP
      WHERE kit_id = ? AND config_version <= ? AND status = 'pending_gateway'`).run(kit.id, version);
    db.prepare(`UPDATE nodos SET admission_status = 'approved'
      WHERE device_id IN (SELECT device_id FROM kit_device_operations
        WHERE kit_id = ? AND config_version <= ? AND action IN ('add', 'replace')
          AND status = 'awaiting_telemetry')`).run(kit.id, version);
  })();
  res.json({ version, applied: true });
}

module.exports = { fetchConfig, acknowledgeConfig, desiredPeers, MAX_PEERS };
