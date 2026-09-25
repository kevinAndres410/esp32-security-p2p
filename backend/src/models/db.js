const Database = require('better-sqlite3');
const path = require('path');

// Permite que las pruebas de integración usen un archivo de base de datos
// separado (DB_PATH), sin tocar la base de datos real en desarrollo/producción.
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'basico',
    tiene_conocimiento_tecnico INTEGER NOT NULL DEFAULT 0,
    estado_acceso_avanzado TEXT NOT NULL DEFAULT 'none',
    riesgos_aceptados_en TEXT,
    riesgos_version TEXT,
    bloqueado INTEGER DEFAULT 0,
    intentos_fallidos INTEGER DEFAULT 0,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS nodos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT UNIQUE NOT NULL,
    descripcion TEXT,
    estado TEXT DEFAULT 'activo',
    admission_status TEXT NOT NULL DEFAULT 'pending',
    clave_actual TEXT,
    ultima_actividad TEXT DEFAULT CURRENT_TIMESTAMP,
    registrado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    nodo_id TEXT,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS solicitudes_acceso_avanzado (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pending',
    motivo TEXT,
    solicitado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    revisado_en TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS muestras_rendimiento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    secuencia_protocolo INTEGER NOT NULL,
    secuencia_heartbeat INTEGER,
    recibido_en TEXT NOT NULL,
    rtt_ms REAL,
    heap_libre_bytes INTEGER,
    heap_minimo_bytes INTEGER,
    cpu_porcentaje REAL,
    uptime_ms INTEGER,
    payload TEXT NOT NULL,
    UNIQUE(device_id, secuencia_protocolo)
  );

  CREATE TABLE IF NOT EXISTS kits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gateway_id TEXT NOT NULL UNIQUE,
    gateway_mac TEXT NOT NULL UNIQUE,
    claim_code_hash TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER,
    scan_until TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_user_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS kit_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kit_id INTEGER NOT NULL,
    device_id TEXT NOT NULL UNIQUE,
    mac_address TEXT NOT NULL UNIQUE,
    hmac_key TEXT NOT NULL,
    detected_at TEXT,
    detected_transport TEXT,
    FOREIGN KEY(kit_id) REFERENCES kits(id)
  );

  CREATE TABLE IF NOT EXISTS device_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kit_device_id INTEGER NOT NULL,
    requester_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    method TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INTEGER,
    decided_at TEXT,
    reason TEXT,
    FOREIGN KEY(kit_device_id) REFERENCES kit_devices(id),
    FOREIGN KEY(requester_user_id) REFERENCES usuarios(id),
    FOREIGN KEY(decided_by) REFERENCES usuarios(id)
  );
`);

const userColumns = db.prepare('PRAGMA table_info(usuarios)').all().map((column) => column.name);
if (!userColumns.includes('tiene_conocimiento_tecnico')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN tiene_conocimiento_tecnico INTEGER NOT NULL DEFAULT 0');
}
if (!userColumns.includes('estado_acceso_avanzado')) {
  db.exec("ALTER TABLE usuarios ADD COLUMN estado_acceso_avanzado TEXT NOT NULL DEFAULT 'none'");
}
if (!userColumns.includes('riesgos_aceptados_en')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN riesgos_aceptados_en TEXT');
}
if (!userColumns.includes('riesgos_version')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN riesgos_version TEXT');
}

// Migración compatible con bases ya creadas: la clave anterior sólo vive
// durante el intercambio de rotación y permite completarlo sin bloquear al nodo.
const nodeColumns = db.prepare('PRAGMA table_info(nodos)').all().map((column) => column.name);
if (!nodeColumns.includes('clave_anterior')) {
  db.exec('ALTER TABLE nodos ADD COLUMN clave_anterior TEXT');
}
if (!nodeColumns.includes('clave_rotada_en')) {
  db.exec('ALTER TABLE nodos ADD COLUMN clave_rotada_en TEXT');
}
if (!nodeColumns.includes('mac_address')) {
  db.exec('ALTER TABLE nodos ADD COLUMN mac_address TEXT');
}
if (!nodeColumns.includes('admission_status')) {
  db.exec("ALTER TABLE nodos ADD COLUMN admission_status TEXT NOT NULL DEFAULT 'approved'");
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_nodos_mac_address
         ON nodos(mac_address) WHERE mac_address IS NOT NULL`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_muestras_rendimiento_dispositivo_fecha
         ON muestras_rendimiento(device_id, recibido_en)`);

module.exports = db;
