// Contract pa3-api.md §2.1 and §2.2: POST /v1/auth/login and GET /v1/me.
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { createAccess } from '../access.js';
import { issueToken } from '../auth.js';
import { users } from '../db/schema.js';
import { ProblemError } from '../problem.js';
import { verifyAgainstNobody, verifyPassword } from '../password.js';
import { responses, text, userSchema } from '../schemas.js';
import type { RouteDeps } from './deps.js';

const TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000;

interface LoginRoute {
  Body: { email: string; password: string };
}

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: text(1, 254, { blank: true }),
    password: text(1, 200, { blank: true }),
  },
} as const;

export const authRoutes: FastifyPluginCallback<RouteDeps> = (app, deps, done) => {
  const { db, jwtSecret } = deps;
  const access = createAccess(deps);

  app.post<LoginRoute>(
    '/auth/login',
    {
      schema: {
        body: loginBody,
        response: responses({
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              expiresAt: { type: 'string' },
              user: userSchema,
            },
          },
        }),
      },
    },
    async (request) => {
      const { email, password } = request.body;
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.email, email.toLowerCase()));

      // An unknown email still pays for one hash check, so the two failures look alike.
      const ok = user
        ? await verifyPassword(password, user.passwordHash)
        : await verifyAgainstNobody(password);
      if (!user || !ok) {
        throw new ProblemError('invalid-credentials', 'The email or the password is wrong.');
      }

      // exp is whole seconds: say the same instant the token says.
      const expiresAt = new Date(Math.floor((Date.now() + TOKEN_LIFETIME_MS) / 1000) * 1000);
      return {
        token: await issueToken(user.id, jwtSecret, expiresAt),
        expiresAt: expiresAt.toISOString(),
        user: { id: user.id, email: user.email, role: user.role },
      };
    },
  );

  const anyone = access.guard(['admin', 'ta', 'student']);
  app.get(
    '/me',
    {
      onRequest: anyone.onRequest,
      schema: {
        response: responses({ 200: userSchema }),
      },
    },
    (request) => anyone.of(request).caller,
  );

  done();
};
