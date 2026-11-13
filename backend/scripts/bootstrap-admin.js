// Crea la única cuenta de Administrador Maestro en la base configurada por DB_PATH.
// Imprime la contraseña una sola vez; la base sólo conserva su hash bcrypt.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/models/db');

const email = String(process.env.MASTER_ADMIN_EMAIL || 'master.admin@securemesh.local').trim().toLowerCase();

try {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('MASTER_ADMIN_EMAIL debe ser un correo válido.');
  }
  if (db.prepare("SELECT id FROM usuarios WHERE rol = 'master_admin' LIMIT 1").get()) {
    throw new Error('Ya existe una cuenta de Administrador Maestro.');
  }
  if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) {
    throw new Error('El correo indicado ya pertenece a otra cuenta.');
  }

  const password = `${crypto.randomBytes(18).toString('base64url')}Aa1!`;
  const hash = bcrypt.hashSync(password, 12);
  db.transaction(() => {
    const created = db.prepare(`INSERT INTO usuarios
      (nombre, email, password, rol, tiene_conocimiento_tecnico, estado_acceso_avanzado)
      VALUES (?, ?, ?, 'master_admin', 1, 'approved')`)
      .run('Administrador Maestro', email, hash);
    db.prepare(`INSERT INTO admin_audit_log
      (actor_user_id, action, entity_type, entity_id, metadata_json)
      VALUES (?, 'master_admin.created', 'user', ?, '{}')`)
      .run(created.lastInsertRowid, String(created.lastInsertRowid));
  })();
  console.log(`Usuario: ${email}`);
  console.log(`Contraseña: ${password}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
