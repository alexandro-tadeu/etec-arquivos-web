'use strict';
// ETEC Web v3.0 — utilitarios criptograficos. Ainda nao ligados ao servidor v2.
// As chaves devem vir de um gestor de segredos, nunca do repositorio.
const crypto = require('node:crypto');

const POLICY_BOUNDS = Object.freeze({
  minTtlSeconds: 300,
  maxTtlSeconds: 3600,
  minAttempts: 1,
  maxAttempts: 5
});

function assertKey(hex, label) {
  if (typeof hex !== 'string' || !/^[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error(label + ' deve ser uma chave aleatoria de 32 bytes em hexadecimal.');
  }
  return Buffer.from(hex, 'hex');
}

function validateBootstrapPolicy(policy, bounds = POLICY_BOUNDS) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('Politica ausente.');
  const {ttlSeconds, maxAttempts} = policy;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < bounds.minTtlSeconds || ttlSeconds > bounds.maxTtlSeconds) {
    throw new Error('Validade fora dos limites tecnicos.');
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < bounds.minAttempts || maxAttempts > bounds.maxAttempts) {
    throw new Error('Tentativas fora dos limites tecnicos.');
  }
  return Object.freeze({ttlSeconds, maxAttempts});
}

function randomBootstrapCode() {
  return crypto.randomBytes(32).toString('base64url');
}

function keyedDigest(value, keyHex, purpose) {
  const key = assertKey(keyHex, 'Chave de verificacao');
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Valor invalido.');
  return crypto.createHmac('sha256', key).update('etec-web-v3:').update(purpose).update(':').update(value).digest('hex');
}

function verifyDigest(value, digestHex, keyHex, purpose) {
  if (typeof digestHex !== 'string' || !/^[a-f0-9]{64}$/.test(digestHex)) return false;
  if (typeof value !== 'string' || value.length > 512 || !value) return false;
  const actual = Buffer.from(keyedDigest(value, keyHex, purpose), 'hex');
  return crypto.timingSafeEqual(actual, Buffer.from(digestHex, 'hex'));
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let acc = 0, bits = 0, out = '';
  for (const byte of buf) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {bits -= 5; out += B32[(acc >>> bits) & 31];}
    acc &= (1 << bits) - 1;
  }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return out;
}
function base32Decode(value) {
  if (typeof value !== 'string' || !/^[A-Z2-7]{16,128}$/.test(value)) throw new Error('Segredo TOTP invalido.');
  let acc = 0, bits = 0;
  const out = [];
  for (const ch of value) {
    acc = (acc << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {bits -= 8; out.push((acc >>> bits) & 255); acc &= (1 << bits) - 1;}
  }
  if (bits && acc !== 0) throw new Error('Segredo TOTP invalido.');
  return Buffer.from(out);
}
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}
function totpAt(secret, counter, digits = 6) {
  if (!Number.isSafeInteger(counter) || counter < 0 || digits !== 6) throw new Error('Contador TOTP invalido.');
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(value).padStart(6, '0');
}
function verifyTotp(secret, code, options = {}) {
  const {at = Date.now(), window = 1, lastAcceptedCounter = -1} = options;
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) return null;
  if (!Number.isFinite(at) || at < 0 || !Number.isSafeInteger(lastAcceptedCounter) ||
      !Number.isSafeInteger(window) || window < 0 || window > 1) throw new Error('Parametros TOTP invalidos.');
  const counter = Math.floor(at / 30000);
  for (let delta = -window; delta <= window; delta++) {
    const candidate = counter + delta;
    if (candidate < 0 || candidate <= lastAcceptedCounter) continue;
    const expected = totpAt(secret, candidate);
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) return candidate;
  }
  return null;
}
function encryptTotpSecret(secret, keyHex, adminId) {
  base32Decode(secret);
  if (typeof adminId !== 'string' || !adminId) throw new Error('Administrador invalido.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', assertKey(keyHex, 'Chave de cifragem'), iv);
  cipher.setAAD(Buffer.from('etec-v3-totp:' + adminId));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
function decryptTotpSecret(payload, keyHex, adminId) {
  if (typeof payload !== 'string') throw new Error('Segredo cifrado invalido.');
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Versao de cifragem invalida.');
  const [iv, tag, ciphertext] = parts.slice(1).map(x => Buffer.from(x, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error('Segredo cifrado invalido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', assertKey(keyHex, 'Chave de cifragem'), iv);
  decipher.setAAD(Buffer.from('etec-v3-totp:' + adminId));
  decipher.setAuthTag(tag);
  const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  base32Decode(secret);
  return secret;
}
function generateRecoveryCodes(count = 8) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw new Error('Quantidade invalida.');
  return Array.from({length: count}, () => crypto.randomBytes(18).toString('base64url'));
}
module.exports = {
  POLICY_BOUNDS, validateBootstrapPolicy, randomBootstrapCode, keyedDigest, verifyDigest,
  generateTotpSecret, totpAt, verifyTotp, encryptTotpSecret, decryptTotpSecret, generateRecoveryCodes
};
