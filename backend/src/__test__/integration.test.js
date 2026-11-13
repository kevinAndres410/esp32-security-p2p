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
let adminToken;
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
  process.env.MASTER_ENCRYPTION_KEY = 'clave-maestra-de-prueba-32-bytes-minimo';

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
  db.prepare(`INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)`)
    .run('Master Admin', 'admin@piloto.com', passwordHash, 'master_admin');
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@piloto.com', password: 'Password123' });
  adminToken = adminLogin.body.token;
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

  test('Tabla 8A SQLi: no permite iniciar sesión con una condición SQL inyectada', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
    const res = await request(app).post('/api/auth/login').send({
      email: "' OR 1=1 --",
      password: 'Password123',
    });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n).toBe(before);
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

  test('Tabla 8A rol: un usuario básico no puede registrar nodos', async () => {
    const res = await request(app)
      .post('/api/nodes')
      .set('Authorization', `Bearer ${basicToken}`)
      .send({ deviceId: 'esp32-no-autorizado' });

    expect(res.status).toBe(403);
  });

  test('la experiencia técnica crea una solicitud y el administrador concede el rol', async () => {
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

    expect(login.body.usuario.rol).toBe('basico');
    expect(login.body.usuario.estadoAccesoAvanzado).toBe('pending');
    const pending = await request(app).get('/api/master-admin/access-requests')
      .set('Authorization', `Bearer ${adminToken}`);
    const access = pending.body.find((item) => item.email === 'avanzado@piloto.com');
    expect(access.status).toBe('pending');
    const approved = await request(app).post(`/api/master-admin/access-requests/${access.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`).send({ decision: 'approved' });
    expect(approved.status).toBe(200);
    const relogin = await request(app).post('/api/auth/login').send({
      email: 'avanzado@piloto.com', password: 'Avanzada#2026',
    });
    expect(relogin.body.usuario.rol).toBe('avanzado');
    const oldSession = await request(app).get('/api/nodes')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(oldSession.status).toBe(403);
  });
});

describe('Integración: módulo Administrador Maestro', () => {
  let createdKitId;

  test('rechaza a un usuario avanzado que no es administrador', async () => {
    const response = await request(app).get('/api/master-admin/kits')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  test('cifra la contraseña Wi-Fi y nunca la devuelve', async () => {
    const saved = await request(app).put('/api/master-admin/wifi')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ssid: 'SecureMesh-Test', password: 'ClaveWifi#2026', securityType: 'WPA3' });
    expect(saved.status).toBe(200);
    const stored = db.prepare('SELECT password_ciphertext FROM wifi_config WHERE id = 1').get();
    expect(stored.password_ciphertext).not.toContain('ClaveWifi#2026');
    const read = await request(app).get('/api/master-admin/wifi')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(read.body.passwordConfigured).toBe(true);
    expect(read.body.password).toBeUndefined();
    const networks = await request(app).get('/api/master-admin/wifi/networks')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(networks.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ ssid: 'SecureMesh-Test', securityType: 'WPA3', passwordConfigured: true }),
    ]));
    expect(JSON.stringify(networks.body)).not.toContain('ClaveWifi#2026');
  });

  test('distingue prueba Wi-Fi de aplicación confirmada por el Gateway', async () => {
    process.env.WIFI_PROVISIONING_URL = 'https://gateway.prueba.local';
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/apply')
        ? { applied: true, connected: true, message: 'Aplicada' }
        : { connected: true, message: 'Prueba correcta' },
    }));
    try {
      const tested = await request(app).post('/api/master-admin/wifi/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ssid: 'SecureMesh-Test', securityType: 'WPA3' });
      expect(tested.body.ok).toBe(true);
      expect(db.prepare('SELECT connection_status FROM wifi_config WHERE id = 1').get().connection_status).toBe('test_ok');
      const applied = await request(app).post('/api/master-admin/wifi/apply')
        .set('Authorization', `Bearer ${adminToken}`).send({});
      expect(applied.body.ok).toBe(true);
      expect(db.prepare('SELECT connection_status FROM wifi_config WHERE id = 1').get().connection_status).toBe('connected');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
      delete process.env.WIFI_PROVISIONING_URL;
    }
  });

  test('exige exactamente tres nodos diferentes', async () => {
    const denied = await request(app).post('/api/master-admin/kits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gatewayIdentifier: 'GW-MASTER-01', nodeIdentifiers: ['NODE-M-01', 'NODE-M-02'] });
    expect(denied.status).toBe(400);
  });

  test('exige una red registrada y conserva la red específica de cada kit', async () => {
    const invalid = await request(app).post('/api/master-admin/kits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gatewayIdentifier: 'GW-NO-WIFI', nodeIdentifiers: ['NODO-A', 'NODO-B', 'NODO-C'] });
    expect(invalid.status).toBe(400);
    const second = await request(app).put('/api/master-admin/wifi')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ssid: 'Red-Otra', password: 'OtraClave#2026', securityType: 'WPA2' });
    expect(second.status).toBe(200);
    const networks = await request(app).get('/api/master-admin/wifi/networks')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(networks.body.map((item) => item.ssid)).toEqual(expect.arrayContaining(['SecureMesh-Test', 'Red-Otra']));
  });

  test('crea el correlativo, la clave segura y los tres componentes', async () => {
    const network = db.prepare('SELECT id FROM wifi_networks WHERE ssid = ?').get('SecureMesh-Test');
    const created = await request(app).post('/api/master-admin/kits')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        gatewayIdentifier: 'GW-MASTER-01',
        nodeIdentifiers: ['NODE-M-01', 'NODE-M-02', 'NODE-M-03'],
        wifiNetworkId: network.id,
        notes: 'Kit de integración',
      });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe(`Kit ${created.body.id}`);
    expect(created.body.uniqueKey).toMatch(new RegExp(`^KIT-${created.body.id}-[A-Z0-9]+$`));
    expect(created.body.components).toHaveLength(3);
    expect(created.body.wifiSsid).toBe('SecureMesh-Test');
    expect(created.body.wifiNetworkId).toBe(network.id);
    expect(JSON.stringify(created.body)).not.toContain('ClaveWifi#2026');
    const otherNetwork = db.prepare('SELECT id FROM wifi_networks WHERE ssid = ?').get('Red-Otra');
    const updated = await request(app).patch(`/api/master-admin/kits/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ wifiNetworkId: otherNetwork.id });
    expect(updated.body.wifiSsid).toBe('Red-Otra');
    createdKitId = created.body.id;
  });

  test('aplica únicamente la red del kit y exige confirmación del Gateway correcto', async () => {
    process.env.WIFI_PROVISIONING_URL = 'https://gateway.prueba.local';
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url, options) => ({
      ok: true,
      json: async () => ({ applied: true, connected: true, gatewayIdentifier: 'otro-gateway' }),
    }));
    try {
      const rejected = await request(app).post(`/api/master-admin/kits/${createdKitId}/wifi/apply`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(rejected.body.ok).toBe(false);
      const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(payload.ssid).toBe('Red-Otra');
      expect(payload.gatewayIdentifier).toBe('GW-MASTER-01');
      global.fetch.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ applied: true, connected: true, gatewayIdentifier: 'GW-MASTER-01' }),
      }));
      const applied = await request(app).post(`/api/master-admin/kits/${createdKitId}/wifi/apply`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(applied.body.ok).toBe(true);
    } finally {
      global.fetch = originalFetch;
      delete process.env.WIFI_PROVISIONING_URL;
    }
  });

  test('edita Gateway y nodos solo sin actividad, sin duplicados y manteniendo 1 + 3', async () => {
    const getKit = () => request(app).get(`/api/master-admin/kits/${createdKitId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const original = (await getKit()).body;
    const identifiers = ['NODE-M-01', 'NODE-M-02', 'NODE-M-03'];
    const edit = (gatewayIdentifier, nodeIdentifiers) => request(app)
      .patch(`/api/master-admin/kits/${createdKitId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gatewayIdentifier, nodeIdentifiers, wifiNetworkId: original.wifiNetworkId });

    db.prepare(`INSERT INTO nodos (device_id, estado, admission_status, ultima_actividad)
      VALUES ('NODE-M-01', 'activo', 'approved', CURRENT_TIMESTAMP)`).run();
    expect((await edit('GW-MASTER-01', ['NODE-M-04', ...identifiers.slice(1)])).status).toBe(409);
    expect((await getKit()).body.components.map((item) => item.identifier)).toContain('NODE-M-01');
    expect((await edit('GW-MASTER-01', ['esp32-integracion-01', ...identifiers.slice(1)])).status).toBe(409);
    expect((await edit('gateway-test', identifiers)).status).toBe(409);
    expect((await edit('GW-MASTER-01', ['NODE-M-02', 'NODE-M-02', 'NODE-M-03'])).status).toBe(400);
    expect((await edit('GW-MASTER-01', ['NODE-M-02', 'NODE-M-03'])).status).toBe(400);

    db.prepare("UPDATE nodos SET ultima_actividad = datetime('now', '-5 minutes') WHERE device_id = 'NODE-M-01'").run();
    const replaced = await edit('GW-MASTER-02', ['NODE-M-04', ...identifiers.slice(1)]);
    expect(replaced.status).toBe(200);
    expect(replaced.body.gatewayIdentifier).toBe('GW-MASTER-02');
    expect(replaced.body.components.map((item) => item.identifier)).toContain('NODE-M-04');
    expect(replaced.body.components).toHaveLength(3);
    expect(db.prepare("SELECT id FROM kit_devices WHERE device_id = 'NODE-M-01'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM nodos WHERE device_id = 'NODE-M-01'").get()).toBeUndefined();

    db.prepare('UPDATE kits SET gateway_last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(createdKitId);
    expect((await edit('GW-MASTER-03', ['NODE-M-04', ...identifiers.slice(1)])).status).toBe(409);
    db.prepare("UPDATE kits SET gateway_last_seen_at = datetime('now', '-5 minutes') WHERE id = ?").run(createdKitId);
  });

  test('edita información secundaria y elimina el kit transaccionalmente', async () => {
    const updated = await request(app).patch(`/api/master-admin/kits/${createdKitId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive', notes: 'Fuera de servicio' });
    expect(updated.body.status).toBe('inactive');
    const removed = await request(app).delete(`/api/master-admin/kits/${createdKitId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(204);
    expect(db.prepare('SELECT id FROM kits WHERE id = ?').get(createdKitId)).toBeUndefined();
    expect(db.prepare('SELECT id FROM kit_devices WHERE kit_id = ?').all(createdKitId)).toHaveLength(0);
  });
});

describe('Integración: gestión integral del Administrador Maestro', () => {
  test('el usuario básico no consulta auditoría ni eventos de otro kit', async () => {
    const deniedAudit = await request(app).get('/api/master-admin/audit')
      .set('Authorization', `Bearer ${basicToken}`);
    expect(deniedAudit.status).toBe(403);
    const foreign = db.prepare('INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)')
      .run('auth_failure', 'Evento de un nodo ajeno', 'NODE-EXTERNO-01');
    const deniedEvent = await request(app).get(`/api/events/${foreign.lastInsertRowid}`)
      .set('Authorization', `Bearer ${basicToken}`);
    expect(deniedEvent.status).toBe(404);
  });

  test('gestiona usuarios y protege la única cuenta maestra', async () => {
    const users = await request(app).get('/api/master-admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(users.status).toBe(200);
    expect(users.body.some((user) => user.email === 'admin@piloto.com')).toBe(true);
    const self = db.prepare("SELECT id FROM usuarios WHERE email = 'admin@piloto.com'").get();
    const denied = await request(app).patch(`/api/master-admin/users/${self.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ blocked: true });
    expect(denied.status).toBe(409);
    const cannotGrant = await request(app).patch('/api/master-admin/users/1')
      .set('Authorization', `Bearer ${adminToken}`).send({ role: 'master_admin' });
    expect(cannotGrant.status).toBe(400);
    expect(() => db.prepare(`INSERT INTO usuarios (nombre, email, password, rol)
      VALUES ('Otro maestro', 'otro.maestro@piloto.com', 'hash', 'master_admin')`).run()).toThrow();
    const basic = db.prepare("SELECT id FROM usuarios WHERE email = 'otro@piloto.com'").get();
    const blocked = await request(app).patch(`/api/master-admin/users/${basic.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ blocked: true });
    expect(blocked.status).toBe(200);
    const oldSession = await request(app).get('/api/nodes')
      .set('Authorization', `Bearer ${basicToken}`);
    expect(oldSession.status).toBe(403);
    const unblocked = await request(app).patch(`/api/master-admin/users/${basic.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ blocked: false });
    expect(unblocked.status).toBe(200);
    const newSession = await request(app).post('/api/auth/login').send({
      email: 'otro@piloto.com', password: 'Password#1234',
    });
    basicToken = newSession.body.token;
  });

  test('asigna kits, expone monitoreo y guarda el intervalo de rotación', async () => {
    const kit = db.prepare(`INSERT INTO kits (gateway_id, gateway_mac, claim_code_hash)
      VALUES (?, ?, ?)`).run('gateway-admin-assign', 'AA:BB:CC:DD:AF:FF', 'f'.repeat(64));
    const basic = db.prepare("SELECT id FROM usuarios WHERE email = 'otro@piloto.com'").get();
    const assigned = await request(app).patch(`/api/master-admin/kits/${kit.lastInsertRowid}/owner`)
      .set('Authorization', `Bearer ${adminToken}`).send({ ownerUserId: basic.id });
    expect(assigned.status).toBe(200);
    expect(db.prepare('SELECT owner_user_id FROM kits WHERE id = ?').get(kit.lastInsertRowid).owner_user_id).toBe(basic.id);
    const monitoring = await request(app).get('/api/master-admin/monitoring')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(monitoring.status).toBe(200);
    expect(monitoring.body.counts.kits).toBeGreaterThan(0);
    const settings = await request(app).put('/api/master-admin/settings')
      .set('Authorization', `Bearer ${adminToken}`).send({ rotationMinutes: 10 });
    expect(settings.body.rotationMinutes).toBe(10);
    const audit = await request(app).get('/api/master-admin/audit')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.body.some((entry) => entry.action === 'kit.assigned')).toBe(true);
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

  test('Tabla 8A CSRF: una petición de otro origen sin Bearer no bloquea el nodo', async () => {
    const before = db.prepare('SELECT estado FROM nodos WHERE device_id = ?').get(DEVICE_ID);
    const res = await request(app).patch(`/api/nodes/${DEVICE_ID}/block`)
      .set('Origin', 'https://otro-origen.invalid')
      .set('Cookie', 'token=falso')
      .send({});
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).not.toBe('https://otro-origen.invalid');
    expect(db.prepare('SELECT estado FROM nodos WHERE device_id = ?').get(DEVICE_ID)).toEqual(before);
  });

  test('Tabla 8A dispositivo ajeno: la API rechaza una identidad no inventariada', async () => {
    const deviceId = 'lab-unknown-s3';
    const eventsBefore = db.prepare('SELECT COUNT(*) AS n FROM eventos').get().n;
    const res = await request(app).post('/api/gateway/sync')
      .set('x-device-id', deviceId)
      .set('x-node-timestamp', String(Date.now()))
      .set('x-node-signature', '0'.repeat(64))
      .send({ deviceId, sequence: 1, type: 1, payload: 'online' });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT id FROM nodos WHERE device_id = ?').get(deviceId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM eventos').get().n).toBe(eventsBefore);
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

  test('Tabla 8A clave anterior: rotación, ACK y rechazo de la clave antigua', async () => {
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
    const gatewayPresence = db.prepare(`SELECT k.gateway_last_seen_at FROM kits k
      JOIN kit_devices d ON d.kit_id = k.id WHERE d.device_id = ?`).get(DEVICE_ID);
    expect(gatewayPresence.gateway_last_seen_at).not.toBeNull();
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

    const timestampReused = String(Date.now() + 2);
    const oldSignature = crypto.createHmac('sha256', claveAnterior)
      .update(`${DEVICE_ID}:${timestampReused}`).digest('hex');
    const oldKeyAttempt = await request(app).post('/api/gateway/sync')
      .set('x-device-id', DEVICE_ID)
      .set('x-node-timestamp', timestampReused)
      .set('x-node-signature', oldSignature)
      .send({ ...syncBody, sequence: 3, type: 1, payload: 'online' });
    expect(oldKeyAttempt.status).toBe(401);
    expect(db.prepare('SELECT id FROM muestras_rendimiento WHERE device_id = ? AND secuencia_protocolo = ?')
      .get(DEVICE_ID, 3)).toBeUndefined();

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

describe('Integración: sustitución física de un nodo del kit', () => {
  test('solo el propietario avanzado cambia la MAC después de eliminar el nodo anterior', async () => {
    const kit = db.prepare(`INSERT INTO kits
      (gateway_id, gateway_mac, claim_code_hash, owner_user_id) VALUES (?, ?, ?, ?)`)
      .run('gateway-replacement-test', 'AA:BB:CC:DD:20:FF', 'c'.repeat(64), 1);
    const kitId = Number(kit.lastInsertRowid);
    const deviceId = 'esp32-replacement-02';
    db.prepare(`INSERT INTO kit_devices
      (kit_id, device_id, mac_address, hmac_key, component_role)
      VALUES (?, ?, ?, ?, 'node_2')`)
      .run(kitId, deviceId, 'AA:BB:CC:DD:20:02', KIT_KEY);
    db.prepare(`INSERT INTO nodos
      (device_id, mac_address, estado, clave_actual, admission_status)
      VALUES (?, ?, 'pendiente', ?, 'approved')`)
      .run(deviceId, 'AA:BB:CC:DD:20:02', KIT_KEY);
    const url = `/api/kits/${kitId}/nodes/${deviceId}/hardware`;
    const payload = { macAddress: '38:18:2B:8A:16:6C' };
    const asOtherAccount = await request(app).patch(url)
      .set('Authorization', `Bearer ${adminToken}`).send(payload);
    expect(asOtherAccount.status).toBe(404);
    const stillRegistered = await request(app).patch(url)
      .set('Authorization', `Bearer ${token}`).send(payload);
    expect(stillRegistered.status).toBe(409);
    const removed = await request(app).delete(`/api/nodes/${deviceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    const replaced = await request(app).patch(url)
      .set('Authorization', `Bearer ${token}`).send(payload);
    expect(replaced.status).toBe(200);
    const inventory = db.prepare(`SELECT mac_address, hmac_key, component_role
      FROM kit_devices WHERE kit_id = ?`).all(kitId);
    expect(inventory).toEqual([{ mac_address: payload.macAddress, hmac_key: KIT_KEY, component_role: 'node_2' }]);
  });
});

describe('Integración: configuración dinámica y revocación física', () => {
  test('exige credenciales de fábrica, confirma aplicación y telemetría antes de mostrar conexión', async () => {
    const { encryptSecret } = require('../crypto/secretVault');
    const control = crypto.randomBytes(32).toString('hex');
    const kit = db.prepare(`INSERT INTO kits
      (gateway_id, gateway_mac, claim_code_hash, owner_user_id, gateway_control_secret_ciphertext)
      VALUES (?, ?, ?, ?, ?)`).run(
      'gateway-dynamic-test', 'AA:BB:CC:DD:40:FF', 'd'.repeat(64), 1, encryptSecret(control));
    const kitId = Number(kit.lastInsertRowid);
    const activation = 'F'.repeat(32);
    const factoryKey = '2'.repeat(64);
    const secondKey = '3'.repeat(64);
    const registerFactory = (id, mac, key, code) => db.prepare(`INSERT INTO factory_nodes
      (kit_id, device_id, mac_address, hmac_key, lmk_hex, activation_hash)
      VALUES (?, ?, ?, ?, ?, ?)`).run(kitId, id, mac, key, '1'.repeat(32),
      crypto.createHash('sha256').update(code).digest('hex'));
    registerFactory('dynamic-node-a', 'AA:BB:CC:DD:40:01', factoryKey, activation);
    registerFactory('dynamic-node-b', 'AA:BB:CC:DD:40:02', secondKey, 'E'.repeat(32));
    const operationUrl = `/api/kits/${kitId}/operations`;
    const rejected = await request(app).post(operationUrl).set('Authorization', `Bearer ${token}`)
      .send({ action: 'add', activationCode: '0'.repeat(32) });
    expect(rejected.status).toBe(403);
    const added = await request(app).post(operationUrl).set('Authorization', `Bearer ${token}`)
      .send({ action: 'add', activationCode: activation });
    expect(added.status).toBe(202);
    expect(added.body.status).toBe('pending_gateway');
    expect(db.prepare("SELECT admission_status FROM nodos WHERE device_id = 'dynamic-node-a'").get().admission_status)
      .toBe('pending');

    const poll = async () => {
      const nonce = crypto.randomBytes(16).toString('hex');
      const signature = crypto.createHmac('sha256', control)
        .update(`config:gateway-dynamic-test:${nonce}`).digest('hex');
      const response = await request(app).get('/api/gateway/config')
        .set('x-gateway-id', 'gateway-dynamic-test')
        .set('x-gateway-nonce', nonce)
        .set('x-gateway-signature', signature);
      expect(response.status).toBe(200);
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(control, 'hex'),
        Buffer.from(response.body.iv, 'hex'));
      decipher.setAAD(Buffer.from(`gateway-dynamic-test:${nonce}:${response.body.version}`));
      decipher.setAuthTag(Buffer.from(response.body.tag, 'hex'));
      const config = JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(response.body.ciphertext, 'hex')), decipher.final(),
      ]).toString());
      const ackSignature = crypto.createHmac('sha256', control)
        .update(`ack:gateway-dynamic-test:${config.version}:${nonce}`).digest('hex');
      const acknowledge = () => request(app).post('/api/gateway/config/ack')
        .set('x-gateway-id', 'gateway-dynamic-test')
        .set('x-gateway-nonce', nonce)
        .set('x-gateway-signature', ackSignature)
        .send({ version: config.version });
      return { config, acknowledge };
    };

    const initial = await poll();
    expect(initial.config.peers.map((peer) => peer.deviceId)).toEqual(['dynamic-node-a']);
    expect((await initial.acknowledge()).status).toBe(200);
    expect(db.prepare('SELECT status FROM kit_device_operations WHERE id = ?').get(added.body.id).status)
      .toBe('awaiting_telemetry');
    const sync = (id, key, sequence) => request(app).post('/api/gateway/sync')
      .set('x-device-id', id).set('x-node-timestamp', '1234')
      .set('x-node-signature', crypto.createHmac('sha256', key).update(`${id}:1234`).digest('hex'))
      .send({ deviceId: id, sequence, type: 1, payload: '{}' });
    expect((await sync('dynamic-node-a', factoryKey, 1)).status).toBe(200);
    expect(db.prepare('SELECT status FROM kit_device_operations WHERE id = ?').get(added.body.id).status)
      .toBe('online');

    db.prepare('UPDATE nodos SET clave_anterior = clave_actual, clave_actual = ? WHERE device_id = ?')
      .run('4'.repeat(64), 'dynamic-node-a');
    const rotating = await poll();
    expect(rotating.config.peers[0].key).toBe('4'.repeat(64));
    expect(rotating.config.peers[0].previousKey).toBe(factoryKey);
    db.prepare('UPDATE nodos SET clave_actual = ?, clave_anterior = NULL WHERE device_id = ?')
      .run(factoryKey, 'dynamic-node-a');

    const replaced = await request(app).post(operationUrl).set('Authorization', `Bearer ${token}`)
      .send({ action: 'replace', deviceId: 'dynamic-node-a', activationCode: 'E'.repeat(32) });
    expect(replaced.status).toBe(202);
    expect((await sync('dynamic-node-a', factoryKey, 2)).status).toBe(403);
    expect(db.prepare('SELECT hmac_key, lmk_hex FROM kit_devices WHERE device_id = ?')
      .get('dynamic-node-a')).toEqual({ hmac_key: '', lmk_hex: null });
    const replacementConfig = await poll();
    expect(replacementConfig.config.peers.map((peer) => peer.deviceId)).toEqual(['dynamic-node-b']);
    expect((await replacementConfig.acknowledge()).status).toBe(200);
    expect((await sync('dynamic-node-b', secondKey, 1)).status).toBe(200);
    expect(db.prepare('SELECT status FROM kit_device_operations WHERE id = ?').get(replaced.body.id).status)
      .toBe('online');

    const removed = await request(app).post(operationUrl).set('Authorization', `Bearer ${token}`)
      .send({ action: 'remove', deviceId: 'dynamic-node-b' });
    expect(removed.status).toBe(202);
    expect((await sync('dynamic-node-b', secondKey, 2)).status).toBe(403);
    const emptyConfig = await poll();
    expect(emptyConfig.config.peers).toEqual([]);
    expect((await emptyConfig.acknowledge()).status).toBe(200);
    expect(db.prepare('SELECT status FROM kit_device_operations WHERE id = ?').get(removed.body.id).status)
      .toBe('removed');
  });
});

describe('Integración: respaldo y restauración del administrador', () => {
  test('restaura una copia íntegra y revoca las sesiones previas', async () => {
    const backup = await request(app).get('/api/master-admin/backup')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(backup.status).toBe(200);
    expect(Buffer.isBuffer(backup.body)).toBe(true);
    expect(backup.body.subarray(0, 16).toString()).toBe('SQLite format 3\0');
    await request(app).put('/api/master-admin/settings')
      .set('Authorization', `Bearer ${adminToken}`).send({ rotationMinutes: 12 });
    const restored = await request(app).post('/api/master-admin/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/octet-stream')
      .set('x-restore-confirmation', 'RESTAURAR')
      .send(backup.body);
    expect(restored.status).toBe(200);
    expect(restored.body.restored).toBe(true);
    expect(db.prepare("SELECT value FROM app_settings WHERE key = 'key_rotation_minutes'").get().value).toBe('10');
    const revoked = await request(app).get('/api/master-admin/health')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revoked.status).toBe(403);
  });
});
