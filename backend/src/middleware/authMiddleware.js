const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models/db');

// ============ AUTENTICACIÓN DE USUARIOS (ya existente) ============

function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto_dev');
    req.usuario = decoded;
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
}

function soloAvanzado(req, res, next) {
  if (req.usuario.rol !== 'avanzado') {
    return res.status(403).json({ error: 'Acceso restringido a usuarios avanzados' });
  }
  next();
}

// ============ AUTENTICACIÓN MUTUA DE NODOS (Sprint 3) ============
// Reutiliza la columna "clave_actual" de la tabla "nodos" como secreto
// compartido para el reto HMAC. Es la misma clave que ya rota keyManager.js,
// así que al rotar, el reto de autenticación se actualiza automáticamente.

function generarReto() {
  return crypto.randomBytes(16).toString('hex');
}

function calcularHmac(secreto, reto) {
  return crypto.createHmac('sha256', secreto).update(reto).digest('hex');
}

// Verifica la respuesta de un nodo a un reto (usado en el handshake por WebSocket)
function verificarRetoNodo(deviceId, reto, respuesta) {
  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);

  if (!nodo) return { ok: false, motivo: 'nodo_no_registrado' };
  if (nodo.estado === 'bloqueado') return { ok: false, motivo: 'nodo_bloqueado' };

  const esperado = calcularHmac(nodo.clave_actual, reto);
  const bufEsperado = Buffer.from(esperado);
  const bufRecibido = Buffer.from(respuesta || '');

  const valido =
    bufEsperado.length === bufRecibido.length && crypto.timingSafeEqual(bufEsperado, bufRecibido);

  return valido ? { ok: true, nodo } : { ok: false, motivo: 'firma_invalida' };
}

// Middleware REST: valida firma HMAC en endpoints llamados directamente por nodos
// (no por el dashboard). El nodo debe enviar headers:
//   x-device-id, x-node-signature, x-node-timestamp
// firma = HMAC(clave_actual, `${device_id}:${timestamp}`)
function verificarAutenticacionNodo(req, res, next) {
  const deviceId = req.headers['x-device-id'];
  const firma = req.headers['x-node-signature'];
  const timestamp = req.headers['x-node-timestamp'];

  if (!deviceId || !firma || !timestamp) {
    return res.status(401).json({ error: 'Faltan credenciales de autenticación del nodo' });
  }

  const nodo = db.prepare(`SELECT * FROM nodos WHERE device_id = ?`).get(deviceId);
  if (!nodo || nodo.estado === 'bloqueado') {
    return res.status(403).json({ error: 'Nodo no autorizado' });
  }

  const esperado = calcularHmac(nodo.clave_actual, `${deviceId}:${timestamp}`);
  const bufEsperado = Buffer.from(esperado);
  const bufRecibido = Buffer.from(firma);

  const valido =
    bufEsperado.length === bufRecibido.length && crypto.timingSafeEqual(bufEsperado, bufRecibido);

  if (!valido) return res.status(401).json({ error: 'Firma inválida' });

  req.nodo = nodo;
  next();
}

module.exports = {
  verificarToken,
  soloAvanzado,
  generarReto,
  calcularHmac,
  verificarRetoNodo,
  verificarAutenticacionNodo,
};
