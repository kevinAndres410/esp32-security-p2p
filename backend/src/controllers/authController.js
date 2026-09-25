const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/db');

const MAX_INTENTOS = 5;

function register(req, res) {
  const { nombre, email, password, tieneConocimientoTecnico, aceptaRiesgosAvanzados } = req.body;
  if (!nombre || !email || !password || typeof tieneConocimientoTecnico !== 'boolean') {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  if (String(nombre).trim().length < 3) {
    return res.status(400).json({ error: 'El nombre debe tener al menos 3 caracteres' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'El correo electrónico no es válido' });
  }
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return res.status(400).json({ error: 'La contraseña no cumple los requisitos de seguridad' });
  }
  if (tieneConocimientoTecnico && aceptaRiesgosAvanzados !== true) {
    return res.status(400).json({ error: 'Debes aceptar explícitamente los riesgos del modo avanzado' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const rol = tieneConocimientoTecnico ? 'avanzado' : 'basico';
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare(`INSERT INTO usuarios
      (nombre, email, password, rol, tiene_conocimiento_tecnico, estado_acceso_avanzado, riesgos_aceptados_en, riesgos_version)
      VALUES (?, ?, ?, ?, ?, 'none', ?, ?)`)
      .run(nombre.trim(), normalizedEmail, hash, rol, tieneConocimientoTecnico ? 1 : 0,
        tieneConocimientoTecnico ? new Date().toISOString() : null,
        tieneConocimientoTecnico ? 'v1' : null);
    res.status(201).json({ mensaje: 'Usuario registrado correctamente', email: normalizedEmail });
  } catch (e) {
    res.status(400).json({ error: 'El email ya está registrado' });
  }
}

function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }
  const usuario = db.prepare(`SELECT * FROM usuarios WHERE email = ?`).get(email.trim().toLowerCase());
  if (!usuario) return res.status(401).json({ error: 'Credenciales inválidas' });
  if (usuario.bloqueado) return res.status(403).json({ error: 'Cuenta bloqueada. Contacta al administrador' });

  const valido = bcrypt.compareSync(password, usuario.password);
  if (!valido) {
    const intentos = usuario.intentos_fallidos + 1;
    if (intentos >= MAX_INTENTOS) {
      db.prepare(`UPDATE usuarios SET bloqueado = 1, intentos_fallidos = ? WHERE id = ?`).run(intentos, usuario.id);
      return res.status(403).json({ error: 'Cuenta bloqueada por demasiados intentos fallidos' });
    }
    db.prepare(`UPDATE usuarios SET intentos_fallidos = ? WHERE id = ?`).run(intentos, usuario.id);
    return res.status(401).json({ error: `Credenciales inválidas. Intentos restantes: ${MAX_INTENTOS - intentos}` });
  }

  db.prepare(`UPDATE usuarios SET intentos_fallidos = 0 WHERE id = ?`).run(usuario.id);
  const token = jwt.sign(
    { id: usuario.id, email: usuario.email, rol: usuario.rol },
    process.env.JWT_SECRET || 'secreto_dev',
    { expiresIn: '8h' }
  );
  res.json({
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      tieneConocimientoTecnico: Boolean(usuario.tiene_conocimiento_tecnico),
      estadoAccesoAvanzado: usuario.estado_acceso_avanzado,
    },
  });
}

function requestAdvancedAccess(req, res) {
  const user = db.prepare('SELECT id, rol, estado_acceso_avanzado FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.rol === 'avanzado') return res.status(409).json({ error: 'El usuario ya tiene acceso avanzado' });
  if (user.estado_acceso_avanzado === 'pending') return res.status(409).json({ error: 'Ya existe una solicitud pendiente' });

  const transaction = db.transaction(() => {
    db.prepare("UPDATE usuarios SET estado_acceso_avanzado = 'pending' WHERE id = ?").run(user.id);
    db.prepare("INSERT INTO solicitudes_acceso_avanzado (usuario_id, estado, motivo) VALUES (?, 'pending', ?)")
      .run(user.id, String(req.body?.motivo || '').slice(0, 500) || null);
  });
  transaction();
  res.status(201).json({ mensaje: 'Solicitud enviada correctamente', estadoAccesoAvanzado: 'pending' });
}

module.exports = { register, login, requestAdvancedAccess };
