import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  cost: ScryptCost,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, cost, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const COST = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const FORMAT = /^scrypt\$(\d{1,7}),(\d{1,3}),(\d{1,3})\$([A-Za-z0-9+/]+=*)\$([A-Za-z0-9+/]+=*)$/;

/** `scrypt$N,r,p$salt$key`, salt and key in base64. A new random salt for every call. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, COST);
  return `scrypt$${COST.N},${COST.r},${COST.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** False for a wrong password and for a stored value that is not one of our hashes. Never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = FORMAT.exec(stored);
  if (!match) return false;
  const [, n, r, p, salt, key] = match;
  const expected = Buffer.from(key!, 'base64');
  // A key cut short would still match the start of the real one, and scrypt reads a 0 as "use
  // the default", which would make a hash with zeros in it verify.
  if (expected.length !== KEY_LENGTH || Number(n) < 2 || Number(r) < 1 || Number(p) < 1) {
    return false;
  }
  try {
    const actual = await scryptAsync(password, Buffer.from(salt!, 'base64'), KEY_LENGTH, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    // scrypt refuses parameters it cannot run (N not a power of two, too much memory, key length 0).
    return false;
  }
}

const dummy = hashPassword(randomBytes(16).toString('hex'));

/** Costs what verifying one real hash costs. For a login whose email matches no account. */
export async function verifyAgainstNobody(password: string): Promise<false> {
  await verifyPassword(password, await dummy);
  return false;
}
