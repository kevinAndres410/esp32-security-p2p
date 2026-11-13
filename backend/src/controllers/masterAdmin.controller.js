const crypto = require('crypto');
const db = require('../models/db');
const { encryptSecret, decryptSecret } = require('../crypto/secretVault');
const { validateWifiInput, testWifiConnection, applyWifiConfiguration } = require('../services/wifiProvisioning.service');
const { normalizeMac, hashCode } = require('./kits.controller');

const KIT_STATUSES = new Set(['active', 'inactive']);

function audit(userId, action, entityType, entityId, metadata = {}) {
  db.prepare(`INSERT INTO admin_audit_log
    (actor_user_id, action, entity_type, entity_id, metadata_json)
    VALUES (?, ?, ?, ?, ?)`)
    .run(userId, action, entityType, entityId ? String(entityId) : null, JSON.stringify(metadata));
}

function identifierType(value) {
  if (normalizeMac(value)) return 'mac';
  if (/^(SN|SERIAL)[-_:.]/i.test(value)) return 'serial';
  return 'id';
}

function validateIdentifier(value, label) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{2,79}$/.test(normalized)) {
    throw new Error(`${label} debe tener entre 3 y 80 caracteres válidos`);
  }
  return normalized;
}

function compatibilityAddress(identifier) {
  return normalizeMac(identifier) || `ID:${crypto.createHash('sha256').update(identifier.toUpperCase()).digest('hex').slice(0, 24).toUpperCase()}`;
}

function isNodeConnected(identifier, detectedAt = null) {
  const recentActivity = db.prepare(`SELECT 1 AS connected FROM nodos
    WHERE device_id = ? COLLATE NOCASE AND ultima_actividad IS NOT NULL
    AND (julianday('now') - julianday(ultima_actividad)) * 86400 <= 45`).get(identifier);
  const recentDiscovery = detectedAt && db.prepare(`SELECT 1 AS connected
    WHERE (julianday('now') - julianday(?)) * 86400 <= 120`).get(detectedAt);
  return Boolean(recentActivity || recentDiscovery);
}

function isGatewayConnected(kit) {
  const recentSync = kit.gateway_last_seen_at && db.prepare(`SELECT 1 AS connected
    WHERE (julianday('now') - julianday(?)) * 86400 <= 45`).get(kit.gateway_last_seen_at);
  if (recentSync) return true;
  return db.prepare(`SELECT d.device_id, d.detected_at FROM kit_devices d WHERE d.kit_id = ?`)
    .all(kit.id).some((node) => isNodeConnected(node.device_id, node.detected_at));
}

function ensureIdentifierAvailable(identifier) {
  const address = compatibilityAddress(identifier);
  const registeredGateway = db.prepare(`SELECT id FROM kits
    WHERE gateway_id = ? COLLATE NOCASE OR gateway_mac = ?`).get(identifier, address);
  const registeredNode = db.prepare(`SELECT id FROM kit_devices
    WHERE device_id = ? COLLATE NOCASE OR mac_address = ?`).get(identifier, address);
  const admittedNode = db.prepare(`SELECT id FROM nodos
    WHERE device_id = ? COLLATE NOCASE OR mac_address = ?`).get(identifier, address);
  if (registeredGateway || registeredNode || admittedNode) {
    const error = new Error(`El dispositivo ${identifier} ya está registrado`);
    error.status = 409;
    throw error;
  }
  const recentTelemetry = db.prepare(`SELECT 1 AS connected FROM muestras_rendimiento
    WHERE device_id = ? COLLATE NOCASE AND
    (julianday('now') - julianday(recibido_en)) * 86400 <= 45 LIMIT 1`).get(identifier);
  if (recentTelemetry) componentConflict(`El dispositivo ${identifier} registra actividad reciente; espera a que se desconecte`);
}

function validateComponentIdentities(gateway, nodes) {
  const identities = [gateway, ...nodes].map(compatibilityAddress);
  if (new Set(identities).size !== 4) {
    const error = new Error('Los cuatro identificadores deben ser diferentes');
    error.status = 400;
    throw error;
  }
}

function componentConflict(message) {
  const error = new Error(message);
  error.status = 409;
  throw error;
}

function generateKitKey(id) {
  return `KIT-${id}-${crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, '').toUpperCase()}`;
}

function getWifi(req, res) {
  const config = db.prepare(`SELECT ssid, security_type, connection_status, last_tested_at,
    last_error, updated_at, password_ciphertext IS NOT NULL AS password_configured
    FROM wifi_config WHERE id = 1`).get();
  if (!config) return res.json({
    ssid: '', securityType: 'WPA2', connectionStatus: 'disconnected', passwordConfigured: false,
    gatewayAdapterConfigured: Boolean(process.env.WIFI_PROVISIONING_URL),
  });
  res.json({
    ssid: config.ssid,
    securityType: config.security_type,
    connectionStatus: config.connection_status,
    passwordConfigured: Boolean(config.password_configured),
    lastTestedAt: config.last_tested_at,
    lastError: config.last_error,
    updatedAt: config.updated_at,
    gatewayAdapterConfigured: Boolean(process.env.WIFI_PROVISIONING_URL),
  });
}

function listWifiNetworks(req, res) {
  const networks = db.prepare(`SELECT n.id, n.ssid, n.security_type, n.created_at, n.updated_at,
    n.password_ciphertext IS NOT NULL AS password_configured,
    COUNT(k.id) AS kit_count
    FROM wifi_networks n LEFT JOIN kits k ON k.wifi_network_id = n.id
    GROUP BY n.id ORDER BY n.ssid COLLATE NOCASE`).all();
  res.json(networks.map((network) => ({
    id: network.id,
    ssid: network.ssid,
    securityType: network.security_type,
    passwordConfigured: Boolean(network.password_configured),
    kitCount: network.kit_count,
    createdAt: network.created_at,
    updatedAt: network.updated_at,
  })));
}

function saveWifi(req, res) {
  const current = db.prepare('SELECT * FROM wifi_config WHERE id = 1').get();
  const ssid = String(req.body?.ssid || '').trim();
  const existingNetwork = db.prepare('SELECT * FROM wifi_networks WHERE ssid = ?').get(ssid);
  let password = String(req.body?.password || '');
  if (!password && existingNetwork?.password_ciphertext) password = decryptSecret(existingNetwork.password_ciphertext);
  else if (!password && current?.ssid === ssid && current.password_ciphertext) password = decryptSecret(current.password_ciphertext);
  let input;
  try { input = validateWifiInput({ ...req.body, password }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const cipher = input.password ? encryptSecret(input.password) : null;
  db.transaction(() => {
    db.prepare(`INSERT INTO wifi_networks (ssid, password_ciphertext, security_type)
      VALUES (?, ?, ?) ON CONFLICT(ssid) DO UPDATE SET
      password_ciphertext = excluded.password_ciphertext,
      security_type = excluded.security_type, updated_at = CURRENT_TIMESTAMP`)
      .run(input.ssid, cipher, input.securityType);
    db.prepare(`INSERT INTO wifi_config
      (id, ssid, password_ciphertext, security_type, connection_status, updated_by, updated_at)
      VALUES (1, ?, ?, ?, 'saved', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET ssid = excluded.ssid,
        password_ciphertext = excluded.password_ciphertext,
        security_type = excluded.security_type,
        connection_status = 'saved', last_error = NULL,
        updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
      .run(input.ssid, cipher, input.securityType, req.usuario.id);
  })();
  audit(req.usuario.id, 'wifi.updated', 'wifi_config', 1, { ssid: input.ssid, securityType: input.securityType });
  res.json({ message: 'Configuración guardada de forma segura.', connectionStatus: 'saved' });
}

async function testWifi(req, res) {
  const current = db.prepare('SELECT * FROM wifi_config WHERE id = 1').get();
  let password = String(req.body?.password || '');
  if (!password && current?.password_ciphertext && current.ssid === String(req.body?.ssid || '').trim()) {
    password = decryptSecret(current.password_ciphertext);
  }
  let input;
  try { input = validateWifiInput({ ...req.body, password }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const result = await testWifiConnection(input);
  const testingStoredCredentials = current && current.ssid === input.ssid &&
    (!req.body?.password || input.password === decryptSecret(current.password_ciphertext));
  if (testingStoredCredentials) {
    db.prepare(`UPDATE wifi_config SET connection_status = ?, last_tested_at = CURRENT_TIMESTAMP,
      last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
      .run(result.ok ? 'test_ok' : result.status, result.ok ? null : result.message);
  }
  audit(req.usuario.id, 'wifi.tested', 'wifi_config', 1, { ssid: input.ssid, ok: result.ok, status: result.status });
  // La solicitud HTTP fue procesada; `status` expresa el resultado real de la
  // prueba (incluido `unavailable`) para que la UI pueda representarlo.
  res.json(result);
}

async function applyWifi(req, res) {
  const current = db.prepare('SELECT * FROM wifi_config WHERE id = 1').get();
  if (!current) return res.status(409).json({ error: 'Guarda primero una configuración Wi-Fi' });
  let input;
  try {
    input = validateWifiInput({
      ssid: current.ssid, securityType: current.security_type,
      password: decryptSecret(current.password_ciphertext) || '',
    });
  } catch (error) { return res.status(409).json({ error: error.message }); }
  const result = await applyWifiConfiguration(input);
  db.prepare(`UPDATE wifi_config SET connection_status = ?, last_error = ?,
    last_tested_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .run(result.status, result.ok ? null : result.message);
  audit(req.usuario.id, 'wifi.applied', 'wifi_config', 1, { ssid: current.ssid, ok: result.ok });
  res.json(result);
}

function serializeKit(row) {
  const components = db.prepare(`SELECT id, device_id AS identifier, identifier_type, component_role,
    detected_at FROM kit_devices WHERE kit_id = ? AND desired_state = 'active'
    ORDER BY component_role`).all(row.id);
  for (const component of components) component.connected = isNodeConnected(component.identifier, component.detected_at);
  const activeNodes = db.prepare(`SELECT COUNT(*) AS total FROM kit_devices d
    JOIN nodos n ON n.device_id = d.device_id WHERE d.kit_id = ? AND d.desired_state = 'active'
    AND n.admission_status = 'approved' AND n.estado NOT IN ('bloqueado', 'pendiente')
    AND n.ultima_actividad IS NOT NULL
    AND (julianday('now') - julianday(n.ultima_actividad)) * 86400 <= 45`).get(row.id).total;
  const gatewayConnected = isGatewayConnected(row);
  const expectedCount = row.gateway_control_secret_ciphertext ? components.length : 3;
  const online = row.status === 'active' && expectedCount > 0 &&
    components.length === expectedCount && activeNodes === expectedCount && gatewayConnected;
  let uniqueKey = null;
  if (row.unique_key_ciphertext) {
    try { uniqueKey = decryptSecret(row.unique_key_ciphertext); } catch { uniqueKey = null; }
  }
  return {
    id: row.id,
    name: row.display_name || `Kit ${row.id}`,
    uniqueKey,
    gatewayIdentifier: row.gateway_id,
    gatewayConnected,
    components,
    status: online ? 'online' : row.status,
    notes: row.notes || '',
    ownerUserId: row.owner_user_id,
    wifiNetworkId: row.wifi_network_id,
    wifiSsid: row.wifi_ssid || null,
    wifiSecurityType: row.wifi_security_type || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listAdminKits(req, res) {
  const query = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || 'all').toLowerCase();
  let kits = db.prepare(`SELECT k.*, w.ssid AS wifi_ssid, w.security_type AS wifi_security_type
    FROM kits k LEFT JOIN wifi_networks w ON w.id = k.wifi_network_id ORDER BY k.id DESC`).all().map(serializeKit);
  if (query) kits = kits.filter((kit) => [
    kit.id, kit.name, kit.uniqueKey, kit.gatewayIdentifier, kit.wifiSsid,
    ...kit.components.map((component) => component.identifier),
  ].some((value) => String(value || '').toLowerCase().includes(query)));
  if (status !== 'all') kits = kits.filter((kit) => kit.status === status);
  res.json(kits);
}

function getAdminKit(req, res) {
  const row = db.prepare(`SELECT k.*, w.ssid AS wifi_ssid, w.security_type AS wifi_security_type
    FROM kits k LEFT JOIN wifi_networks w ON w.id = k.wifi_network_id WHERE k.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Kit no encontrado' });
  res.json(serializeKit(row));
}

function createAdminKit(req, res) {
  let gateway;
  let nodes;
  try {
    gateway = validateIdentifier(req.body?.gatewayIdentifier, 'El Gateway');
    nodes = Array.isArray(req.body?.nodeIdentifiers) ? req.body.nodeIdentifiers.map((value, index) =>
      validateIdentifier(value, `El Nodo ${index + 1}`)) : [];
  } catch (error) { return res.status(400).json({ error: error.message }); }
  if (nodes.length !== 3) return res.status(400).json({ error: 'Un kit requiere exactamente tres nodos' });
  const wifiNetworkId = Number(req.body?.wifiNetworkId);
  if (!Number.isSafeInteger(wifiNetworkId) || wifiNetworkId < 1 ||
      !db.prepare('SELECT id FROM wifi_networks WHERE id = ?').get(wifiNetworkId)) {
    return res.status(400).json({ error: 'Selecciona una red Wi-Fi registrada para el kit' });
  }
  try { validateComponentIdentities(gateway, nodes); }
  catch (error) { return res.status(error.status).json({ error: error.message }); }

  try {
    const createdKit = db.transaction(() => {
      [gateway, ...nodes].forEach(ensureIdentifierAvailable);
      const placeholder = crypto.randomBytes(32).toString('hex');
      const created = db.prepare(`INSERT INTO kits
        (gateway_id, gateway_mac, claim_code_hash, status, notes, wifi_network_id, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP)`)
        .run(gateway, compatibilityAddress(gateway), placeholder, String(req.body?.notes || '').trim().slice(0, 500) || null, wifiNetworkId);
      const kitId = Number(created.lastInsertRowid);
      const uniqueKey = generateKitKey(kitId);
      db.prepare(`UPDATE kits SET display_name = ?, claim_code_hash = ?, unique_key_ciphertext = ? WHERE id = ?`)
        .run(`Kit ${kitId}`, hashCode(uniqueKey), encryptSecret(uniqueKey), kitId);
      const insert = db.prepare(`INSERT INTO kit_devices
        (kit_id, device_id, mac_address, hmac_key, component_role, identifier_type)
        VALUES (?, ?, ?, ?, ?, ?)`);
      nodes.forEach((identifier, index) => insert.run(
        kitId,
        identifier,
        compatibilityAddress(identifier),
        crypto.randomBytes(32).toString('hex'),
        `node_${index + 1}`,
        identifierType(identifier),
      ));
      audit(req.usuario.id, 'kit.created', 'kit', kitId, { gateway, nodes, wifiNetworkId });
      return { id: kitId, uniqueKey };
    })();
    const row = db.prepare(`SELECT k.*, w.ssid AS wifi_ssid, w.security_type AS wifi_security_type
      FROM kits k LEFT JOIN wifi_networks w ON w.id = k.wifi_network_id WHERE k.id = ?`).get(createdKit.id);
    res.status(201).json(serializeKit(row));
  } catch (error) {
    const duplicate = String(error.message).includes('UNIQUE constraint failed');
    res.status(error.status || (duplicate ? 409 : 500)).json({ error: error.status ? error.message : duplicate ? 'Uno de los identificadores ya está registrado' : 'No se pudo crear el kit' });
  }
}

function updateAdminKit(req, res) {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM kits WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Kit no encontrado' });
  const status = String(req.body?.status || current.status).toLowerCase();
  if (!KIT_STATUSES.has(status)) return res.status(400).json({ error: 'Estado inválido' });
  const notes = String(req.body?.notes ?? current.notes ?? '').trim().slice(0, 500);
  const wifiNetworkId = req.body?.wifiNetworkId === undefined ? current.wifi_network_id : Number(req.body.wifiNetworkId);
  if (!Number.isSafeInteger(wifiNetworkId) || wifiNetworkId < 1 ||
      !db.prepare('SELECT id FROM wifi_networks WHERE id = ?').get(wifiNetworkId)) {
    return res.status(400).json({ error: 'Selecciona una red Wi-Fi registrada para el kit' });
  }
  const changesComponents = req.body?.gatewayIdentifier !== undefined || req.body?.nodeIdentifiers !== undefined;
  let gateway;
  let nodes;
  if (changesComponents) {
    try {
      gateway = validateIdentifier(req.body?.gatewayIdentifier, 'El Gateway');
      nodes = Array.isArray(req.body?.nodeIdentifiers) ? req.body.nodeIdentifiers.map((value, index) =>
        validateIdentifier(value, `El Nodo ${index + 1}`)) : [];
      if (nodes.length !== 3) return res.status(400).json({ error: 'El kit debe conservar exactamente tres nodos' });
      validateComponentIdentities(gateway, nodes);
    } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  }
  try {
    db.transaction(() => {
      const kit = db.prepare('SELECT * FROM kits WHERE id = ?').get(id);
      const existing = db.prepare(`SELECT id, device_id, mac_address, detected_at, component_role
        FROM kit_devices WHERE kit_id = ?`).all(id);
      const byRole = new Map(existing.map((component) => [component.component_role, component]));
      const gatewayChanged = changesComponents && compatibilityAddress(gateway) !== kit.gateway_mac;
      const replacements = changesComponents ? nodes.map((identifier, index) => {
        const old = byRole.get(`node_${index + 1}`);
        return { identifier, index, old, changed: !old || compatibilityAddress(identifier) !== old.mac_address };
      }) : [];
      if (kit.gateway_control_secret_ciphertext &&
          (gatewayChanged || replacements.some((replacement) => replacement.changed))) {
        componentConflict('Gestiona las placas desde Mis dispositivos; el Gateway usa configuración dinámica');
      }

      if (gatewayChanged && isGatewayConnected(kit)) {
        componentConflict('Desconecta el Gateway y espera a que cese su actividad antes de reemplazarlo');
      }
      for (const replacement of replacements) {
        if (replacement.changed && replacement.old &&
            isNodeConnected(replacement.old.device_id, replacement.old.detected_at)) {
          componentConflict(`El Nodo ${replacement.index + 1} está conectado; no se puede retirar`);
        }
      }
      if (gatewayChanged) ensureIdentifierAvailable(gateway);
      for (const replacement of replacements) {
        if (replacement.changed) ensureIdentifierAvailable(replacement.identifier);
      }

      for (const replacement of replacements) {
        if (!replacement.changed || !replacement.old) continue;
        db.prepare('DELETE FROM device_requests WHERE kit_device_id = ?').run(replacement.old.id);
        db.prepare('DELETE FROM nodos WHERE device_id = ?').run(replacement.old.device_id);
        db.prepare('DELETE FROM kit_devices WHERE id = ?').run(replacement.old.id);
      }
      const insert = db.prepare(`INSERT INTO kit_devices
        (kit_id, device_id, mac_address, hmac_key, component_role, identifier_type)
        VALUES (?, ?, ?, ?, ?, ?)`);
      for (const replacement of replacements) {
        if (!replacement.changed) continue;
        insert.run(id, replacement.identifier, compatibilityAddress(replacement.identifier),
          crypto.randomBytes(32).toString('hex'), `node_${replacement.index + 1}`,
          identifierType(replacement.identifier));
      }
      db.prepare(`UPDATE kits SET gateway_id = ?, gateway_mac = ?, status = ?, notes = ?,
        wifi_network_id = ?, gateway_last_seen_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(gatewayChanged ? gateway : kit.gateway_id,
          gatewayChanged ? compatibilityAddress(gateway) : kit.gateway_mac,
          status, notes || null, wifiNetworkId,
          gatewayChanged ? null : kit.gateway_last_seen_at, id);
      audit(req.usuario.id, 'kit.updated', 'kit', id, {
        status, wifiNetworkId,
        ...(changesComponents ? {
          gateway: gatewayChanged ? { previous: kit.gateway_id, current: gateway } : undefined,
          nodes: replacements.filter((item) => item.changed).map((item) => ({
            role: `node_${item.index + 1}`, previous: item.old?.device_id || null, current: item.identifier,
          })),
        } : {}),
      });
    })();
    res.json(serializeKit(db.prepare(`SELECT k.*, w.ssid AS wifi_ssid, w.security_type AS wifi_security_type
      FROM kits k LEFT JOIN wifi_networks w ON w.id = k.wifi_network_id WHERE k.id = ?`).get(id)));
  } catch (error) {
    const duplicate = String(error.message).includes('UNIQUE constraint failed');
    res.status(error.status || (duplicate ? 409 : 500)).json({ error: error.status ? error.message : duplicate ? 'Uno de los dispositivos ya está registrado' : 'No se pudo actualizar el kit' });
  }
}

async function applyKitWifi(req, res) {
  const kit = db.prepare(`SELECT k.id, k.gateway_id, w.ssid, w.security_type, w.password_ciphertext
    FROM kits k LEFT JOIN wifi_networks w ON w.id = k.wifi_network_id WHERE k.id = ?`).get(req.params.id);
  if (!kit) return res.status(404).json({ error: 'Kit no encontrado' });
  if (!kit.ssid) return res.status(409).json({ error: 'Asigna una red Wi-Fi al kit antes de aplicarla' });
  let config;
  try {
    config = validateWifiInput({
      ssid: kit.ssid,
      securityType: kit.security_type,
      password: decryptSecret(kit.password_ciphertext) || '',
    });
  } catch (error) { return res.status(409).json({ error: `La red del kit no se puede aplicar: ${error.message}` }); }
  const result = await applyWifiConfiguration({ ...config, gatewayIdentifier: kit.gateway_id, kitId: kit.id });
  audit(req.usuario.id, 'kit.wifi.applied', 'kit', kit.id, { ssid: kit.ssid, ok: result.ok });
  res.json(result);
}

function deleteAdminKit(req, res) {
  const id = Number(req.params.id);
  const kit = db.prepare('SELECT * FROM kits WHERE id = ?').get(id);
  if (!kit) return res.status(404).json({ error: 'Kit no encontrado' });
  if (kit.gateway_control_secret_ciphertext &&
      (kit.applied_version < kit.config_version || db.prepare(`SELECT 1 FROM kit_devices
        WHERE kit_id = ? AND desired_state = 'active' LIMIT 1`).get(id))) {
    return res.status(409).json({ error: 'Retira todos los nodos y espera la confirmación del Gateway antes de eliminar el kit' });
  }
  const devices = db.prepare('SELECT id, device_id FROM kit_devices WHERE kit_id = ?').all(id);
  db.transaction(() => {
    for (const device of devices) {
      db.prepare('DELETE FROM device_requests WHERE kit_device_id = ?').run(device.id);
      db.prepare('DELETE FROM nodos WHERE device_id = ?').run(device.device_id);
    }
    db.prepare('DELETE FROM kit_devices WHERE kit_id = ?').run(id);
    db.prepare('DELETE FROM factory_nodes WHERE kit_id = ?').run(id);
    db.prepare('DELETE FROM kit_device_operations WHERE kit_id = ?').run(id);
    db.prepare('DELETE FROM gateway_config_nonces WHERE kit_id = ?').run(id);
    db.prepare('DELETE FROM kits WHERE id = ?').run(id);
    audit(req.usuario.id, 'kit.deleted', 'kit', id, {
      gateway: kit.gateway_id,
      nodes: devices.map((device) => device.device_id),
    });
  })();
  res.status(204).end();
}

module.exports = {
  getWifi, listWifiNetworks, saveWifi, testWifi, applyWifi, applyKitWifi,
  listAdminKits, getAdminKit, createAdminKit, updateAdminKit, deleteAdminKit,
};
