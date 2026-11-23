// PA#3 (FAQ-01): admin creates classes and accounts and assigns TAs; a TA adds students to their class.
import type { FastifyPluginCallback } from 'fastify';
import type { RouteDeps } from './deps.js';

export const adminRoutes: FastifyPluginCallback<RouteDeps> = (_app, _deps, done) => {
  done();
};
