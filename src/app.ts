import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import {
  INTERNAL_DETAIL,
  ProblemError,
  problem,
  type Problem,
  type ProblemFieldError,
} from './problem.js';
import type { Db } from './db/client.js';
import { healthRoutes } from './routes/health.js';

const PROBLEM_JSON = 'application/problem+json';

export interface AppDeps {
  db: Db;
  jwtSecret: string;
}

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): FastifyInstance {
  // allErrors: a validation problem lists every broken field, not just the first.
  const app = Fastify({
    ...opts,
    ajv: { customOptions: { allErrors: true } },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const body = toProblem(error);
    if (body.status >= 500) request.log.error({ err: error }, 'unhandled error');
    return reply.status(body.status).type(PROBLEM_JSON).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body = problem(
      'not-found',
      `No such path: ${request.method} ${request.url.split('?')[0]}`,
    );
    return reply.status(404).type(PROBLEM_JSON).send(body);
  });

  void app.register(healthRoutes, { prefix: '/v1' });
  void deps; // used by the routes to come

  return app;
}

function toProblem(error: FastifyError): Problem {
  if (error instanceof ProblemError) return error.problem;

  if (error.validation) {
    const errors: ProblemFieldError[] = error.validation.map((v) => {
      const pointer = withMissing(v.instancePath ?? '', v.params);
      const detail = v.message ?? 'is invalid';
      return error.validationContext === 'querystring'
        ? { parameter: pointer.replace(/^\//, ''), detail }
        : { pointer, detail };
    });
    const n = errors.length;
    return problem('validation', `${n} ${n === 1 ? 'field is' : 'fields are'} invalid`, errors);
  }

  switch (error.code) {
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return problem('invalid-json', 'The request body is not valid JSON.');
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return problem('payload-too-large', 'The request body is too large.');
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return problem('unsupported-media-type', 'Send the body as application/json.');
  }

  return problem('internal', INTERNAL_DETAIL);
}

/** Ajv reports a missing property on its parent; point at the property itself. */
function withMissing(path: string, params: Record<string, unknown> | undefined): string {
  const missing = params?.missingProperty;
  return typeof missing === 'string' ? `${path}/${missing}` : path;
}
