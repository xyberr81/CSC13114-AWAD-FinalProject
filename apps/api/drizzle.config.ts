import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // no .env file: DATABASE_URL must come from the environment
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
