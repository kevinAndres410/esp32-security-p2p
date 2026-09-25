const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { getCurrentKey } = require('../crypto/keyManager');
const { generarReto, verificarRetoNodo } = require('../middleware/authMiddleware');
const db = require('../models/db');

let io;
let statusBroadcastTimer;
const retosPendientes = new Map(); // socket.id -> reto generado

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token requerido'));
    try {
      socket.data.usuario = jwt.verify(token, process.env.JWT_SECRET || 'secreto_dev');
      next();
    } catch {
      next(new Error('Token inválido o expirado'));
    }
  });

  // ===== Namespace raíz: dashboard (sin cambios respecto a lo existente) =====
  io.on('connection', (socket) => {
    console.log(`[Socket] Cliente conectado: ${socket.id}`);

    socket.emit('estado_red', getEstadoRed(socket.data.usuario.id));

    socket.on('rotar_clave', () => {
      if (!['avanzado', 'administrador'].includes(socket.data.usuario?.rol)) return socket.emit('permiso_denegado');
      // Carga diferida para evitar un ciclo de imports socket <-> servicio.
      const { rotateActiveNodeKeys } = require('../services/keyRotation.service');
      const rotations = rotateActiveNodeKeys('manual');
      io.emit('clave_rotada', { nodosRotados: rotations.length, timestamp: new Date().toISOString() });
      broadcastEstadoRed();
      console.log(`[Socket] Claves rotadas manualmente para ${rotations.length} nodo(s)`);
    });

    // Gestión de nodos desde la UI (Sprint 3): registrar / bloquear / eliminar
    socket.on('nodo_bloquear', (data) => {
      if (!['avanzado', 'administrador'].includes(socket.data.usuario?.rol)) return socket.emit('permiso_denegado');
      db.prepare(`UPDATE nodos SET estado = 'bloqueado' WHERE device_id = ?`).run(data.device_id);
      db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
        .run('bloqueo', `Nodo ${data.device_id} bloqueado manualmente`, data.device_id);
      broadcastEstadoRed();
    });

    socket.on('nodo_desbloquear', (data) => {
      if (!['avanzado', 'administrador'].includes(socket.data.usuario?.rol)) return socket.emit('permiso_denegado');
      db.prepare(`UPDATE nodos SET estado = 'activo' WHERE device_id = ? AND admission_status = 'approved'`).run(data.device_id);
      broadcastEstadoRed();
    });

    socket.on('nodo_eliminar', (data) => {
      if (!['avanzado', 'administrador'].includes(socket.data.usuario?.rol)) return socket.emit('permiso_denegado');
      db.prepare(`DELETE FROM nodos WHERE device_id = ?`).run(data.device_id);
      db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
        .run('eliminacion', `Nodo ${data.device_id} eliminado del sistema`, data.device_id);
      broadcastEstadoRed();
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Cliente desconectado: ${socket.id}`);
    });
  });

  // ===== Namespace /nodes: ESP32 reales, con autenticación mutua =====
  const nodesNsp = io.of('/nodes');
  nodesNsp.on('connection', (socket) => {
    // Paso 1: el backend envía un reto
    const reto = generarReto();
    retosPendientes.set(socket.id, reto);
    socket.emit('reto_autenticacion', { reto });

    // Paso 2: el nodo responde con HMAC(clave_actual, reto)
    socket.on('handshake_nodo', ({ device_id, respuesta }) => {
      const retoEnviado = retosPendientes.get(socket.id);
      const resultado = verificarRetoNodo(device_id, retoEnviado, respuesta);

      if (!resultado.ok) {
        socket.emit('auth_fallida', { motivo: resultado.motivo });
        db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
          .run('auth_failure', `Fallo de autenticación mutua (${resultado.motivo})`, device_id || 'desconocido');
        broadcastEstadoRed();
        socket.disconnect(true);
        return;
      }

      socket.deviceId = device_id;
      db.prepare(`UPDATE nodos SET estado = 'activo', ultima_actividad = CURRENT_TIMESTAMP WHERE device_id = ?`)
        .run(device_id);
      db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
        .run('conexion', `Nodo ${device_id} autenticado (auth mutua)`, device_id);

      socket.emit('auth_ok');
      broadcastEstadoRed();
    });

    // Latido periódico del nodo ya autenticado
    socket.on('heartbeat', ({ device_id }) => {
      if (socket.deviceId !== device_id) return; // ignora si no pasó el handshake
      db.prepare(`UPDATE nodos SET ultima_actividad = CURRENT_TIMESTAMP WHERE device_id = ?`).run(device_id);
    });

    socket.on('clave_rotada_ack', ({ device_id }) => {
      if (socket.deviceId !== device_id) return;
      db.prepare('UPDATE nodos SET clave_anterior = NULL WHERE device_id = ?').run(device_id);
      db.prepare('INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)')
        .run('rotacion_confirmada', `Rotación confirmada por ${device_id}`, device_id);
      broadcastEstadoRed();
    });

    socket.on('disconnect', () => {
      retosPendientes.delete(socket.id);
      if (socket.deviceId) {
        db.prepare(`UPDATE nodos SET estado = 'desconectado' WHERE device_id = ?`).run(socket.deviceId);
        broadcastEstadoRed();
      }
    });
  });

  // Recalcula el estado aunque no llegue ningún heartbeat. Así también se
  // detecta cuando todos los nodos se apagan al mismo tiempo.
  if (statusBroadcastTimer) clearInterval(statusBroadcastTimer);
  statusBroadcastTimer = setInterval(() => {
    broadcastEstadoRed();
  }, 5000);
  statusBroadcastTimer.unref();
  server.once('close', () => {
    if (statusBroadcastTimer) clearInterval(statusBroadcastTimer);
    statusBroadcastTimer = null;
  });

  return io;
}

function getEstadoRed(userId) {
  const role = userId ? db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(userId)?.rol : 'avanzado';
  const advanced = ['avanzado', 'administrador'].includes(role);
  const nodos = db.prepare(`SELECT id, device_id, mac_address, descripcion,
    CASE
      WHEN estado IN ('bloqueado', 'pendiente') THEN estado
      WHEN ultima_actividad IS NOT NULL
        AND (julianday('now') - julianday(ultima_actividad)) * 86400 <= 45 THEN 'activo'
      ELSE 'desconectado'
    END AS estado,
    CASE WHEN clave_actual IS NULL THEN NULL ELSE substr(clave_actual, 1, 8) || '...' END AS clave_actual,
    ultima_actividad, registrado_en, clave_rotada_en FROM nodos
    WHERE (? = 1 OR device_id IN (SELECT d.device_id FROM kit_devices d
      JOIN kits k ON k.id = d.kit_id WHERE k.owner_user_id = ?))`).all(advanced ? 1 : 0, userId || 0);
  const latestSync = nodos.filter((node) => node.estado === 'activo')
    .map((node) => node.ultima_actividad).sort().at(-1) || null;
  const ownGateway = userId ? db.prepare('SELECT gateway_id, gateway_mac FROM kits WHERE owner_user_id = ? ORDER BY id LIMIT 1').get(userId) : null;
  const gateway = db.prepare(`SELECT
      ? AS device_id,
      ? AS mac_address,
      'Gateway ESP-NOW / Wi-Fi' AS descripcion,
      CASE
        WHEN ? IS NOT NULL AND (julianday('now') - julianday(?)) * 86400 <= 45
          THEN 'activo'
        ELSE 'desconectado'
      END AS estado,
      ? AS ultima_actividad`).get(
        ownGateway?.gateway_id || (advanced ? 'gateway-001' : null),
        ownGateway?.gateway_mac || (advanced ? 'B0:3F:D3:5B:50:B4' : null),
        latestSync,
        latestSync,
        latestSync,
      );
  const eventos = advanced
    ? db.prepare('SELECT * FROM eventos ORDER BY creado_en DESC LIMIT 10').all()
    : db.prepare(`SELECT * FROM eventos WHERE nodo_id IN (SELECT d.device_id FROM kit_devices d
        JOIN kits k ON k.id = d.kit_id WHERE k.owner_user_id = ?)
        ORDER BY creado_en DESC LIMIT 10`).all(userId || 0);
  const clave = advanced ? getCurrentKey() : null;
  return { nodos, gateway, eventos, claveActual: clave ? clave.substring(0, 16) + '...' : null };
}

function broadcastEstadoRed() {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('estado_red', getEstadoRed(socket.data.usuario?.id));
  }
}

// Notifica al nodo real (namespace /nodes) que su clave fue rotada,
// para que reemplace su copia local sin perder la conexión.
function emitirClaveRotada(deviceId, nuevaClave) {
  if (!io) return;
  io.of('/nodes').emit('clave_rotada_nodo', { device_id: deviceId, nuevaClave });
}

// Usado por los controllers REST (nodes/events/keys) para refrescar el
// dashboard después de una acción hecha desde la UI, sin duplicar lógica.
function emitEstadoRed() {
  if (!io) return;
  broadcastEstadoRed();
}

// Notificación puntual para alertas/toasts en el dashboard
function emitAlerta({ nodo_id, tipo, mensaje }) {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    const userId = socket.data.usuario?.id;
    const role = db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(userId)?.rol;
    const advanced = ['avanzado', 'administrador'].includes(role);
    const owned = db.prepare(`SELECT 1 AS ok FROM kit_devices d JOIN kits k ON k.id = d.kit_id
      WHERE d.device_id = ? AND k.owner_user_id = ?`).get(nodo_id, userId);
    if (advanced || owned) socket.emit('alerta_nueva', { nodo_id, tipo, mensaje, timestamp: new Date().toISOString() });
  }
}

module.exports = { initSocket, getEstadoRed, emitirClaveRotada, emitEstadoRed, emitAlerta };
