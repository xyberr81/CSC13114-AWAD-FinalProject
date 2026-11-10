import { SignJWT, jwtVerify } from 'jose';

const MAX_ID = 2_147_483_647;
const encoder = new TextEncoder();

/** A positive integer that fits a Postgres `integer`, or null. */
export function parseId(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= MAX_ID ? id : null;
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer +([^\s]+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

export async function issueToken(
  userId: number,
  secret: string,
  expiresAt: Date = new Date(Date.now() + 60 * 60 * 1000),
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(encoder.encode(secret));
}

/** The user id in a valid, unexpired HS256 token signed with `secret`, or null. */
export async function verifyToken(token: string, secret: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
      requiredClaims: ['sub', 'exp'],
    });
    return parseId(payload.sub);
  } catch {
    return null;
  }
}
