// Asume que Login.js guarda el token como localStorage.setItem('token', ...)
// Si tu Login.js usa otra clave, ajústala aquí (un solo lugar).
export function authHeaders() {
  const token = localStorage.getItem('token');
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}
