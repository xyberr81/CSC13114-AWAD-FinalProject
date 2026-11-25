# AI-LOG — LeeTKOB

Team: 23120024 — Nguyễn Thanh Bình · 23120046 — Hồ Thùy Hương · 23120061 — Nguyễn Thị Ánh Ngọc

| Tool                                   | Used for                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Claude Code (VS Code), Claude Opus 5.5 | repository scaffold, CI, rules file, contract draft, contract and unit tests, implementation, PA#2 evidence and PRs |

Model inside the product: provider OpenRouter (key with a $2 credit limit, README §Model and
cost); the model itself is chosen in PA#3. Data that will leave our system then: lab statement,
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
Rejected: a `Location` header pointing to `GET /v1/submissions/{id}`, which does not exist yet; and
a `409 idempotency-key-in-flight` type: with the key row inserted inside the transaction, a
concurrent request waits instead of failing, so that type could never be returned.
By hand: Ngọc approved PR #1 from the `angquoc` account.

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

- A second check against the rubric found no model API key, so criterion 2's spending cap could
  not be shown. Created an OpenRouter key with a $2 credit limit, written in README §Model and
  cost; the model choice stays for PA#3. The same check added the missing `CONTRACT_BASE_URL`
  to `.env.example`.
- The same check found that no test returned `internal` (500), although the self-assessment said
  "every problem type": a real database cannot be made to fail from an HTTP test. Added
  `test/unit/internal-error.test.ts`, which builds the app with a database stub that throws. To
  check it can fail, the assistant changed the error handler to return the error message as
  `detail` without committing it: the test went red, and the change was reverted.

By hand: the ruleset and the merge settings (the repository owner); the screenshots in
`docs/evidence/`; approving the PRs; the OpenRouter key and its $2 limit (Bình), kept out of the
chat and the repository.

## 2026-11-24: sandbox, attack submissions, CI job

Tool: Claude Code.
Asked for: `judge()` as designed and approved by Ngọc: compile and run in one-shot containers, one
attack submission per minimum of brief §5, tests before code, and a CI job of their own.
Kept: 23 tests first, all red on the stub (`041f3ae`); the hardened `docker run` flags of session 6
with the FAQ-05 limits; 10 control tests that take one limit away and check that the attack then
gets through.
Changed:

- The assistant's network attack was wrong. `connect()` failed with ENETUNREACH under
  `--network none`, but the program only looked at `SO_ERROR`, which is 0 for a refused connect, and
  printed "connected". The test was red on a sandbox that did block it. Found by running the same
  calls with and without a network and printing `errno`; fixed in a commit of its own, before the
  sandbox code.
- The plan was to compile within the 256 MB of FAQ-05. Measured: a program with `std::regex` needs
  about 290 MB and `cc1plus` is killed at 256 MB. Compiling gets 512 MB; the submission still runs in
  256 MB.
- Correction: this entry, a code comment and the PR first said that `<bits/stdc++.h>` alone needs
  290 MB. The program measured also used `<regex>`. Ngọc asked whether 512 MB was really required;
  measured again, the header alone and all 47 dev-set solutions compile within 256 MB.
- The plan did not say which process the submission is. Measured: as PID 1 it does not get SIGXCPU
  (exit 137 one second later instead of 152), so the script starts it as a child of `sh`.
- A unit test of the forbidden flags matched `--pids-limit` as `--pid`. Narrowed to `--pid=`.

Rejected:

- Pinning `tree-sitter` 0.21 to fit `tree-sitter-cpp`: Hương had already chosen `web-tree-sitter`.
- An image of our own: the official `gcc` image, pinned by digest, needs nothing added.
- A limit on submissions per minute: it would answer 429, which the contract does not have.

By hand: approving the design and every commit message; restarting Docker Desktop, which had stopped
answering on the development machine.
