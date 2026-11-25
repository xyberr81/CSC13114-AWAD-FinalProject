// Brings the test database to the latest migration once, before any contract test file runs.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Contract tests need DATABASE_URL (see .env.example)');
  if (!process.env.JWT_SECRET) throw new Error('Contract tests need JWT_SECRET (see .env.example)');
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }
}
