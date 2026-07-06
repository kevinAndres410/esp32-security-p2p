const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/db');

const MAX_INTENTOS = 5;

function register(req, res) {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare(`INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)`)
      .run(nombre, email, hash, rol || 'basico');
    res.status(201).json({ mensaje: 'Usuario registrado correctamente' });
  } catch (e) {
    res.status(400).json({ error: 'El email ya está registrado' });
  }
}

function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }
  const usuario = db.prepare(`SELECT * FROM usuarios WHERE email = ?`).get(email);
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
  res.json({ token, usuario: { nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } });
}

module.exports = { register, login };