# LeeTKOB — rules for the coding assistant

LeeTKOB lets a TA check, with evidence, that Accepted C++ lab submissions follow the lab's
constraints before marks are published. Permissions: `PERMISSIONS.md`. AI use: `AI-LOG.md`.
Lines marked _(story)_ come from something that actually went wrong; the AI-LOG entry says what.

## Stack

- TypeScript on Node 22 (ESM), Fastify 5, PostgreSQL 17 with Drizzle, Vitest, ESLint + Prettier.
- TypeScript is pinned to `~6.0`: typescript-eslint does not support 7 yet. _(story: AI-LOG
  2026-11-10 "scaffold")_
- Planned (PA#3): pg-boss queue, Docker sandbox with `gcc`, tree-sitter-cpp hard rules.

## Commands

| Check          | Command                 |
| -------------- | ----------------------- |
| everything     | `npm run check`         |
| lint           | `npm run lint`          |
| format check   | `npm run format:check`  |
| type check     | `npm run typecheck`     |
| unit tests     | `npm test`              |
| contract tests | `npm run test:contract` |
| new migration  | `npm run db:generate`   |

CI runs the same commands. A task is done only when `npm run check` passes locally.

## Conventions

- `docs/contract/*.md` is the spec. Code that disagrees with it is wrong. A contract change is
  its own pull request with a reason — never in the same commit as code or tests.
- Contract tests are written from the contract, talk HTTP only, cite the section in their
  name (`§4.1 …`), and create their own data.
- Every 4xx/5xx is problem+json via `ProblemError`; a new problem type is added to the contract
  first.
- Validation problems list every broken field: keep Ajv `allErrors` on. _(story: AI-LOG
  2026-11-10 "scaffold" — the first error handler reported only the first field)_
- Ajv `coerceTypes` stays off: with Fastify's default, `"code": 12345` was stored as the string
  `"12345"`. Parse path and query values by hand (`parseId`). _(story: AI-LOG 2026-11-10
  "contract tests first")_
- Schema changes go through `npm run db:generate`; never edit `drizzle/` by hand.
- Work on a branch and open a pull request; `main` only changes through a green PR.
- No `Co-Authored-By` or "generated with" lines in commits or PRs: AI use is declared in
  `AI-LOG.md`. _(story: AI-LOG 2026-11-10 "scaffold")_

## Never

- Never let a secret reach the sandbox: no API key in its environment, files or mounts.
- Never call a real model in unit tests; use a fake.
- Never edit a test, the contract, the eval data or a label to make a check pass. Fix the code.
- Never weaken a check: no `|| true`, `continue-on-error`, skipped tests or disabled lint rules.
- Never write a test that can pass without asserting — no early `return` in a test. _(story:
  AI-LOG 2026-11-10 "contract tests first")_
- Never read or print `.env`; never commit a secret. New variables go in `.env.example`, empty.
- Never run student code outside the sandbox.
- Never push to `main`, force-push, or touch branch protection. _(story: AI-LOG 2026-11-10
  "scaffold" — a history rewrite of `main` needed a force-push; it was refused and done by a
  human, before protection was on)_
