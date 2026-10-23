import crypto from 'node:crypto';

const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function createSessionToken(userId, secret) {
  const payload = `${userId}.${Date.now() + SESSION_DAYS * 864e5}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function readSessionToken(token, secret) {
  const [userId, expires, sig] = String(token || '').split('.');
  if (!sig) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  if (Number(expires) < Date.now()) return null;
  return Number(userId);
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter(([k, v]) => k && v)
    .map(([k, v]) => [k, decodeURIComponent(v)]));
}

export function sessionCookie(token, secure) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export const clearSessionCookie = 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
