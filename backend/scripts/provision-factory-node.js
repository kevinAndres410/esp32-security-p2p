// Prepare one physical ESP32 for a kit. Flash the generated node1 profile.
// node scripts/provision-factory-node.js <kit-id> <device-id> <board-mac> <gateway-config.c> <output-dir>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/models/db');

const [kitIdText, deviceId, macText, gatewayConfigPath, outputDirText] = process.argv.slice(2);
const kitId = Number(kitIdText);
const macCompact = String(macText || '').replace(/[:-]/g, '').toUpperCase();
if (!Number.isSafeInteger(kitId) || kitId < 1 || !/^[A-Za-z0-9._-]{3,23}$/.test(deviceId || '') ||
    !/^[A-F0-9]{12}$/.test(macCompact) || !gatewayConfigPath || !outputDirText) {
  throw new Error('Uso: node provision-factory-node.js <kit-id> <device-id> <MAC> <gateway-config.c> <output-dir>');
}
const mac = macCompact.match(/.{2}/g).join(':');
const kit = db.prepare('SELECT * FROM kits WHERE id = ?').get(kitId);
if (!kit?.gateway_control_secret_ciphertext) throw new Error('Primero prepara el Gateway del kit');
if (db.prepare('SELECT 1 FROM factory_nodes WHERE device_id = ? OR mac_address = ?').get(deviceId, mac) ||
    db.prepare('SELECT 1 FROM kit_devices WHERE device_id = ? OR mac_address = ?').get(deviceId, mac)) {
  throw new Error('Esta identidad física ya está registrada');
}
const source = fs.readFileSync(path.resolve(gatewayConfigPath), 'utf8');
const byteList = (label, count) => {
  const text = source.match(new RegExp(`const uint8_t ${label}\\[${count}\\]\\s*=\\s*\\{([^}]+)\\}`))?.[1];
  const values = [...String(text || '').matchAll(/0x([a-f0-9]{2})/gi)].map((part) => part[1].toUpperCase());
  if (values.length !== count) throw new Error(`${label} inválida en el firmware del Gateway`);
  return values;
};
const gatewayMac = byteList('GATEWAY_MAC', 6);
const pmk = byteList('ESPNOW_PMK', 16);
if (gatewayMac.join(':') !== kit.gateway_mac.toUpperCase()) throw new Error('La MAC del Gateway no coincide con el kit');
const ssidLiteral = source.match(/const char \*WIFI_SSID\s*=\s*("(?:\\.|[^"\\])*")\s*;/)?.[1];
if (!ssidLiteral) throw new Error('El firmware del Gateway carece de SSID');
const ssid = JSON.parse(ssidLiteral);
const fallbackChannel = Number(source.match(/const uint8_t ESPNOW_CHANNEL\s*=\s*(\d+)\s*;/)?.[1]);
if (!Number.isInteger(fallbackChannel) || fallbackChannel < 1 || fallbackChannel > 14) {
  throw new Error('El firmware del Gateway carece de un canal ESP-NOW válido');
}
const key = crypto.randomBytes(32).toString('hex');
const lmk = crypto.randomBytes(16).toString('hex');
const activationCode = crypto.randomBytes(16).toString('hex').toUpperCase();
const activationHash = crypto.createHash('sha256').update(activationCode).digest('hex');
const cBytes = (values) => values.map((value) => `0x${value}`).join(', ');
const nodeSource = `#include "config.h"
#if DEVICE_PROFILE != 1
#error "Compile this private configuration with -Profile node1"
#endif
const device_role_t DEVICE_ROLE = DEVICE_ROLE_NODE;
const char *DEVICE_ID = ${JSON.stringify(deviceId)};
const char *NODE_HMAC_KEY_HEX = "${key}";
const uint8_t NODE_EXPECTED_MAC[6] = { ${cBytes(macCompact.match(/.{2}/g))} };
const uint8_t GATEWAY_MAC[6] = { ${cBytes(gatewayMac)} };
const uint8_t GATEWAY_LMK[16] = { ${cBytes(lmk.match(/.{2}/g))} };
const uint8_t ESPNOW_PMK[16] = { ${cBytes(pmk)} };
const uint8_t ESPNOW_CHANNEL = ${fallbackChannel};
const char *WIFI_SSID = ${JSON.stringify(ssid)};
const char *WIFI_PASSWORD = "";
const char *UPSTREAM_URL = "";
const char *GATEWAY_CONTROL_KEY_HEX = "";
const node_peer_config_t GATEWAY_PEERS[] = { { 0 } };
const size_t GATEWAY_PEER_COUNT = 0;
`;
const outputDir = path.resolve(outputDirText);
fs.mkdirSync(outputDir, { recursive: true });
const configFile = path.join(outputDir, 'config.c');
const codeFile = path.join(outputDir, 'activation-code.txt');
fs.writeFileSync(configFile, nodeSource, { flag: 'wx' });
try {
  fs.writeFileSync(codeFile, `${activationCode}\n`, { flag: 'wx' });
  db.prepare(`INSERT INTO factory_nodes
    (kit_id, device_id, mac_address, hmac_key, lmk_hex, activation_hash)
    VALUES (?, ?, ?, ?, ?, ?)`).run(kitId, deviceId, mac, key, lmk, activationHash);
} catch (error) {
  fs.rmSync(configFile, { force: true });
  fs.rmSync(codeFile, { force: true });
  throw error;
}
console.log(`Placa ${deviceId} preparada para kit ${kitId}. Firmware: ${configFile}`);
console.log(`Código de activación privado: ${codeFile}`);
db.close();
