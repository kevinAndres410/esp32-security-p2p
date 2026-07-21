import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

// El backend NO usa namespace /dashboard, todo va por la raíz (ver websocket/socket.js)
export const socket = io(SOCKET_URL, { autoConnect: true, reconnection: true });

export function subscribe(event, callback) {
  socket.on(event, callback);
  return () => socket.off(event, callback);
}

// Acciones que la UI puede emitir directamente por socket (alternativa a REST)
export function rotarClaveGlobal() {
  socket.emit('rotar_clave');
}
