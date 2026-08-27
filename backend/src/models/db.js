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
    bloqueado INTEGER DEFAULT 0,
    intentos_fallidos INTEGER DEFAULT 0,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS nodos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT UNIQUE NOT NULL,
    descripcion TEXT,
    estado TEXT DEFAULT 'activo',
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
`);

module.exports = db;
