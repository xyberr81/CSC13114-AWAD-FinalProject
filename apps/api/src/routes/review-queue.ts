// PA#3: GET /v1/labs/{labId}/review-queue, for the lab's class TA only (FAQ-09, FAQ-10).
import type { FastifyPluginCallback } from 'fastify';
import type { RouteDeps } from './deps.js';

export const reviewQueueRoutes: FastifyPluginCallback<RouteDeps> = (_app, _deps, done) => {
  done();
};
