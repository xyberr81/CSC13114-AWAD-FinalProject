// Problem details (RFC 9457): the one error model of every /v1 response with a 4xx or 5xx status.
// Clients decide from `type`; `title` is fixed per type; `detail` describes this occurrence only.

export const PROBLEM_TYPE_BASE = 'https://leetkob.example/problems/';

export const PROBLEMS = {
  'invalid-json': { status: 400, title: 'Malformed JSON' },
  validation: { status: 400, title: 'Invalid request' },
  unauthenticated: { status: 401, title: 'Authentication required' },
  forbidden: { status: 403, title: 'Forbidden' },
  'not-found': { status: 404, title: 'Not found' },
  'payload-too-large': { status: 413, title: 'Payload too large' },
  'unsupported-media-type': { status: 415, title: 'Unsupported media type' },
  internal: { status: 500, title: 'Internal error' },
} as const;

export type ProblemSlug = keyof typeof PROBLEMS;

export type ProblemFieldError =
  { pointer: string; detail: string } | { parameter: string; detail: string };

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: ProblemFieldError[];
}

export const INTERNAL_DETAIL = 'Something went wrong on our side. Try again later.';

export function problem(slug: ProblemSlug, detail: string, errors?: ProblemFieldError[]): Problem {
  const { status, title } = PROBLEMS[slug];
  return {
    type: PROBLEM_TYPE_BASE + slug,
    title,
    status,
    detail,
    ...(errors ? { errors } : {}),
  };
}

/** Throw from a route handler; the error handler turns it into problem+json. */
export class ProblemError extends Error {
  readonly problem: Problem;

  constructor(slug: ProblemSlug, detail: string, errors?: ProblemFieldError[]) {
    super(detail);
    this.name = 'ProblemError';
    this.problem = problem(slug, detail, errors);
  }
}
