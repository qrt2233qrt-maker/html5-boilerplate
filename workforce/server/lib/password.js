import argon2 from 'argon2';
import { badRequest } from './errors.js';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function checkPasswordStrength(password, { email, name } = {}) {
  if (typeof password !== 'string' || password.length < 10) {
    throw badRequest('weak_password', 'Use at least 10 characters for your password.', { reason: 'too_short' });
  }
  if (password.length > 200) {
    throw badRequest('weak_password', 'Use at most 200 characters for your password.', { reason: 'too_long' });
  }
  const lower = password.toLowerCase();
  const local = email ? email.split('@')[0].toLowerCase() : '';
  if ((local.length >= 4 && lower.includes(local)) || (name && lower === name.toLowerCase())) {
    throw badRequest('weak_password', 'Your password must not contain your email or name.', { reason: 'personal' });
  }
  if (new Set(password).size < 4) {
    throw badRequest('weak_password', 'Choose a less predictable password.', { reason: 'predictable' });
  }
}

export const hashPassword = (password) => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash, password) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Used when an account doesn't exist, so a failed sign-in takes as long as a
// real one and doesn't reveal which emails are registered.
let dummy;
export async function burnPasswordTime(password) {
  dummy ??= await argon2.hash('dummy-password-for-timing', OPTIONS);
  await verifyPassword(dummy, password);
}
