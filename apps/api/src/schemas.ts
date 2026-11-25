// Pieces the route schemas share. A response schema lists every field a client may see:
// Fastify drops the rest, which is what keeps verdicts and test data out of student responses.

/**
 * A string of `min`–`max` characters without U+0000 or an unpaired surrogate, and not only
 * whitespace unless `blank`.
 */
export function text(min: number, max: number, { blank = false } = {}) {
  return {
    type: 'string',
    minLength: min,
    maxLength: max,
    'x-text': blank ? 'any' : 'nonblank',
  } as const;
}

const problem = {
  description: 'Problem details (RFC 9457)',
  type: 'object',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pointer: { type: 'string' },
          parameter: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
} as const;

/** The 2xx responses of a route, plus the problem body of every 4xx and 5xx. */
export function responses(ok: Record<number, object>) {
  return { ...ok, '4xx': problem, '5xx': problem };
}

export const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    email: { type: 'string' },
    role: { type: 'string', enum: ['admin', 'ta', 'student'] },
  },
} as const;

export const classSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    code: { type: 'string' },
    name: { type: 'string' },
  },
} as const;
