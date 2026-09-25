const crypto = require('crypto');

// GCM provides confidentiality *and* authentication.  The previous CBC
// implementation could not detect a modified ciphertext.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function validateKey(key) {
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('La clave AES-256 debe tener 64 caracteres hexadecimales');
  }
}

function encrypt(text, key, aad = '') {
  validateKey(key);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}:${cipher.getAuthTag().toString('hex')}`;
}

function decrypt(encryptedData, key, aad = '') {
  validateKey(key);
  const parts = String(encryptedData).split(':');
  const [ivHex, encrypted, authTagHex] = parts;
  if (parts.length !== 3 || !ivHex || encrypted === undefined || !authTagHex ||
      !/^[0-9a-f]*$/i.test(encrypted) || !/^[0-9a-f]+$/i.test(ivHex) ||
      !/^[0-9a-f]+$/i.test(authTagHex) || ivHex.length !== IV_LENGTH * 2 ||
      authTagHex.length !== AUTH_TAG_LENGTH * 2) {
    throw new Error('Cifrado AES-GCM malformado');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function generateKey() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { encrypt, decrypt, generateKey };
