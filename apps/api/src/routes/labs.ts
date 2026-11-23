// PA#3: a TA creates a lab (statement, tests, constraints with deductions); a student views it (FAQ-06).
import type { FastifyPluginCallback } from 'fastify';
import type { RouteDeps } from './deps.js';

export const labRoutes: FastifyPluginCallback<RouteDeps> = (_app, _deps, done) => {
  done();
};
