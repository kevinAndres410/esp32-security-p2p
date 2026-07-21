const { Server } = require('socket.io');
const { getCurrentKey, rotateKey } = require('../crypto/keyManager');
const { generarReto, verificarRetoNodo } = require('../middleware/authMiddleware');
const db = require('../models/db');

let io;
const retosPendientes = new Map(); // socket.id -> reto generado

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] },
  });

  // ===== Namespace raíz: dashboard (sin cambios respecto a lo existente) =====
  io.on('connection', (socket) => {
    console.log(`[Socket] Cliente conectado: ${socket.id}`);

    socket.emit('estado_red', getEstadoRed());

    // Se mantiene por compatibilidad con clientes/simuladores que aún
    // notifican su conexión sin pasar por el handshake de auth mutua.
    socket.on('nodo_conectado', (data) => {
      console.log(`[Socket] Nodo conectado: ${data.device_id}`);
      db.prepare(`UPDATE nodos SET estado = 'activo', ultima_actividad = CURRENT_TIMESTAMP WHERE device_id = ?`)
        .run(data.device_id);
      db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
        .run('conexion', `Nodo ${data.device_id} conectado a la red`, data.device_id);
      io.emit('estado_red', getEstadoRed());
    });

    socket.on('rotar_clave', () => {
      const { newKey } = rotateKey();
      db.prepare(`UPDATE nodos SET clave_actual = ? WHERE estado = 'activo'`).run(newKey);
      db.prepare(`INSERT INTO eventos (tipo, mensaje) VALUES (?, ?)`)
        .run('rotacion', 'Rotación de claves ejecutada manualmente');
      io.emit('clave_rotada', { nuevaClave: newKey.substring(0, 16) + '...', timestamp: new Date().toISOString() });
      io.emit('estado_red', getEstadoRed());
      console.log(`[Socket] Clave rotada manualmente`);
    });

    // Gestión de nodos desde la UI (Sprint 3): registrar / bloquear / eliminar
    socket.on('nodo_bloquear', (data) => {
      db.prepare(`UPDATE nodos SET estado = 'bloqueado' WHERE device_id = ?`).run(data.device_id);
      db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
        .run('bloqueo', `Nodo ${data.device_id} bloqueado manualmente`, data.device_id);
      io.emit('estado_red', getEstadoRed());
    });

    socket.on('nodo_desbloquear', (data) => {
      db.prepare(`UPDATE nodos SET estado = 'activo' WHERE device_id = ?`).run(data.device_id);
      io.emit('estado_red', getEstadoRed());
    });

    socket.on('nodo_eliminar', (data) => {
      db.prepare(`DELETE FROM nodos WHERE device_id = ?`).run(data.device_id);
      db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
        .run('eliminacion', `Nodo ${data.device_id} eliminado del sistema`, data.device_id);
      io.emit('estado_red', getEstadoRed());
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
        io.emit('estado_red', getEstadoRed());
        socket.disconnect(true);
        return;
      }

      socket.deviceId = device_id;
      db.prepare(`UPDATE nodos SET estado = 'activo', ultima_actividad = CURRENT_TIMESTAMP WHERE device_id = ?`)
        .run(device_id);
      db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
        .run('conexion', `Nodo ${device_id} autenticado (auth mutua)`, device_id);

      socket.emit('auth_ok');
      io.emit('estado_red', getEstadoRed());
    });

    // Latido periódico del nodo ya autenticado
    socket.on('heartbeat', ({ device_id }) => {
      if (socket.deviceId !== device_id) return; // ignora si no pasó el handshake
      db.prepare(`UPDATE nodos SET ultima_actividad = CURRENT_TIMESTAMP WHERE device_id = ?`).run(device_id);
    });

    socket.on('disconnect', () => {
      retosPendientes.delete(socket.id);
      if (socket.deviceId) {
        db.prepare(`UPDATE nodos SET estado = 'desconectado' WHERE device_id = ?`).run(socket.deviceId);
        io.emit('estado_red', getEstadoRed());
      }
    });
  });

  return io;
}

function getEstadoRed() {
  const nodos = db.prepare(`SELECT * FROM nodos`).all();
  const eventos = db.prepare(`SELECT * FROM eventos ORDER BY creado_en DESC LIMIT 10`).all();
  const clave = getCurrentKey();
  return { nodos, eventos, claveActual: clave.substring(0, 16) + '...' };
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
  io.emit('estado_red', getEstadoRed());
}

// Notificación puntual para alertas/toasts en el dashboard
function emitAlerta({ nodo_id, tipo, mensaje }) {
  if (!io) return;
  io.emit('alerta_nueva', { nodo_id, tipo, mensaje, timestamp: new Date().toISOString() });
}

module.exports = { initSocket, getEstadoRed, emitirClaveRotada, emitEstadoRed, emitAlerta };
