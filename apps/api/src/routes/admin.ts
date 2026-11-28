// PA#3 (FAQ-01): admin creates classes and accounts and assigns TAs; a TA adds students to their class.
// Contract pa3-api.md §2.3, §3.
import { eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { createAccess, type Role } from '../access.js';
import { classMembers, classes, users } from '../db/schema.js';
import { hashPassword } from '../password.js';
import { ProblemError } from '../problem.js';
import { classSchema, responses, text, userSchema } from '../schemas.js';
import type { RouteDeps } from './deps.js';

interface CreateUserRoute {
  Body: { email: string; password: string; role: Role };
}
interface CreateClassRoute {
  Body: { code: string; name: string };
}
interface AddMemberRoute {
  Body: { email: string; role: 'ta' | 'student' };
}

const createUserBody = {
  type: 'object',
  required: ['email', 'password', 'role'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: text(8, 200, { blank: true }),
    role: { type: 'string', enum: ['admin', 'ta', 'student'] },
  },
} as const;

const createClassBody = {
  type: 'object',
  required: ['code', 'name'],
  properties: { code: text(1, 50), name: text(1, 200) },
} as const;

const addMemberBody = {
  type: 'object',
  required: ['email', 'role'],
  properties: {
    email: text(1, 254, { blank: true }),
    role: { type: 'string', enum: ['ta', 'student'] },
  },
} as const;

export const adminRoutes: FastifyPluginCallback<RouteDeps> = (app, deps, done) => {
  const { db } = deps;
  const access = createAccess(deps);

  const adminOnly = access.guard(['admin']);
  const anyone = access.guard(['admin', 'ta', 'student']);
  const classMember = access.guard(['admin', 'ta'], (caller, params) =>
    access.classOf(caller, params.classId),
  );

  app.post<CreateUserRoute>(
    '/users',
    {
      onRequest: adminOnly.onRequest,
      schema: { body: createUserBody, response: responses({ 201: userSchema }) },
    },
    async (request, reply) => {
      const { email, password, role } = request.body;
      const passwordHash = await hashPassword(password);
      const [created] = await db
        .insert(users)
        .values({ email: email.toLowerCase(), passwordHash, role })
        .onConflictDoNothing()
        .returning({ id: users.id, email: users.email, role: users.role });
      if (!created) throw new ProblemError('email-taken', 'An account with this email exists.');
      return reply.status(201).send(created);
    },
  );

  app.post<CreateClassRoute>(
    '/classes',
    {
      onRequest: adminOnly.onRequest,
      schema: { body: createClassBody, response: responses({ 201: classSchema }) },
    },
    async (request, reply) => {
      // Named one by one: the body may carry fields that are columns but not the client's to set.
      const { code, name } = request.body;
      const [created] = await db
        .insert(classes)
        .values({ code, name })
        .onConflictDoNothing()
        .returning({ id: classes.id, code: classes.code, name: classes.name });
      if (!created) throw new ProblemError('class-code-taken', 'A class with this code exists.');
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/classes',
    {
      onRequest: anyone.onRequest,
      schema: {
        response: responses({
          200: { type: 'object', properties: { items: { type: 'array', items: classSchema } } },
        }),
      },
    },
    async (request) => ({ items: await access.classesOf(anyone.of(request).caller) }),
  );

  app.post<AddMemberRoute>(
    '/classes/:classId/members',
    {
      onRequest: classMember.onRequest,
      schema: {
        body: addMemberBody,
        response: responses({
          200: {
            type: 'object',
            properties: { classId: { type: 'integer' }, user: userSchema },
          },
        }),
      },
    },
    async (request) => {
      const { caller, target: cls } = classMember.of(request);
      const { email, role } = request.body;

      // An admin adds a TA, a TA adds a student; checked after the body, as check 6 (§3.3).
      if (role !== (caller.role === 'admin' ? 'ta' : 'student')) {
        throw new ProblemError('forbidden', `Your role may not add a ${role} to a class.`);
      }

      const [user] = await db
        .select({ id: users.id, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.email, email.toLowerCase()));
      if (user?.role !== role) {
        throw new ProblemError('user-not-eligible', `No ${role} account has this email.`);
      }

      await db
        .insert(classMembers)
        .values({ classId: cls.id, userId: user.id, role })
        .onConflictDoNothing();
      return { classId: cls.id, user };
    },
  );

  done();
};
