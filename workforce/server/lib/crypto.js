import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Random URL-safe token for links and sessions (256 bits).
export const randomToken = () => randomBytes(32).toString('base64url');

// Tokens and codes are stored as SHA-256 so a database leak can't be replayed.
// They are high-entropy or short-lived with attempt limits, so a fast hash is
// appropriate here (passwords use argon2id instead).
export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function numericCode(digits = 6) {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// AES-256-GCM. Output: iv.tag.ciphertext, each base64url.
export function encrypt(plaintext, keyB64) {
  const key = Buffer.from(keyB64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload, keyB64) {
  const [iv, tag, data] = String(payload).split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
