// Genera solo datos de fabricación; la lógica de los cuatro perfiles es común.
// Uso: node generate_kit_config.js manifiesto.json salida.c
const fs = require('fs');
const path = require('path');
const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) throw new Error('Uso: node generate_kit_config.js manifiesto.json salida.c');
const kit = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
const mac = (value) => {
  const normalized = String(value || '').replace(/[:-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) throw new Error('MAC inválida');
  return normalized.match(/.{2}/g).map((byte) => `0x${byte}`).join(', ');
};
const bytes = (value, count) => {
  if (!new RegExp(`^[0-9a-fA-F]{${count * 2}}$`).test(value || '')) throw new Error(`Se requieren ${count} bytes hexadecimales`);
  return value.match(/.{2}/g).map((byte) => `0x${byte}`).join(', ');
};
const literal = (value) => {
  if (typeof value !== 'string' || /[^\x20-\x7e]/.test(value)) throw new Error('Texto no ASCII en configuración de firmware');
  return JSON.stringify(value);
};
if (!Array.isArray(kit.nodes) || kit.nodes.length !== 3) throw new Error('El kit requiere exactamente tres nodos');
const allMacs = [kit.gatewayMac, ...kit.nodes.map((node) => node.macAddress)].map((item) => mac(item));
if (new Set(allMacs).size !== 4) throw new Error('MAC duplicada en el kit');
const gatewayId = literal(kit.gatewayId);
const nodes = kit.nodes.map((node) => ({
  id: literal(node.deviceId), mac: mac(node.macAddress), key: literal(node.hmacKey), lmk: bytes(node.lmk, 16),
}));
for (const node of kit.nodes) if (!/^[a-fA-F0-9]{64}$/.test(node.hmacKey || '')) throw new Error('Clave HMAC inválida');
const source = `#include "config.h"
#ifndef DEVICE_PROFILE
#define DEVICE_PROFILE 0
#endif
const uint8_t GATEWAY_MAC[6] = { ${mac(kit.gatewayMac)} };
const uint8_t ESPNOW_PMK[16] = { ${bytes(kit.pmk, 16)} };
#if DEVICE_PROFILE == 0
const device_role_t DEVICE_ROLE = DEVICE_ROLE_GATEWAY;
const char *DEVICE_ID = ${gatewayId};
const char *NODE_HMAC_KEY_HEX = "";
const uint8_t GATEWAY_LMK[16] = { 0 };
${nodes.map((node, index) => `#elif DEVICE_PROFILE == ${index + 1}
const device_role_t DEVICE_ROLE = DEVICE_ROLE_NODE;
const char *DEVICE_ID = ${node.id};
const char *NODE_HMAC_KEY_HEX = ${node.key};
const uint8_t GATEWAY_LMK[16] = { ${node.lmk} };`).join('\n')}
#else
#error "DEVICE_PROFILE must be 0..3"
#endif
const uint8_t ESPNOW_CHANNEL = 1;
const char *WIFI_SSID = ${literal(kit.wifiSsid)};
const char *WIFI_PASSWORD = ${literal(kit.wifiPassword)};
const char *UPSTREAM_URL = ${literal(kit.upstreamUrl)};
const node_peer_config_t GATEWAY_PEERS[] = {
${nodes.map((node) => `    { .device_id = ${node.id}, .hmac_key_hex = ${node.key},
      .mac = { ${node.mac} }, .lmk = { ${node.lmk} }, .provisioned = true },`).join('\n')}
};
const size_t GATEWAY_PEER_COUNT = sizeof(GATEWAY_PEERS) / sizeof(GATEWAY_PEERS[0]);
`;
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(path.resolve(outputPath), source, { flag: 'wx' });
console.log(`Configuración de ${kit.gatewayId} generada para Gateway y tres nodos`);
