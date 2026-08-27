const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const request = require('supertest');
const { io } = require('socket.io-client');

// authController firma/valida contraseñas con bcrypt o bcryptjs, según
// cuál esté instalado en el proyecto; probamos ambos por compatibilidad.
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  bcrypt = require('bcrypt');
}

const DB_TEST_PATH = path.join(__dirname, 'test-integration.sqlite');
const PORT = 5099;
const BASE_URL = `http://localhost:${PORT}`;

let app;
let server;
let db;
let token;

function esperarEvento(socket, evento, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout esperando evento "${evento}"`)),
      timeoutMs
    );
    socket.once(evento, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

beforeAll(async () => {
  if (fs.existsSync(DB_TEST_PATH)) fs.unlinkSync(DB_TEST_PATH);

  process.env.DB_PATH = DB_TEST_PATH;
  process.env.PORT = String(PORT);
  process.env.JWT_SECRET = 'secreto_test';

  jest.resetModules();
  ({ app, server } = require('../index'));
  db = require('../models/db');

  // Usuario de prueba insertado directamente (evita depender del endpoint
  // de registro, que no forma parte de este módulo bajo prueba).
  const passwordHash = bcrypt.hashSync('Password123', 10);
  db.prepare(`INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)`)
    .run('Usuario Test', 'test@piloto.com', passwordHash, 'avanzado');

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'test@piloto.com', password: 'Password123' });

  if (res.status !== 200 || !res.body.token) {
    throw new Error(
      `No se pudo autenticar el usuario de prueba (status ${res.status}). ` +
      'Revisa que authController.js use bcrypt/bcryptjs y devuelva { token, usuario }.'
    );
  }
  token = res.body.token;
});

afterAll((done) => {
  server.close(() => {
    if (fs.existsSync(DB_TEST_PATH)) fs.unlinkSync(DB_TEST_PATH);
    done();
  });
});

describe('Integración: registro de usuarios (POST /api/auth/register)', () => {
  test('registra un usuario nuevo correctamente', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nombre: 'Otro Usuario',
      email: 'otro@piloto.com',
      password: 'Password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.mensaje).toMatch(/registrado/i);
  });

  test('rechaza un email ya registrado', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nombre: 'Duplicado',
      email: 'otro@piloto.com', // mismo email que la prueba anterior
      password: 'OtraPassword123',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ya está registrado/i);
  });

  test('rechaza el registro si faltan campos obligatorios', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'incompleto@piloto.com' }); // faltan nombre y password

    expect(res.status).toBe(400);
  });
});

describe('Integración: registro y estado inicial del nodo', () => {
  const DEVICE_ID = 'esp32-integracion-01';
  let claveCompartida;

  test('POST /api/nodes registra un nodo nuevo', async () => {
    const res = await request(app)
      .post('/api/nodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: DEVICE_ID, descripcion: 'Nodo de prueba de integración' });

    expect(res.status).toBe(201);
    expect(res.body.deviceId).toBe(DEVICE_ID);
    expect(res.body.claveActual).toMatch(/^[0-9a-f]{64}$/);
    claveCompartida = res.body.claveActual;
  });

  test('el nodo recién registrado queda con estado "pendiente"', async () => {
    const res = await request(app)
      .get(`/api/nodes/${DEVICE_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('pendiente');
  });

  test('el registro sin token es rechazado', async () => {
    const res = await request(app).get('/api/nodes');
    expect(res.status).toBe(401);
  });

  // La clave se comparte con el resto de pruebas del archivo mediante el
  // objeto global "estado" (ver siguiente describe).
  test('guarda la clave para las siguientes pruebas', () => {
    global.__claveNodoIntegracion = claveCompartida;
    expect(claveCompartida).toBeDefined();
  });
});

describe('Integración: dashboard + nodo ESP32 simulado por WebSocket (red domótica simulada)', () => {
  const DEVICE_ID = 'esp32-integracion-01';
  let socketDashboard;
  let socketNodo;

  beforeAll(() => {
    // Cliente del dashboard: namespace raíz, sin autenticación (igual que el frontend)
    socketDashboard = io(BASE_URL, { reconnection: false, forceNew: true });
    // Cliente que simula el ESP32 real: namespace /nodes
    socketNodo = io(`${BASE_URL}/nodes`, { reconnection: false, forceNew: true });
  });

  afterAll(() => {
    socketDashboard.disconnect();
    socketNodo.disconnect();
  });

  test('el dashboard recibe estado_red al conectarse', async () => {
    const estado = await esperarEvento(socketDashboard, 'estado_red');
    expect(estado).toHaveProperty('nodos');
    expect(estado).toHaveProperty('eventos');
    expect(estado.nodos.some((n) => n.device_id === DEVICE_ID)).toBe(true);
  });

  test('el nodo completa el handshake de autenticación mutua', async () => {
    const clave = global.__claveNodoIntegracion;

    const retoPromise = esperarEvento(socketNodo, 'reto_autenticacion');
    const { reto } = await retoPromise;
    expect(reto).toMatch(/^[0-9a-f]{32}$/);

    const respuesta = crypto.createHmac('sha256', clave).update(reto).digest('hex');
    const authOkPromise = esperarEvento(socketNodo, 'auth_ok');
    socketNodo.emit('handshake_nodo', { device_id: DEVICE_ID, respuesta });

    await expect(authOkPromise).resolves.toBeUndefined();
  });

  test('tras el handshake, el nodo queda "activo" en la base de datos', async () => {
    const res = await request(app)
      .get(`/api/nodes/${DEVICE_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.estado).toBe('activo');
  });

  test('el dashboard recibe la actualización de estado en tiempo real', async () => {
    const estadoActualizado = await esperarEvento(socketDashboard, 'estado_red');
    const nodo = estadoActualizado.nodos.find((n) => n.device_id === DEVICE_ID);
    expect(nodo.estado).toBe('activo');
  });

  test('el heartbeat del nodo actualiza ultima_actividad', async () => {
    const antes = await request(app)
      .get(`/api/nodes/${DEVICE_ID}`)
      .set('Authorization', `Bearer ${token}`);

    await new Promise((r) => setTimeout(r, 1100)); // asegura diferencia de timestamp
    socketNodo.emit('heartbeat', { device_id: DEVICE_ID });
    await new Promise((r) => setTimeout(r, 300)); // margen para que el backend procese

    const despues = await request(app)
      .get(`/api/nodes/${DEVICE_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(new Date(despues.body.ultima_actividad).getTime()).toBeGreaterThan(
      new Date(antes.body.ultima_actividad).getTime()
    );
  });

  test('POST /api/keys/:deviceId/rotate rota la clave y el nodo la recibe en vivo', async () => {
    const claveRotadaPromise = esperarEvento(socketNodo, 'clave_rotada_nodo');

    const res = await request(app)
      .post(`/api/keys/${DEVICE_ID}/rotate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const evento = await claveRotadaPromise;
    expect(evento.device_id).toBe(DEVICE_ID);
    expect(evento.nuevaClave).toMatch(/^[0-9a-f]{64}$/);

    global.__claveNodoIntegracion = evento.nuevaClave;
  });

  test('PATCH /api/nodes/:deviceId/block bloquea el nodo', async () => {
    const res = await request(app)
      .patch(`/api/nodes/${DEVICE_ID}/block`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('bloqueado');
  });

  test('un nodo bloqueado no puede volver a autenticarse', async () => {
    const socketReintento = io(`${BASE_URL}/nodes`, { reconnection: false, forceNew: true });

    const { reto } = await esperarEvento(socketReintento, 'reto_autenticacion');
    const respuesta = crypto
      .createHmac('sha256', global.__claveNodoIntegracion)
      .update(reto)
      .digest('hex');

    const authFallidaPromise = esperarEvento(socketReintento, 'auth_fallida');
    socketReintento.emit('handshake_nodo', { device_id: DEVICE_ID, respuesta });

    const resultado = await authFallidaPromise;
    expect(resultado.motivo).toBe('nodo_bloqueado');

    socketReintento.disconnect();
  });

  test('GET /api/events?nodeId= devuelve el historial de eventos del nodo', async () => {
    const res = await request(app)
      .get(`/api/events?nodeId=${DEVICE_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const tipos = res.body.map((ev) => ev.tipo);
    expect(tipos).toEqual(
      expect.arrayContaining(['registro', 'conexion', 'rotacion', 'bloqueo'])
    );
  });

  test('DELETE /api/nodes/:deviceId elimina el nodo', async () => {
    const resDelete = await request(app)
      .delete(`/api/nodes/${DEVICE_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDelete.status).toBe(200);

    const resGet = await request(app)
      .get(`/api/nodes/${DEVICE_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resGet.status).toBe(404);
  });
});
