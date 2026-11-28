import type { Db } from '../db/client.js';

/** What every route plugin is registered with (see buildApp). */
export interface RouteDeps {
  db: Db;
  jwtSecret: string;
}
