const { encrypt, decrypt, generateKey } = require('./cipher');

describe('cipher.js - generateKey', () => {
  test('genera una clave hex de 64 caracteres (32 bytes / AES-256)', () => {
    const key = generateKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test('genera claves distintas en llamadas sucesivas', () => {
    const claves = new Set();
    for (let i = 0; i < 100; i++) claves.add(generateKey());
    expect(claves.size).toBe(100);
  });
});

describe('cipher.js - encrypt/decrypt', () => {
  let key;

  beforeEach(() => {
    key = generateKey();
  });

  test('decrypt(encrypt(texto)) devuelve el texto original', () => {
    const original = 'Hola Nodo B, conexión segura establecida';
    const cifrado = encrypt(original, key);
    const descifrado = decrypt(cifrado, key);
    expect(descifrado).toBe(original);
  });

  test('el formato de salida es "ivHex:cifradoHex"', () => {
    const cifrado = encrypt('mensaje de prueba', key);
    const partes = cifrado.split(':');
    expect(partes).toHaveLength(2);
    expect(partes[0]).toMatch(/^[0-9a-f]{32}$/); // IV de 16 bytes en hex
    expect(partes[1]).toMatch(/^[0-9a-f]+$/);
  });

  test('cifrar el mismo texto dos veces produce salidas distintas (IV aleatorio)', () => {
    const texto = 'mismo mensaje';
    const c1 = encrypt(texto, key);
    const c2 = encrypt(texto, key);
    expect(c1).not.toBe(c2);
    // pero ambos deben descifrar al mismo texto original
    expect(decrypt(c1, key)).toBe(texto);
    expect(decrypt(c2, key)).toBe(texto);
  });

  test('soporta texto vacío', () => {
    const cifrado = encrypt('', key);
    expect(decrypt(cifrado, key)).toBe('');
  });

  test('soporta caracteres unicode/emoji', () => {
    const original = 'Nodo 🔒 seguridad ñ é ü 中文';
    const cifrado = encrypt(original, key);
    expect(decrypt(cifrado, key)).toBe(original);
  });

  test('soporta mensajes largos', () => {
    const original = 'A'.repeat(5000);
    const cifrado = encrypt(original, key);
    expect(decrypt(cifrado, key)).toBe(original);
  });

  test('descifrar con una clave distinta falla', () => {
    const cifrado = encrypt('mensaje secreto', key);
    const otraClave = generateKey();
    expect(() => decrypt(cifrado, otraClave)).toThrow();
  });

  test('descifrar datos malformados (sin separador ":") falla', () => {
    expect(() => decrypt('esto-no-tiene-el-formato-correcto', key)).toThrow();
  });

  test('descifrar con IV corrupto falla (mensaje de un solo bloque de 16 bytes)', () => {
    // En AES-CBC, el IV solo afecta el primer bloque de texto plano. Con un
    // mensaje corto (menor a 16 bytes) todo el padding PKCS7 vive en ese
    // único bloque, así que un IV incorrecto sí rompe el padding y falla.
    const cifrado = encrypt('mensaje', key);
    const [, cuerpoCifrado] = cifrado.split(':');
    const ivCorrupto = '00'.repeat(16); // IV distinto al usado al cifrar
    expect(() => decrypt(`${ivCorrupto}:${cuerpoCifrado}`, key)).toThrow();
  });
});
