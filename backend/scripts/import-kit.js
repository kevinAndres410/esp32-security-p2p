// Uso: DB_PATH=... node scripts/import-kit.js ruta-al-manifiesto.json
// El manifiesto se entrega con el kit; no se guarda en Git.
const fs = require('fs');
const path = require('path');
const db = require('../src/models/db');
const { normalizeMac, hashCode } = require('../src/controllers/kits.controller');

const file = process.argv[2];
if (!file) throw new Error('Indica el manifiesto JSON del kit');
const manifest = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const gatewayMac = normalizeMac(manifest.gatewayMac);
if (!/^[a-zA-Z0-9_-]{4,40}$/.test(manifest.gatewayId || '') || !gatewayMac ||
    typeof manifest.claimCode !== 'string' || manifest.claimCode.length < 12 ||
    !Array.isArray(manifest.nodes) || manifest.nodes.length !== 3) {
  throw new Error('Se requiere un Gateway y exactamente tres nodos ESP32 con código de reclamo');
}
const identities = new Set([gatewayMac]);
for (const node of manifest.nodes) {
  const mac = normalizeMac(node.macAddress);
  if (!/^esp32-[a-zA-Z0-9_-]{1,35}$/.test(node.deviceId || '') || !mac ||
      !/^[a-fA-F0-9]{64}$/.test(node.hmacKey || '') || identities.has(mac)) {
    throw new Error('Identidad de nodo inválida o repetida');
  }
  identities.add(mac);
}
const result = db.transaction(() => {
  const created = db.prepare('INSERT INTO kits (gateway_id, gateway_mac, claim_code_hash) VALUES (?, ?, ?)')
    .run(manifest.gatewayId, gatewayMac, hashCode(manifest.claimCode));
  const insertNode = db.prepare(`INSERT INTO kit_devices (kit_id, device_id, mac_address, hmac_key)
    VALUES (?, ?, ?, ?)`);
  for (const node of manifest.nodes) {
    insertNode.run(created.lastInsertRowid, node.deviceId, normalizeMac(node.macAddress), node.hmacKey.toLowerCase());
  }
  return created.lastInsertRowid;
})();
console.log(`Kit ${result} importado: ${manifest.gatewayId}, 3 nodos`);
db.close();
