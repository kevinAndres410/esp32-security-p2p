// keyManager.js mantiene estado a nivel de módulo (currentKey, rotationInterval),
// así que cada test recarga el módulo desde cero con jest.resetModules()
// para no arrastrar estado ni temporizadores entre pruebas.

describe('keyManager.js', () => {
  let keyManager;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    keyManager = require('./keyManager');
  });

  afterEach(() => {
    keyManager.stopRotation();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('getCurrentKey() devuelve una clave hex válida al iniciar', () => {
    const key = keyManager.getCurrentKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test('rotateKey() cambia la clave actual', () => {
    const antes = keyManager.getCurrentKey();
    const { oldKey, newKey } = keyManager.rotateKey();

    expect(oldKey).toBe(antes);
    expect(newKey).not.toBe(antes);
    expect(keyManager.getCurrentKey()).toBe(newKey);
  });

  test('rotateKey() sucesivas siempre generan claves distintas', () => {
    const claves = new Set([keyManager.getCurrentKey()]);
    for (let i = 0; i < 20; i++) {
      claves.add(keyManager.rotateKey().newKey);
    }
    expect(claves.size).toBe(21);
  });

  test('startRotation() rota automáticamente al cumplirse el intervalo', () => {
    const inicial = keyManager.getCurrentKey();

    keyManager.startRotation(5); // 5 minutos
    expect(keyManager.getCurrentKey()).toBe(inicial); // aún no ha pasado el tiempo

    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(keyManager.getCurrentKey()).not.toBe(inicial);
  });

  test('startRotation() usa 5 minutos por defecto si no se especifica intervalo', () => {
    const inicial = keyManager.getCurrentKey();
    keyManager.startRotation();

    jest.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
    expect(keyManager.getCurrentKey()).toBe(inicial); // todavía no rota

    jest.advanceTimersByTime(1000);
    expect(keyManager.getCurrentKey()).not.toBe(inicial); // ya rotó al llegar a 5 min
  });

  test('startRotation() llamado dos veces no duplica la rotación', () => {
    const logSpy = jest.spyOn(console, 'log');

    keyManager.startRotation(5);
    keyManager.startRotation(5); // debe limpiar el intervalo anterior, no crear uno segundo
    logSpy.mockClear();

    jest.advanceTimersByTime(5 * 60 * 1000);

    const logsDeRotacion = logSpy.mock.calls.filter((call) =>
      String(call[0]).includes('Clave rotada')
    );
    expect(logsDeRotacion).toHaveLength(1); // si hubiera 2 intervalos activos, serían 2
  });

  test('stopRotation() detiene la rotación automática', () => {
    keyManager.startRotation(5);
    keyManager.stopRotation();

    const clave = keyManager.getCurrentKey();
    jest.advanceTimersByTime(30 * 60 * 1000); // avanza mucho más que el intervalo

    expect(keyManager.getCurrentKey()).toBe(clave); // no cambió, la rotación estaba detenida
  });

  test('stopRotation() es seguro llamarlo aunque no haya rotación activa', () => {
    expect(() => keyManager.stopRotation()).not.toThrow();
  });
});
