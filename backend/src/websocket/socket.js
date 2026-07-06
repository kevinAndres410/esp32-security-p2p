const { Server } = require('socket.io');
const { getCurrentKey, rotateKey } = require('../crypto/keyManager');
const db = require('../models/db');

function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Cliente conectado: ${socket.id}`);

    // Enviar estado inicial
    socket.emit('estado_red', getEstadoRed());

    // Nodo se conecta
    socket.on('nodo_conectado', (data) => {
      console.log(`[Socket] Nodo conectado: ${data.device_id}`);
      db.prepare(`UPDATE nodos SET estado = 'activo', ultima_actividad = CURRENT_TIMESTAMP WHERE device_id = ?`)
        .run(data.device_id);
      db.prepare(`INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)`)
        .run('conexion', `Nodo ${data.device_id} conectado a la red`, data.device_id);
      io.emit('estado_red', getEstadoRed());
    });

    // Rotar clave manualmente
    socket.on('rotar_clave', () => {
      const { newKey } = rotateKey();
      db.prepare(`UPDATE nodos SET clave_actual = ? WHERE estado = 'activo'`).run(newKey);
      db.prepare(`INSERT INTO eventos (tipo, mensaje) VALUES (?, ?)`)
        .run('rotacion', 'Rotación de claves ejecutada manualmente');
      io.emit('clave_rotada', { nuevaClave: newKey.substring(0, 16) + '...', timestamp: new Date().toISOString() });
      io.emit('estado_red', getEstadoRed());
      console.log(`[Socket] Clave rotada manualmente`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Cliente desconectado: ${socket.id}`);
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

module.exports = { initSocket };