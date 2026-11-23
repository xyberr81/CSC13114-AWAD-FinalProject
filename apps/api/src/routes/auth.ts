// PA#3: POST /v1/auth/login.
import type { FastifyPluginCallback } from 'fastify';
import type { RouteDeps } from './deps.js';

export const authRoutes: FastifyPluginCallback<RouteDeps> = (_app, _deps, done) => {
  done();
};
