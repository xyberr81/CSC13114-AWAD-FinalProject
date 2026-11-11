import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { bearerToken, issueToken, parseId, verifyToken } from '../../src/auth.js';

const SECRET = 'unit-test-secret-unit-test-secret';

describe('parseId()', () => {
  it('accepts positive integers that fit a Postgres integer', () => {
    expect(parseId('1')).toBe(1);
    expect(parseId('2147483647')).toBe(2147483647);
  });

  it('rejects anything else', () => {
    for (const v of [undefined, '', '0', '-1', '01', '1.5', '1e3', ' 1', 'abc', '2147483648']) {
      expect(parseId(v), String(v)).toBeNull();
    }
  });
});

describe('bearerToken()', () => {
  it('reads the token of a Bearer header, scheme case-insensitive', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer abc')).toBe('abc');
  });

  it('rejects other schemes and malformed headers', () => {
    for (const h of [undefined, '', 'Basic abc', 'Bearer', 'Bearer a b', 'abc']) {
      expect(bearerToken(h), String(h)).toBeNull();
    }
  });
});

describe('verifyToken()', () => {
  it('returns the user id of a token it issued', async () => {
    expect(await verifyToken(await issueToken(42, SECRET), SECRET)).toBe(42);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await issueToken(42, 'another-secret-another-secret-xx');
    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await issueToken(42, SECRET, new Date(Date.now() - 1000));
    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects a token without exp', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('42')
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects an unsigned (alg: none) token', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = `${b64({ alg: 'none' })}.${b64({ sub: '42', exp })}.`;
    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects a sub that is not a user id', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('admin')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyToken(token, SECRET)).toBeNull();
  });
});
