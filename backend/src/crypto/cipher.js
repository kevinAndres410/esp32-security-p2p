const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function encrypt(text, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedData, key) {
  const [ivHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function generateKey() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { encrypt, decrypt, generateKey };