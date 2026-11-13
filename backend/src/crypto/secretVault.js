const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function encryptionKey() {
  if (!process.env.MASTER_ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
    throw new Error('MASTER_ENCRYPTION_KEY es obligatoria en producción');
  }
  const material = process.env.MASTER_ENCRYPTION_KEY || process.env.JWT_SECRET;
  return crypto.createHash('sha256').update(material || 'solo-desarrollo-cambiar').digest();
}

function encryptSecret(value) {
  if (value === null || value === undefined || value === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptSecret(payload) {
  if (!payload) return null;
  const [version, iv, tag, encrypted] = String(payload).split('.');
  if (version !== VERSION || !iv || !tag || !encrypted) throw new Error('Secreto cifrado inválido');
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
