import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const app = buildApp({ db, jwtSecret: config.jwtSecret }, { logger: { level: config.logLevel } });
app.addHook('onClose', () => pool.end());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close());
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
