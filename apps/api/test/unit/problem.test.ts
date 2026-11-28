import { describe, expect, it } from 'vitest';
import { PROBLEMS, PROBLEM_TYPE_BASE, ProblemError, problem } from '../../src/problem.js';

describe('problem()', () => {
  it('builds type, title and status from the slug', () => {
    expect(problem('not-found', 'No lab 7.')).toEqual({
      type: `${PROBLEM_TYPE_BASE}not-found`,
      title: 'Not found',
      status: 404,
      detail: 'No lab 7.',
    });
  });

  it('adds errors only when given', () => {
    const errors = [{ pointer: '/code', detail: 'must not be empty' }];
    expect(problem('validation', '1 field is invalid', errors).errors).toEqual(errors);
    expect(problem('validation', 'x')).not.toHaveProperty('errors');
  });

  it('maps every slug to a 4xx or 5xx status', () => {
    for (const [slug, { status }] of Object.entries(PROBLEMS)) {
      expect(status, slug).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('ProblemError', () => {
  it('carries the problem it was built from', () => {
    const err = new ProblemError('forbidden', 'Not a TA of this class.');
    expect(err.problem.status).toBe(403);
    expect(err.message).toBe('Not a TA of this class.');
  });
});
