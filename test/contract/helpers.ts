import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { issueToken } from '../../src/auth.js';
import { createDb, type Db } from '../../src/db/client.js';
import { classMembers, classes, labs, users } from '../../src/db/schema.js';

export const PROBLEM_TYPE_BASE = 'https://leetkob.example/problems/';

export interface TestEnv {
  baseUrl: string;
  db: Db;
  secret: string;
  close: () => Promise<void>;
}

/**
 * Contract tests talk HTTP only. Data is arranged directly in the database the server uses.
 * Against a deployed server: set CONTRACT_BASE_URL (and the DATABASE_URL / JWT_SECRET it uses).
 * Otherwise the app is started in-process on a random port.
 */
export async function startEnv(): Promise<TestEnv> {
  const secret = process.env.JWT_SECRET ?? '';
  const { db, pool } = createDb(process.env.DATABASE_URL ?? '');
  const external = process.env.CONTRACT_BASE_URL;
  if (external) {
    return { baseUrl: external.replace(/\/$/, ''), db, secret, close: () => pool.end() };
  }
  const app: FastifyInstance = buildApp({ db, jwtSecret: secret }, { logger: false });
  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    baseUrl,
    db,
    secret,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

// ---- arranging data: every test makes its own users, classes and labs ----

const unique = () => randomUUID().slice(0, 8);

export async function makeUser(env: TestEnv, role: 'admin' | 'ta' | 'student') {
  const [user] = await env.db
    .insert(users)
    .values({ email: `${role}-${unique()}@test.local`, passwordHash: 'x', role })
    .returning({ id: users.id });
  const token = await issueToken(user!.id, env.secret);
  return { id: user!.id, token };
}

export async function makeClass(env: TestEnv) {
  const [row] = await env.db
    .insert(classes)
    .values({ code: `C-${unique()}`, name: 'Test class' })
    .returning({ id: classes.id });
  return row!.id;
}

export async function enrol(env: TestEnv, classId: number, userId: number, role: 'ta' | 'student') {
  await env.db.insert(classMembers).values({ classId, userId, role });
}

const HOUR = 60 * 60 * 1000;

export async function makeLab(
  env: TestEnv,
  classId: number,
  deadline = new Date(Date.now() + HOUR),
) {
  const [row] = await env.db
    .insert(labs)
    .values({ classId, title: 'Sorting', statement: 'Implement merge sort.', deadline })
    .returning({ id: labs.id });
  return row!.id;
}

export async function setDeadline(env: TestEnv, labId: number, deadline: Date) {
  await env.db.update(labs).set({ deadline }).where(eq(labs.id, labId));
}

/** A student enrolled in a fresh class with one open lab. */
export async function enrolledStudent(env: TestEnv) {
  const classId = await makeClass(env);
  const labId = await makeLab(env, classId);
  const student = await makeUser(env, 'student');
  await enrol(env, classId, student.id, 'student');
  return { classId, labId, student };
}

// ---- assertions ----

export async function expectProblem(res: Response, slug: string, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.type).toBe(PROBLEM_TYPE_BASE + slug);
  expect(body.status).toBe(status);
  expect(typeof body.title).toBe('string');
  expect(typeof body.detail).toBe('string');
  return body;
}
