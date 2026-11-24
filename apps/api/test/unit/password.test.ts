import { describe, expect, it } from 'vitest';
import { hashPassword, verifyAgainstNobody, verifyPassword } from '../../src/password.js';

describe('hashPassword() and verifyPassword()', () => {
  it('accepts the password that was hashed, and no other', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('correct horsf', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('does not contain the password and uses a new salt each time', async () => {
    const [a, b] = [await hashPassword('correct horse'), await hashPassword('correct horse')];
    expect(a).not.toContain('correct horse');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', b)).toBe(true);
  });

  it('handles non-ASCII and long passwords', async () => {
    for (const password of ['mật khẩu 🔑', 'x'.repeat(200)]) {
      expect(await verifyPassword(password, await hashPassword(password))).toBe(true);
    }
  });

  it('is false, and does not throw, for a stored value that is not a hash', async () => {
    const real = await hashPassword('correct horse');
    const [scheme, , salt, key] = real.split('$');
    const malformed = [
      'x',
      '',
      'scrypt',
      'scrypt$$$',
      `scrypt$16384,8,1$${salt}`,
      `scrypt$16384,8,1$!!$${key}`,
      `scrypt$3,8,1$${salt}$${key}`, // N is not a power of two
      `scrypt$0,8,1$${salt}$${key}`,
      `scrypt$9999999,999,999$${salt}$${key}`, // more memory than scrypt will take
      `${scheme}$16384,8,1$${salt}$=`,
      `bcrypt$16384,8,1$${salt}$${key}`,
    ];
    for (const stored of malformed) {
      expect(await verifyPassword('correct horse', stored), stored).toBe(false);
    }
  });

  it('is false for a hash whose key was cut short', async () => {
    const [scheme, cost, salt, key] = (await hashPassword('correct horse')).split('$');
    const short = Buffer.from(key!, 'base64').subarray(0, 8).toString('base64');
    expect(await verifyPassword('correct horse', [scheme, cost, salt, short].join('$'))).toBe(
      false,
    );
  });
});

describe('verifyAgainstNobody()', () => {
  it('is always false', async () => {
    expect(await verifyAgainstNobody('correct horse')).toBe(false);
  });
});
