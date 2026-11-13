// One-time migration of a physical kit. The private config.c is ignored by Git.
// node scripts/prepare-dynamic-kit.js <kit-id> <absolute-or-relative-config.c>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/models/db');
const { encryptSecret, decryptSecret } = require('../src/crypto/secretVault');

const kitId = Number(process.argv[2]);
const configPath = process.argv[3] && path.resolve(process.argv[3]);
if (!Number.isSafeInteger(kitId) || kitId < 1 || !configPath) {
  throw new Error('Uso: node prepare-dynamic-kit.js <kit-id> <config.c>');
}
const kit = db.prepare('SELECT * FROM kits WHERE id = ?').get(kitId);
if (!kit) throw new Error('Kit no encontrado');
const source = fs.readFileSync(configPath, 'utf8');
const peersSource = source.match(/const node_peer_config_t GATEWAY_PEERS\[\] = \{([\s\S]*?)\n\};/)?.[1];
if (!peersSource) throw new Error('config.c no contiene el inventario del Gateway');
const entries = [...peersSource.matchAll(/\.device_id\s*=\s*"([^"]+)"[\s\S]*?\.mac\s*=\s*\{([^}]+)\}[\s\S]*?\.lmk\s*=\s*\{([^}]+)\}[\s\S]*?\.provisioned\s*=\s*true/g)];
const decodeBytes = (text, count) => {
  const values = [...text.matchAll(/0x([a-f0-9]{2})/gi)].map((part) => part[1].toUpperCase());
  if (values.length !== count) throw new Error('MAC o LMK inválida en config.c');
  return values;
};
const peers = entries.map((entry) => ({
  deviceId: entry[1],
  mac: decodeBytes(entry[2], 6).join(':'),
  lmk: decodeBytes(entry[3], 16).join('').toLowerCase(),
}));
const inventory = db.prepare(`SELECT device_id, mac_address FROM kit_devices
  WHERE kit_id = ? AND desired_state = 'active' ORDER BY device_id`).all(kitId);
if (peers.length !== inventory.length || peers.length > 7 ||
    inventory.some((row) => !peers.some((peer) => peer.deviceId === row.device_id &&
      peer.mac === row.mac_address.toUpperCase()))) {
  throw new Error('El inventario del Gateway no coincide con la base de datos');
}
const sourceKey = source.match(/const char \*GATEWAY_CONTROL_KEY_HEX\s*=\s*"([a-f0-9]*)";/i)?.[1];
if (sourceKey === undefined || (sourceKey && !/^[a-f0-9]{64}$/i.test(sourceKey))) {
  throw new Error('La plantilla carece de GATEWAY_CONTROL_KEY_HEX');
}
const storedKey = kit.gateway_control_secret_ciphertext &&
  decryptSecret(kit.gateway_control_secret_ciphertext);
if (storedKey && sourceKey && storedKey.toLowerCase() !== sourceKey.toLowerCase()) {
  throw new Error('La clave de control del firmware y la base de datos no coinciden');
}
const key = storedKey || sourceKey || crypto.randomBytes(32).toString('hex');
const gatewayBranch = /^#if DEVICE_PROFILE == (?:PROFILE_GATEWAY|0)[ \t]*\r?$/m;
const nodeBranches = /^#elif DEVICE_PROFILE == (?:PROFILE_NODE_[123]|[123])[ \t]*\r?$/gm;
if (!gatewayBranch.test(source) || ![...source.matchAll(nodeBranches)].length) {
  throw new Error('config.c no separa los perfiles del Gateway y de los nodos');
}
const withoutDeclarations = source.replace(
  /^[ \t]*const char \*GATEWAY_CONTROL_KEY_HEX\s*=\s*"[a-f0-9]*";[ \t]*\r?\n/gim, '');
const gatewayOnly = withoutDeclarations.replace(gatewayBranch,
  (line) => `${line}\nconst char *GATEWAY_CONTROL_KEY_HEX = "${key}";`);
let updatedSource = gatewayOnly.replace(nodeBranches,
  (line) => `${line}\nconst char *GATEWAY_CONTROL_KEY_HEX = "";`);
if (!updatedSource.includes('/* gateway-only-peer-registry */')) {
  const peerRegistry = updatedSource.match(
    /const node_peer_config_t GATEWAY_PEERS\[\] = \{[\s\S]*?\n\};\r?\nconst size_t GATEWAY_PEER_COUNT\s*=\s*[^;\r\n]+;/)?.[0];
  if (!peerRegistry) throw new Error('No se encontró el registro de pares del Gateway');
  const condition = source.match(gatewayBranch)?.[0].trim().replace(/^#if\s+/, '');
  updatedSource = updatedSource.replace(peerRegistry, `/* gateway-only-peer-registry */
#if ${condition}
${peerRegistry}
#else
const node_peer_config_t GATEWAY_PEERS[] = { { 0 } };
const size_t GATEWAY_PEER_COUNT = 0;
#endif`);
}
if (updatedSource !== source) fs.writeFileSync(configPath, updatedSource);
db.transaction(() => {
  for (const peer of peers) db.prepare(`UPDATE kit_devices SET lmk_hex = ?
    WHERE kit_id = ? AND device_id = ?`).run(peer.lmk, kitId, peer.deviceId);
  if (!storedKey) db.prepare(`UPDATE kits SET gateway_control_secret_ciphertext = ?,
    config_version = CASE WHEN config_version < 1 THEN 1 ELSE config_version END
    WHERE id = ?`).run(encryptSecret(key), kitId);
})();
console.log(`Kit ${kitId}: ${peers.length} pares preparados para configuración dinámica.`);
db.close();
