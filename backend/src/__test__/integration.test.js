const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const request = require('supertest');
const { io } = require('socket.io-client');

jest.setTimeout(30000);

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
let basicToken;
const KIT_KEY = 'a'.repeat(64);

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
  const kit = db.prepare(`INSERT INTO kits (gateway_id, gateway_mac, claim_code_hash, owner_user_id)
    VALUES (?, ?, ?, ?)`).run('gateway-test', 'AA:BB:CC:DD:EE:FF', 'b'.repeat(64), 1);
  db.prepare(`INSERT INTO kit_devices (kit_id, device_id, mac_address, hmac_key)
    VALUES (?, ?, ?, ?)`).run(kit.lastInsertRowid, 'esp32-integracion-01', 'AA:BB:CC:DD:EE:01', KIT_KEY);
});

afterAll((done) => {
  server.close(() => {
    const db = require('../models/db');
    if (db.open) db.close();
    try {
      if (fs.existsSync(DB_TEST_PATH)) fs.unlinkSync(DB_TEST_PATH);
    } catch (error) {
      // OneDrive puede conservar brevemente el archivo aunque SQLite ya cerró.
      if (error.code !== 'EBUSY') throw error;
    }
    done();
  });
});

describe('Integración: registro de usuarios (POST /api/auth/register)', () => {
  test('registra un usuario nuevo correctamente', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nombre: 'Otro Usuario',
      email: 'otro@piloto.com',
      password: 'Password#1234',
      tieneConocimientoTecnico: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.mensaje).toMatch(/registrado/i);

    const login = await request(app).post('/api/auth/login').send({
      email: 'otro@piloto.com',
      password: 'Password#1234',
    });
    expect(login.body.usuario.rol).toBe('basico');
    basicToken = login.body.token;
  });

  test('rechaza un email ya registrado', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nombre: 'Duplicado',
      email: 'otro@piloto.com', // mismo email que la prueba anterior
      password: 'OtraPassword#123',
      tieneConocimientoTecnico: false,
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

describe('Integración: nivelación y autorización de usuarios', () => {
  test('un usuario básico puede solicitar acceso avanzado', async () => {
    const res = await request(app)
      .post('/api/auth/access-request')
      .set('Authorization', `Bearer ${basicToken}`)
      .send({ motivo: 'Necesito administrar nodos' });

    expect(res.status).toBe(201);
    expect(res.body.estadoAccesoAvanzado).toBe('pending');
  });

  test('un usuario básico no puede registrar nodos', async () => {
    const res = await request(app)
      .post('/api/nodes')
      .set('Authorization', `Bearer ${basicToken}`)
      .send({ deviceId: 'esp32-no-autorizado' });

    expect(res.status).toBe(403);
  });

  test('la experiencia técnica asigna el rol avanzado', async () => {
    await request(app).post('/api/auth/register').send({
      nombre: 'Usuario Avanzado',
      email: 'avanzado@piloto.com',
      password: 'Avanzada#2026',
      tieneConocimientoTecnico: true,
      aceptaRiesgosAvanzados: true,
      rol: 'basico',
    });
    const login = await request(app).post('/api/auth/login').send({
      email: 'avanzado@piloto.com',
      password: 'Avanzada#2026',
    });

    expect(login.body.usuario.rol).toBe('avanzado');
  });
});

describe('Integración: incorporación exclusiva de dispositivos del kit', () => {
  const gateway = 'gateway-basic';
  const deviceId = 'esp32-kit-basic-1';
  const mac = 'AA:BB:CC:DD:10:01';
  const key = 'c'.repeat(64);
  let kitId;

  test('el registro avanzado exige consentimiento explícito', async () => {
    const denied = await request(app).post('/api/auth/register').send({
      nombre: 'Sin Consentimiento', email: 'sinconsentimiento@piloto.com',
      password: 'Password#1234', tieneConocimientoTecnico: true,
    });
    expect(denied.status).toBe(400);
    expect(db.prepare('SELECT id FROM usuarios WHERE email = ?').get('sinconsentimiento@piloto.com')).toBeUndefined();
  });

  test('el usuario básico reclama su kit y solo ve candidatos del inventario', async () => {
    const kit = db.prepare('INSERT INTO kits (gateway_id, gateway_mac, claim_code_hash) VALUES (?, ?, ?)')
      .run(gateway, 'AA:BB:CC:DD:10:FF', crypto.createHash('sha256').update('CODIGO-KIT-BASIC-2026').digest('hex'));
    kitId = kit.lastInsertRowid;
    db.prepare('INSERT INTO kit_devices (kit_id, device_id, mac_address, hmac_key) VALUES (?, ?, ?, ?)')
      .run(kitId, deviceId, mac, key);
    const claimed = await request(app).post('/api/kits/claim')
      .set('Authorization', `Bearer ${basicToken}`).send({ claimCode: 'CODIGO-KIT-BASIC-2026' });
    expect(claimed.status).toBe(200);
    const scan = await request(app).post(`/api/kits/${kitId}/scans`)
      .set('Authorization', `Bearer ${basicToken}`).send({});
    expect(scan.status).toBe(202);
    const nonce = 42;
    const signature = crypto.createHmac('sha256', key).update(`${deviceId}:${mac}:wifi:${nonce}`).digest('hex');
    const foreign = await request(app).post('/api/kits/discovery')
      .set('x-kit-signature', signature)
      .send({ deviceId: 'otro-iot', macAddress: mac, transport: 'wifi', nonce });
    expect(foreign.status).toBe(403);
    const seen = await request(app).post('/api/kits/discovery')
      .set('x-kit-signature', signature)
      .send({ deviceId, macAddress: mac, transport: 'wifi', nonce });
    expect(seen.status).toBe(200);
    const candidates = await request(app).get(`/api/kits/${kitId}/candidates`)
      .set('Authorization', `Bearer ${basicToken}`);
    expect(candidates.body).toHaveLength(1);
    expect(candidates.body[0].device_id).toBe(deviceId);
  });

  test('solo un experimentado aprueba, y el nodo no existe operativamente antes', async () => {
    const inventory = db.prepare('SELECT id FROM kit_devices WHERE device_id = ?').get(deviceId);
    const submitted = await request(app).post(`/api/kits/${kitId}/requests`)
      .set('Authorization', `Bearer ${basicToken}`)
      .send({ kitDeviceId: inventory.id });
    expect(submitted.status).toBe(201);
    expect(db.prepare('SELECT id FROM nodos WHERE device_id = ?').get(deviceId)).toBeUndefined();
    const denied = await request(app).post(`/api/kits/requests/${submitted.body.id}/approve`)
      .set('Authorization', `Bearer ${basicToken}`).send({});
    expect(denied.status).toBe(403);
    const approved = await request(app).post(`/api/kits/requests/${submitted.body.id}/approve`)
      .set('Authorization', `Bearer ${token}`).send({});
    expect(approved.status).toBe(200);
    const node = db.prepare('SELECT admission_status, estado FROM nodos WHERE device_id = ?').get(deviceId);
    expect(node).toEqual({ admission_status: 'approved', estado: 'pendiente' });
  });
});

describe('Integración: registro y estado inicial del nodo', () => {
  const DEVICE_ID = 'esp32-integracion-01';
  const MAC_ADDRESS = 'AA:BB:CC:DD:EE:01';
  let claveCompartida;

  test('POST /api/nodes registra un nodo nuevo', async () => {
    const res = await request(app)
      .post('/api/nodes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceId: DEVICE_ID,
        macAddress: MAC_ADDRESS.toLowerCase(),
        descripcion: 'Nodo de prueba de integración',
      });

    expect(res.status).toBe(201);
    expect(res.body.deviceId).toBe(DEVICE_ID);
    expect(res.body.macAddress).toBe(MAC_ADDRESS);
    expect(res.body.estado).toBe('pendiente');
    const approved = await request(app).post(`/api/kits/requests/${res.body.requestId}/approve`)
      .set('Authorization', `Bearer ${token}`).send({});
    expect(approved.status).toBe(200);
    claveCompartida = KIT_KEY;
  });

  test('el nodo recién registrado queda con estado "pendiente"', async () => {
    const res = await request(app)
      .get(`/api/nodes/${DEVICE_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('pendiente');
    expect(res.body.mac_address).toBe(MAC_ADDRESS);
  });

  test('rechaza una MAC que ya pertenece a otro nodo', async () => {
    const res = await request(app)
      .post('/api/nodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: 'esp32-mac-duplicada', macAddress: MAC_ADDRESS });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/kit/i);
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
  let estadoHandshakePromise;

  beforeAll(() => {
    // Cliente del dashboard: namespace raíz, sin autenticación (igual que el frontend)
    socketDashboard = io(BASE_URL, { reconnection: false, forceNew: true, auth: { token } });
    // Cliente que simula el ESP32 real: namespace /nodes
    socketNodo = io(`${BASE_URL}/nodes`, { reconnection: false, forceNew: true, autoConnect: false });
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
    socketNodo.connect();
    const { reto } = await retoPromise;
    expect(reto).toMatch(/^[0-9a-f]{32}$/);

    const respuesta = crypto.createHmac('sha256', clave).update(reto).digest('hex');
    const authOkPromise = esperarEvento(socketNodo, 'auth_ok');
    estadoHandshakePromise = esperarEvento(socketDashboard, 'estado_red');
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
    const estadoActualizado = await estadoHandshakePromise;
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
    const claveAnterior = global.__claveNodoIntegracion;
    const claveRotadaPromise = esperarEvento(socketNodo, 'clave_rotada_nodo');

    const res = await request(app)
      .post(`/api/keys/${DEVICE_ID}/rotate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const evento = await claveRotadaPromise;
    expect(evento.device_id).toBe(DEVICE_ID);
    expect(evento.nuevaClave).toMatch(/^[0-9a-f]{64}$/);

    const syncBody = { deviceId: DEVICE_ID, sequence: 1, type: 1, payload: 'online' };
    const timestampAnterior = String(Date.now());
    const firmaAnterior = crypto.createHmac('sha256', claveAnterior)
      .update(`${DEVICE_ID}:${timestampAnterior}`).digest('hex');
    const orden = await request(app).post('/api/gateway/sync')
      .set('x-device-id', DEVICE_ID)
      .set('x-node-timestamp', timestampAnterior)
      .set('x-node-signature', firmaAnterior)
      .send(syncBody);
    expect(orden.status).toBe(200);
    expect(orden.body.commands).toContainEqual({
      deviceId: DEVICE_ID,
      type: 'rotate_key',
      payload: evento.nuevaClave,
    });

    const timestampActual = String(Date.now() + 1);
    const firmaActual = crypto.createHmac('sha256', evento.nuevaClave)
      .update(`${DEVICE_ID}:${timestampActual}`).digest('hex');
    const confirmacion = await request(app).post('/api/gateway/sync')
      .set('x-device-id', DEVICE_ID)
      .set('x-node-timestamp', timestampActual)
      .set('x-node-signature', firmaActual)
      .send({ ...syncBody, sequence: 2, type: 4, payload: 'key_rotated' });
    expect(confirmacion.status).toBe(200);
    expect(db.prepare('SELECT clave_anterior FROM nodos WHERE device_id = ?').get(DEVICE_ID).clave_anterior).toBeNull();

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
      expect.arrayContaining(['aprobacion', 'conexion', 'rotacion', 'bloqueo'])
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
