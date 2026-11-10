// Starting point from brief §4.1: accounts and roles; TAs belong to classes; each lab belongs to a class.
import { index, integer, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

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

export const labs = pgTable('labs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  classId: integer()
    .notNull()
    .references(() => classes.id, { onDelete: 'restrict' }),
  title: text().notNull(),
  statement: text().notNull(),
  deadline: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

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
    status: text().notNull().default('queued'),
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
