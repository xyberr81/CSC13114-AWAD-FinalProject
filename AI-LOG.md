# AI-LOG — LeeTKOB

Team: `<MSSV1> — <name>` · `<MSSV2> — <name>` · `<MSSV3> — <name>`

| Tool                                   | Used for                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Claude Code (VS Code), Claude Opus 5.5 | repository scaffold, CI, rules file, contract draft, contract and unit tests, implementation   |
| none                                   | branch protection settings, reviewing the contract decisions (D1–D5), the force-push of `main` |

Model inside the product: none yet (PA#3). Data that will leave our system then: lab statement,
constraints, and submission code with comments, names and student IDs stripped (brief §3).

---

## 2026-11-10 — scaffold: stack, checks, CI

Tool: Claude Code.
Asked for: initialise the repository with the stack it had proposed (TypeScript, Fastify,
PostgreSQL + Drizzle, Vitest, ESLint, Prettier, GitHub Actions) and push it.
Kept: the Fastify app with one problem+json error handler, the Drizzle schema (users, classes,
class members, labs), one npm script per check, the CI workflow with one named step per check.
Changed:

- `npm install` failed with `ERESOLVE`: TypeScript 7 against typescript-eslint's peer range
  `<6.1.0`. Pinned TypeScript to `~6.0` → line in `CLAUDE.md` §Stack.
- The type-aware lint failed on the assistant's own first code: `no-base-to-string` (a missing
  property could have been printed as `[object Object]` in a validation pointer) and
  `require-await`. Fixed the code; no rule was switched off.
- Before committing we sent the error handler a body with two broken fields: it listed only the
  first, because Ajv stops at the first error by default. Turned `allErrors` on → line in
  `CLAUDE.md` §Conventions.
- The first commit carried a `Co-Authored-By: Claude` trailer. We asked for it to be removed. The
  assistant amended the commit locally, but its `git push --force` was refused by Claude Code's
  permission check; a team member ran the force-push by hand, before branch protection was on →
  two lines in `CLAUDE.md` (no attribution trailers; never force-push).

Rejected: the remote URL as written (`git-home@github.com:…`): GitHub refused it; the SSH alias in
our config is `github-home`.
By hand: the force-push above; the remote and its SSH alias.

## 2026-11-10 — contract of `POST /v1/labs/{labId}/submissions`

Tool: Claude Code.
Asked for: choose one endpoint from the rubric's list and write its contract with the sections of
`CONTRACT.md` in IA#3.
Kept: the endpoint (a retried upload must not create two submissions: idempotency applies), the
check order, the error table, D1–D5 in §6.
Changed: `<what the reviewer changed — fill in after the human review>`.
Rejected: a `Location` header pointing to `GET /v1/submissions/{id}`, which does not exist yet; and
a `409 idempotency-key-in-flight` type: with the key row inserted inside the transaction, a
concurrent request waits instead of failing, so that type could never be returned.
By hand: `<reviewer>` reviewed the decisions D1–D5 before the contract was frozen.

## 2026-11-10 — contract tests first, then the implementation

Tool: Claude Code.
Asked for: contract tests from `docs/contract/post-lab-submissions.md` only, committed and run
red before any implementation; then the implementation.
Kept: 50 contract tests (each problem type, the ownership rule, idempotency including 8
concurrent requests with one key, the check order) and 23 unit tests. Red run before the route
existed: 43 of 50 failing.
Changed:

- A test that could never fail: for a non-ASCII `Idempotency-Key`, the assistant's first version
  returned early when `fetch` could not send the header, so it passed without checking anything.
  Replaced with a key containing a tab (which `fetch` can send) and moved the non-ASCII case to the
  unit tests of `isValidIdempotencyKey`.
- First run against the implementation: 49 of 50. `§4.1 code is never coerced` failed — Fastify's
  default Ajv `coerceTypes` stored `"code": 12345` as the string `"12345"`. Turned coercion off
  and parse path values by hand → line in `CLAUDE.md` §Conventions.
- Lint caught a floating promise in the JSON parser wrapper and an unused hook parameter.

Rejected: nothing else.
By hand: nothing in this step.
