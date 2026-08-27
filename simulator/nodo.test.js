const crypto = require('crypto');

// Mock de socket.io-client: nodo.js abre una conexión real en el constructor,
// así que interceptamos io() para controlar el socket sin red real.
jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

const { io } = require('socket.io-client');
const NodoESP32 = require('./nodo');

// Crea un socket falso que registra los handlers de .on() para poder
// dispararlos manualmente desde las pruebas, como si el servidor los emitiera.
function crearSocketFalso() {
  const handlers = {};
  return {
    handlers,
    on: jest.fn((evento, cb) => {
      handlers[evento] = cb;
    }),
    emit: jest.fn(),
    disparar(evento, payload) {
      if (handlers[evento]) handlers[evento](payload);
    },
  };
}

describe('NodoESP32 - handshake de autenticación mutua', () => {
  let socketFalso;
  const CLAVE = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    socketFalso = crearSocketFalso();
    io.mockReturnValue(socketFalso);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('se conecta al namespace /nodes del backend', () => {
    // eslint-disable-next-line no-unused-vars
    const nodo = new NodoESP32('esp32-A', CLAVE, 'http://localhost:5000');
    expect(io).toHaveBeenCalledWith('http://localhost:5000/nodes', { reconnection: true });
  });

  test('responde al reto con el HMAC-SHA256 correcto', () => {
    const nodo = new NodoESP32('esp32-A', CLAVE);
    const reto = crypto.randomBytes(16).toString('hex');

    socketFalso.disparar('reto_autenticacion', { reto });

    const respuestaEsperada = crypto.createHmac('sha256', CLAVE).update(reto).digest('hex');
    expect(socketFalso.emit).toHaveBeenCalledWith('handshake_nodo', {
      device_id: 'esp32-A',
      respuesta: respuestaEsperada,
    });
    expect(nodo.autenticado).toBe(false); // aún no llega auth_ok
  });

  test('marca el nodo como autenticado al recibir auth_ok', () => {
    const nodo = new NodoESP32('esp32-A', CLAVE);
    socketFalso.disparar('auth_ok');
    expect(nodo.autenticado).toBe(true);
  });

  test('no se autentica si recibe auth_fallida', () => {
    const nodo = new NodoESP32('esp32-A', CLAVE);
    socketFalso.disparar('auth_fallida', { motivo: 'firma_invalida' });
    expect(nodo.autenticado).toBe(false);
  });

  test('actualiza su clave cuando el backend rota la de este nodo', () => {
    const nodo = new NodoESP32('esp32-A', CLAVE);
    const nuevaClave = crypto.randomBytes(32).toString('hex');

    socketFalso.disparar('clave_rotada_nodo', { device_id: 'esp32-A', nuevaClave });

    expect(nodo.key).toBe(nuevaClave);
  });

  test('ignora rotación de clave dirigida a otro device_id', () => {
    const nodo = new NodoESP32('esp32-A', CLAVE);
    const claveOriginal = nodo.key;

    socketFalso.disparar('clave_rotada_nodo', {
      device_id: 'esp32-B',
      nuevaClave: crypto.randomBytes(32).toString('hex'),
    });

    expect(nodo.key).toBe(claveOriginal);
  });

  test('al desconectarse, deja de estar autenticado', () => {
    const nodo = new NodoESP32('esp32-A', CLAVE);
    socketFalso.disparar('auth_ok');
    expect(nodo.autenticado).toBe(true);

    socketFalso.disparar('disconnect');
    expect(nodo.autenticado).toBe(false);
  });
});

describe('NodoESP32 - heartbeat', () => {
  let socketFalso;
  const CLAVE = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    socketFalso = crearSocketFalso();
    io.mockReturnValue(socketFalso);
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('empieza a enviar heartbeat solo después de auth_ok', () => {
    const nodo = new NodoESP32('esp32-A', CLAVE);

    jest.advanceTimersByTime(10000);
    expect(socketFalso.emit).not.toHaveBeenCalledWith('heartbeat', expect.anything());

    socketFalso.disparar('auth_ok');
    jest.advanceTimersByTime(10000);

    expect(socketFalso.emit).toHaveBeenCalledWith('heartbeat', { device_id: 'esp32-A' });
  });

  test('envía heartbeat cada 10 segundos de forma repetida', () => {
    // eslint-disable-next-line no-unused-vars
    const nodo = new NodoESP32('esp32-A', CLAVE);
    socketFalso.disparar('auth_ok');

    jest.advanceTimersByTime(35000); // ~3.5 intervalos

    const llamadasHeartbeat = socketFalso.emit.mock.calls.filter((c) => c[0] === 'heartbeat');
    expect(llamadasHeartbeat.length).toBe(3);
  });

  test('deja de enviar heartbeat después de desconectarse', () => {
    // eslint-disable-next-line no-unused-vars
    const nodo = new NodoESP32('esp32-A', CLAVE);
    socketFalso.disparar('auth_ok');
    jest.advanceTimersByTime(10000);

    socketFalso.disparar('disconnect');
    socketFalso.emit.mockClear();

    jest.advanceTimersByTime(30000);
    const llamadasHeartbeat = socketFalso.emit.mock.calls.filter((c) => c[0] === 'heartbeat');
    expect(llamadasHeartbeat.length).toBe(0);
  });
});

describe('NodoESP32 - canal P2P (enviarMensaje / recibirMensaje)', () => {
  const CLAVE = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    io.mockReturnValue(crearSocketFalso());
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('un mensaje enviado entre dos nodos con la misma clave se descifra correctamente', () => {
    const nodoA = new NodoESP32('esp32-A', CLAVE);
    const nodoB = new NodoESP32('esp32-B', CLAVE);
    const logSpy = jest.spyOn(console, 'log');

    nodoA.enviarMensaje(nodoB, 'Hola Nodo B, conexión segura establecida');

    const logDescifrado = logSpy.mock.calls
      .map((c) => c.join(' '))
      .find((linea) => linea.includes('Descifrado'));

    expect(logDescifrado).toContain('Hola Nodo B, conexión segura establecida');
  });

  test('el mensaje viaja cifrado (no aparece en texto plano antes de recibirMensaje)', () => {
    const nodoA = new NodoESP32('esp32-A', CLAVE);
    const nodoB = new NodoESP32('esp32-B', CLAVE);
    const spyRecibir = jest.spyOn(nodoB, 'recibirMensaje');

    nodoA.enviarMensaje(nodoB, 'información confidencial');

    const [, cifradoRecibido] = spyRecibir.mock.calls[0];
    expect(cifradoRecibido).not.toContain('información confidencial');
    expect(cifradoRecibido).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/); // formato ivHex:cifradoHex
  });

  test('recibirMensaje con una clave incorrecta falla al descifrar', () => {
    const nodoA = new NodoESP32('esp32-A', CLAVE);
    const nodoB = new NodoESP32('esp32-B', CLAVE);

    const cifrado = require('./cipher').encrypt('mensaje', CLAVE);
    const claveIncorrecta = crypto.randomBytes(32).toString('hex');

    expect(() => nodoB.recibirMensaje(nodoA.deviceId, cifrado, claveIncorrecta)).toThrow();
  });
});
