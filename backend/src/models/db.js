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
    token_version INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS wifi_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ssid TEXT NOT NULL,
    password_ciphertext TEXT,
    security_type TEXT NOT NULL,
    connection_status TEXT NOT NULL DEFAULT 'disconnected',
    last_tested_at TEXT,
    last_error TEXT,
    updated_by INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(updated_by) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS wifi_networks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ssid TEXT NOT NULL UNIQUE,
    password_ciphertext TEXT,
    security_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(actor_user_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(updated_by) REFERENCES usuarios(id)
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
if (!userColumns.includes('token_version')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
}

// El rol administrador anterior concedía acceso al panel maestro. A partir de
// esta versión sólo la cuenta master_admin puede usarlo; las cuentas anteriores
// conservan las herramientas técnicas y sus sesiones quedan revocadas.
db.exec(`UPDATE usuarios SET rol = 'avanzado', estado_acceso_avanzado = 'approved',
  token_version = token_version + 1 WHERE rol = 'administrador'`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_single_master_admin
  ON usuarios(rol) WHERE rol = 'master_admin'`);

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

// Migraciones aditivas del módulo Master Admin. Se conserva el esquema de
// aprovisionamiento anterior para no invalidar kits ya importados.
const kitColumns = db.prepare('PRAGMA table_info(kits)').all().map((column) => column.name);
if (!kitColumns.includes('display_name')) db.exec('ALTER TABLE kits ADD COLUMN display_name TEXT');
if (!kitColumns.includes('status')) db.exec("ALTER TABLE kits ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
if (!kitColumns.includes('notes')) db.exec('ALTER TABLE kits ADD COLUMN notes TEXT');
if (!kitColumns.includes('unique_key_ciphertext')) db.exec('ALTER TABLE kits ADD COLUMN unique_key_ciphertext TEXT');
if (!kitColumns.includes('updated_at')) db.exec('ALTER TABLE kits ADD COLUMN updated_at TEXT');
if (!kitColumns.includes('wifi_network_id')) db.exec('ALTER TABLE kits ADD COLUMN wifi_network_id INTEGER REFERENCES wifi_networks(id)');
if (!kitColumns.includes('gateway_last_seen_at')) db.exec('ALTER TABLE kits ADD COLUMN gateway_last_seen_at TEXT');
if (!kitColumns.includes('config_version')) db.exec('ALTER TABLE kits ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1');
if (!kitColumns.includes('applied_version')) db.exec('ALTER TABLE kits ADD COLUMN applied_version INTEGER NOT NULL DEFAULT 0');
if (!kitColumns.includes('gateway_control_secret_ciphertext')) {
  db.exec('ALTER TABLE kits ADD COLUMN gateway_control_secret_ciphertext TEXT');
}

// Migra la red principal existente al catálogo sin asignar automáticamente
// kits anteriores: su red real debe confirmarla un administrador.
db.exec(`INSERT OR IGNORE INTO wifi_networks (ssid, password_ciphertext, security_type)
  SELECT ssid, password_ciphertext, security_type FROM wifi_config WHERE id = 1`);
db.exec('CREATE INDEX IF NOT EXISTS idx_kits_wifi_network ON kits(wifi_network_id)');

const kitDeviceColumns = db.prepare('PRAGMA table_info(kit_devices)').all().map((column) => column.name);
if (!kitDeviceColumns.includes('component_role')) db.exec('ALTER TABLE kit_devices ADD COLUMN component_role TEXT');
if (!kitDeviceColumns.includes('identifier_type')) db.exec("ALTER TABLE kit_devices ADD COLUMN identifier_type TEXT NOT NULL DEFAULT 'id'");
if (!kitDeviceColumns.includes('lmk_hex')) db.exec('ALTER TABLE kit_devices ADD COLUMN lmk_hex TEXT');
if (!kitDeviceColumns.includes('desired_state')) {
  db.exec("ALTER TABLE kit_devices ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'active'");
}
if (!kitDeviceColumns.includes('desired_version')) {
  db.exec('ALTER TABLE kit_devices ADD COLUMN desired_version INTEGER NOT NULL DEFAULT 1');
}

db.exec(`CREATE TABLE IF NOT EXISTS factory_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_id INTEGER NOT NULL,
  device_id TEXT NOT NULL UNIQUE,
  mac_address TEXT NOT NULL UNIQUE,
  hmac_key TEXT NOT NULL,
  lmk_hex TEXT NOT NULL,
  activation_hash TEXT NOT NULL UNIQUE,
  assigned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(kit_id) REFERENCES kits(id)
);
CREATE TABLE IF NOT EXISTS kit_device_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('add', 'replace', 'remove')),
  device_id TEXT NOT NULL,
  old_device_id TEXT,
  component_role TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_gateway',
  requested_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gateway_applied_at TEXT,
  first_seen_at TEXT,
  FOREIGN KEY(kit_id) REFERENCES kits(id),
  FOREIGN KEY(requested_by) REFERENCES usuarios(id)
);
CREATE TABLE IF NOT EXISTS gateway_config_nonces (
  kit_id INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  acked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(kit_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_kit_operations_kit ON kit_device_operations(kit_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_factory_nodes_kit ON factory_nodes(kit_id, assigned_at);`);

db.exec(`UPDATE kits SET display_name = 'Kit ' || id WHERE display_name IS NULL`);
db.exec(`UPDATE kits SET updated_at = created_at WHERE updated_at IS NULL`);
db.exec(`UPDATE kit_devices SET component_role = 'node_' || (
  SELECT COUNT(*) FROM kit_devices previous
  WHERE previous.kit_id = kit_devices.kit_id AND previous.id <= kit_devices.id
) WHERE component_role IS NULL`);
db.exec('DROP INDEX IF EXISTS idx_kit_component_role');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_kit_component_role
  ON kit_devices(kit_id, component_role) WHERE desired_state != 'removed'`);
db.exec('CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC)');

module.exports = db;
