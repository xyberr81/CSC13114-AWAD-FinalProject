// Makes the first admin, who then makes every other account through POST /v1/users (FAQ-01).
// Reads ADMIN_EMAIL and ADMIN_PASSWORD from the environment, so the password is not in a shell
// history or a process list. Safe to run again: an existing admin is left as it is.
import { eq } from 'drizzle-orm';
import { createDb } from './db/client.js';
import { users } from './db/schema.js';
import { hashPassword } from './password.js';

function readCredentials(env: NodeJS.ProcessEnv) {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+$/.test(email) ||
    email.includes('\u0000')
  ) {
    throw new Error('ADMIN_EMAIL must be an email address of at most 254 characters');
  }
  if (!password || password.length < 8 || password.length > 200 || password.includes('\u0000')) {
    throw new Error('ADMIN_PASSWORD must be 8 to 200 characters');
  }
  return { databaseUrl: env.DATABASE_URL, email, password };
}

async function main(): Promise<void> {
  const { databaseUrl, email, password } = readCredentials(process.env);
  const { db, pool } = createDb(databaseUrl);
  try {
    const [created] = await db
      .insert(users)
      .values({ email, passwordHash: await hashPassword(password), role: 'admin' })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (created) {
      console.log(`Created the admin ${email} (id ${created.id}).`);
      return;
    }

    const [existing] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.email, email));
    if (existing?.role !== 'admin') {
      throw new Error(`An account ${email} exists and its role is not admin. Nothing was changed.`);
    }
    console.log(`The admin ${email} exists already. Nothing was changed.`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
