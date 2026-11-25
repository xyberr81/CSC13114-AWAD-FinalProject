// OpenAPI (contract pa3-api.md §7): Swagger UI at /docs, the document at /docs/json. Every /v1 route
// is in it. Its tag and summary are kept here, in one table, rather than in each route's schema.
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance, RouteOptions } from 'fastify';

const BEARER = 'bearerAuth';

/** `METHOD url` as Fastify reports it, to the tag and the summary. */
const ROUTES: Record<string, [tag: string, summary: string]> = {
  'GET /v1/health': ['meta', 'Is the server up'],
  'POST /v1/auth/login': ['accounts', 'Log in with an email and a password'],
  'GET /v1/me': ['accounts', 'The caller'],
  'POST /v1/users': ['accounts', 'Create an account (admin)'],
  'POST /v1/classes': ['classes', 'Create a class (admin)'],
  'GET /v1/classes': ['classes', "The caller's classes; every class for an admin"],
  'POST /v1/classes/:classId/members': [
    'classes',
    'Add a TA (admin) or a student (TA of the class)',
  ],
  'POST /v1/classes/:classId/labs': ['labs', 'Create a lab with its constraints and tests (TA)'],
  'GET /v1/classes/:classId/labs': ['labs', 'List the labs of a class (TA, student)'],
  'GET /v1/labs/:labId': ['labs', 'A lab, without its tests (TA, student)'],
  'POST /v1/labs/:labId/submissions': ['submissions', 'Submit code for a lab (student)'],
  'GET /v1/submissions/:submissionId': ['submissions', 'Status and test results (student)'],
  'GET /v1/labs/:labId/review-queue': ['review', 'The verdicts a TA has to look at (TA)'],
  'GET /v1/submissions/:submissionId/review': ['review', 'Code and every verdict (TA)'],
};

/** Swagger UI can only send headers it knows. The route itself checks the key, so this requires none. */
const SUBMIT = 'POST /v1/labs/:labId/submissions';
const IDEMPOTENCY_HEADER = {
  type: 'object',
  properties: {
    'idempotency-key': { type: 'string', description: 'Required. A new UUID per submission.' },
  },
};

/** Without a token: the two routes a client can call before it has one. */
const OPEN = new Set(['GET /v1/health', 'POST /v1/auth/login']);

/** An onRoute hook: fills in tags, summary and security of each route that has no own. */
function describeRoute(route: RouteOptions) {
  const key = `${String(route.method)} ${route.url}`;
  const known = ROUTES[key];
  if (!known) return;
  const [tag, summary] = known;
  route.schema = {
    tags: [tag],
    summary,
    security: OPEN.has(key) ? [] : [{ [BEARER]: [] }],
    ...(key === SUBMIT ? { headers: IDEMPOTENCY_HEADER } : {}),
    ...route.schema,
  };
}

/** Call before any route is registered: the hooks only see the routes added after them. */
export function documentApi(app: FastifyInstance) {
  app.addHook('onRoute', describeRoute);
  void app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'LeeTKOB API',
        version: '1.0.0',
        description:
          'Check, with evidence, that Accepted C++ lab submissions follow the lab constraints. ' +
          'Log in at POST /v1/auth/login, then send the token as `Authorization: Bearer <token>`. ' +
          'Every 4xx and 5xx response is problem+json (RFC 9457).',
      },
      components: {
        securitySchemes: { [BEARER]: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
      security: [{ [BEARER]: [] }],
    },
  });
  void app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { persistAuthorization: true },
  });
}
