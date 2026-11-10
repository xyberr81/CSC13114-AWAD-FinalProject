import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile();
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
