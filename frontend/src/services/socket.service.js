import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

// El backend NO usa namespace /dashboard, todo va por la raíz (ver websocket/socket.js)
export const socket = io(SOCKET_URL, { autoConnect: false, reconnection: true });

export function connectSocket() {
  const token = localStorage.getItem('token');
  if (!token) return;
  socket.auth = { token };
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
}

export function subscribe(event, callback) {
  connectSocket();
  socket.on(event, callback);
  return () => socket.off(event, callback);
}

// Acciones que la UI puede emitir directamente por socket (alternativa a REST)
export function rotarClaveGlobal() {
  socket.emit('rotar_clave');
}
