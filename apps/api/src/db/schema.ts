// Starting point from brief §4.1: accounts and roles; TAs belong to classes; each lab belongs to a class.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const submissionStatus = pgEnum('submission_status', [
  'queued',
  'judging',
  'accepted',
  'wrong_answer',
  'compile_error',
  'time_limit',
  'memory_limit',
  'runtime_error',
]);
// Compiling happens once per submission, so compile_error is not a per-test outcome.
export const testStatus = pgEnum('test_status', [
  'accepted',
  'wrong_answer',
  'time_limit',
  'memory_limit',
  'runtime_error',
]);
export const verdictValue = pgEnum('verdict_value', ['pass', 'violation', 'unsure']);
export const verdictSource = pgEnum('verdict_source', ['hard_rule', 'model']);
// FAQ-09: why a verdict is unsure. model_off is MODEL_OFF=1 on a semantic constraint.
export const unsureReason = pgEnum('unsure_reason', [
  'model_unsure',
  'bad_schema',
  'evidence_mismatch',
  'timeout',
  'cost_limit',
  'model_off',
]);

export const userRole = pgEnum('user_role', ['admin', 'ta', 'student']);
export const memberRole = pgEnum('member_role', ['ta', 'student']);

export const users = pgTable('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  role: userRole().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const classes = pgTable('classes', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  code: text().notNull().unique(),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const classMembers = pgTable(
  'class_members',
  {
    classId: integer()
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole().notNull(),
  },
  (t) => [primaryKey({ columns: [t.classId, t.userId] })],
);

export const labs = pgTable(
  'labs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    classId: integer()
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    statement: text().notNull(),
    deadline: timestamp({ withTimezone: true }).notNull(),
    // FAQ-05 defaults: 1 s CPU per test, 256 MB including swap.
    timeLimitMs: integer().notNull().default(1000),
    memoryLimitMb: integer().notNull().default(256),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // FAQ-05 ranges. Docker takes a memory limit of 0 as no limit.
  (t) => [
    check('time_limit_range', sql`${t.timeLimitMs} BETWEEN 1000 AND 5000`),
    check('memory_limit_range', sql`${t.memoryLimitMb} BETWEEN 64 AND 512`),
  ],
);

export const labConstraints = pgTable(
  'lab_constraints',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    labId: integer()
      .notNull()
      .references(() => labs.id, { onDelete: 'cascade' }),
    code: text().notNull(),
    text: text().notNull(),
    deduction: integer().notNull(),
  },
  (t) => [
    unique().on(t.labId, t.code),
    check('deduction_range', sql`${t.deduction} BETWEEN 0 AND 10`),
  ],
);

export const labTests = pgTable(
  'lab_tests',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    labId: integer()
      .notNull()
      .references(() => labs.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    input: text().notNull(),
    expectedOutput: text().notNull(),
  },
  (t) => [unique().on(t.labId, t.position)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    labId: integer()
      .notNull()
      .references(() => labs.id, { onDelete: 'restrict' }),
    studentId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    language: text().notNull(),
    code: text().notNull(),
    status: submissionStatus().notNull().default('queued'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.labId, t.studentId)],
);

// One row per (student, Idempotency-Key). Only requests that ended in 201 keep their row.
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    fingerprint: text().notNull(),
    submissionId: integer().references(() => submissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const submissionTestResults = pgTable(
  'submission_test_results',
  {
    submissionId: integer()
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    testId: integer()
      .notNull()
      .references(() => labTests.id, { onDelete: 'restrict' }),
    status: testStatus().notNull(),
    timeMs: integer(),
    memoryKb: integer(),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.testId] })],
);

export interface EvidenceLine {
  line: number;
  text: string;
}

// One verdict per (submission, constraint): a job that runs twice inserts with ON CONFLICT DO NOTHING.
export const verdicts = pgTable(
  'verdicts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    submissionId: integer()
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    constraintId: integer()
      .notNull()
      .references(() => labConstraints.id, { onDelete: 'cascade' }),
    verdict: verdictValue().notNull(),
    evidence: jsonb().$type<EvidenceLine[]>().notNull().default([]),
    source: verdictSource().notNull(),
    unsureReason: unsureReason(),
    // The model's own words, if it gave any (FAQ-08, FAQ-09).
    explanation: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.submissionId, t.constraintId),
    check(
      'unsure_reason_iff_unsure',
      sql`(${t.verdict} = 'unsure') = (${t.unsureReason} IS NOT NULL)`,
    ),
  ],
);

// The call log: one row per model request, including requests that timed out or failed.
export const modelCalls = pgTable(
  'model_calls',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    submissionId: integer()
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    providerRequestId: text(),
    model: text().notNull(),
    promptTokens: integer(),
    completionTokens: integer(),
    durationMs: integer().notNull(),
    costUsd: numeric({ precision: 12, scale: 6 }),
    prompt: text().notNull(),
    response: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.submissionId)],
);
