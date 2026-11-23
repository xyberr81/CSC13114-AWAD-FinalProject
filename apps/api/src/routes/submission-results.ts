// PA#3: a student views their submission: status and per-test results, no test data (FAQ-02), no constraint verdicts (FAQ-08).
import type { FastifyPluginCallback } from 'fastify';
import type { RouteDeps } from './deps.js';

export const submissionResultRoutes: FastifyPluginCallback<RouteDeps> = (_app, _deps, done) => {
  done();
};
