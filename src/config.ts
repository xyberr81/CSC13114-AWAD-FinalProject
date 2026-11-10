export interface Config {
  port: number;
  host: string;
  logLevel: string;
  databaseUrl: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535, got "${env.PORT}"`);
  }
  return {
    port,
    host: env.HOST || '127.0.0.1',
    logLevel: env.LOG_LEVEL || 'info',
    databaseUrl: env.DATABASE_URL || undefined,
  };
}
