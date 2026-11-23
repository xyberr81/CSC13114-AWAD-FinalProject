import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const REQUIRED = { DATABASE_URL: 'postgres://db/leetkob', JWT_SECRET: 's'.repeat(32) };

describe('loadConfig()', () => {
  it('has safe defaults for the optional variables', () => {
    expect(loadConfig(REQUIRED)).toEqual({
      port: 3000,
      host: '127.0.0.1',
      logLevel: 'info',
      databaseUrl: REQUIRED.DATABASE_URL,
      jwtSecret: REQUIRED.JWT_SECRET,
    });
  });

  it('rejects a PORT that is not a port number', () => {
    expect(() => loadConfig({ ...REQUIRED, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...REQUIRED, PORT: '70000' })).toThrow(/PORT/);
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({ JWT_SECRET: REQUIRED.JWT_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('requires a JWT_SECRET of at least 32 characters', () => {
    expect(() => loadConfig({ DATABASE_URL: REQUIRED.DATABASE_URL })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...REQUIRED, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
});
