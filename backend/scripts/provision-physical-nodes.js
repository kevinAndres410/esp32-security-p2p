const db = require('../src/models/db');

const nodes = [
  ['esp32-001', '20:50:0D:17:C8:D0', 'Nodo físico 1', '4ce5266230514250637bc6926aa8d20230b0363c6833d29f261c2eb610048cfa'],
  ['esp32-002', '04:B2:47:54:DA:90', 'Nodo físico 2', 'c79aecc9bf8bda0cb4646c826d9c767aa3191473e14adc8306c11915da7e26f4'],
  ['esp32-003', '20:50:0D:17:EC:64', 'Nodo físico 3', '93e1406dec25879f054fe5cbda0e05f38a69b0f563faa2cadbcb8f002597244d'],
];

const provision = db.prepare(`
  INSERT INTO nodos (device_id, mac_address, descripcion, estado, clave_actual, clave_anterior)
  VALUES (?, ?, ?, 'pendiente', ?, NULL)
  ON CONFLICT(device_id) DO UPDATE SET
    mac_address = excluded.mac_address,
    descripcion = excluded.descripcion,
    estado = 'pendiente',
    clave_actual = excluded.clave_actual,
    clave_anterior = NULL,
    clave_rotada_en = NULL
`);

db.transaction(() => nodes.forEach((node) => provision.run(...node)))();

const result = db.prepare(`
  SELECT device_id, mac_address, descripcion, estado
  FROM nodos
  WHERE device_id IN ('esp32-001', 'esp32-002', 'esp32-003')
  ORDER BY device_id
`).all();

console.log(JSON.stringify(result, null, 2));
db.close();
