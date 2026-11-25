import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createQueue } from './queue/queue.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const queue = createQueue(config.databaseUrl, {
  onError: (err) => app.log.error({ err }, 'queue error'),
});
const app = buildApp(
  { db, jwtSecret: config.jwtSecret, queue },
  { logger: { level: config.logLevel } },
);
app.addHook('onClose', async () => {
  await queue.stop();
  await pool.end();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close());
}

try {
  await queue.start();
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
