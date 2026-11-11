# AI-LOG — LeeTKOB

Team: 23120024 — Nguyễn Thanh Bình · 23120046 — Hồ Thùy Hương · 23120061 — Nguyễn Thị Ánh Ngọc

| Tool                                   | Used for                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Claude Code (VS Code), Claude Opus 5.5 | repository scaffold, CI, rules file, contract draft, contract and unit tests, implementation, PA#2 evidence and PRs |
| none                                   | branch protection and the ruleset, reviewing the contract decisions (D1–D5), PR approvals, the force-push of `main` |

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
Changed: TODO(team) — what the reviewer changed in the draft before it was frozen.
Rejected: a `Location` header pointing to `GET /v1/submissions/{id}`, which does not exist yet; and
a `409 idempotency-key-in-flight` type: with the key row inserted inside the transaction, a
concurrent request waits instead of failing, so that type could never be returned.
By hand: TODO(team: name) reviewed the decisions D1–D5 before the contract was frozen. PR #1 was
approved from Ngọc's account (`angquoc`); the command was run by Claude Code after Ngọc agreed.

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

## 2026-11-11 — the gate: required check, red PR, evidence

Tool: Claude Code.
Asked for: compare the repository with the PA#2 rubric, list what was missing, then open the pull
requests that show the gate and draft `PA2.md` and `SELF_ASSESSMENT_REPORT.md`.
Kept: the order of the pull requests (contract #1, tests-first #2, deliberate break #3, docs #4);
merge commits only, so the commit ids cited in this log and in `.gitleaksignore` stay in `main`.
Changed:

- The gate could not bite. `main` was "protected", but the GitHub API showed
  `required_status_checks: enforcement_level "off", contexts []`: a red pull request could have
  been merged. PR #1 was blocked only because a review was required. Found by reading the
  protection through the API instead of trusting the "protected" badge. The owner replaced it with
  the ruleset `main`, with `checks` required, before the red PR was opened.
- Squash and rebase merges were allowed; a squash would have rewritten the commits cited as
  evidence. Turned off in the repository settings.
- A fresh clone on Windows was red: with `core.autocrlf=true`, Git checked every file out with CRLF
  and `npm run format:check` failed on 32 files that CI (Linux) passes. Added `.gitattributes`
  (`* text=auto eol=lf`).
- While renormalising the line endings, the assistant ran `git reset --hard` and wiped its own
  uncommitted edits to this file; they were written again.

Rejected: opening the deliberate-break PR while #2 was still open: its diff would have contained
#2's two commits as well, hiding the one change that breaks the contract.
By hand: the ruleset and the merge settings (the repository owner); the screenshots in
`docs/evidence/`; approving the PRs.
