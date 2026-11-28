# AI-LOG — LeeTKOB

Team: 23120024 — Nguyễn Thanh Bình · 23120046 — Hồ Thùy Hương · 23120061 — Nguyễn Thị Ánh Ngọc

| Tool                                   | Used for                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Claude Code (VS Code), Claude Opus 5.5 | repository scaffold, CI, rules file, contract draft, contract and unit tests, implementation, PA#2 evidence and PRs |

Model inside the product: `claude-haiku-5-5`, called at Anthropic with `@anthropic-ai/sdk` (spending
cap: README §Model and cost). Data that leaves our system: the lab statement, one constraint, and the
submission code without comments, with string words masked and student IDs zeroed (brief §3).
Cost of one lab of 80: $0.019, measured on the dev set on 2026-11-28 (README §Model and cost).
Before that date the model was `deepseek/deepseek-v4-flash-0731` through OpenRouter.

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

## 2026-11-23 — permissions for pstack and the verify skill

Tool: Claude Code.
Asked for: the permission prompts were too frequent. The project now uses the pstack skills,
which run subagents in git worktrees, run single tests and open PRs, and the verify skill, which
drives a throw-away API through scripts; both should run without a human approving routine
commands.
Kept: a wide allow list (edits to code, docs, config and skills; every `npm run` script; `npx`
for the check tools; local git, worktrees and feature-branch pushes; `gh pr` and `gh run` short of
merging; `docker`; `curl` to the dev server; the verify scripts; web search and the stack's
documentation sites). The ask list keeps a human on the spec, the contract tests, CI, the
dependencies, `drizzle/`, the rules files, the verify scripts themselves, git that rewrites or
discards work, and merging. `PERMISSIONS.md` rewritten to match.

- Ask beats allow, so wide ask rules (`docker:*`, `curl:*`, `gh pr:*`, `WebFetch`) would have
  kept prompting for every narrower allow. They were replaced by narrow ask rules.
- The verify scripts run without asking, so editing them asks: otherwise an edit could change
  what an allowed command does.
- `docker compose config`, `docker inspect` and `env` / `printenv` through `docker exec` print
  container environments, which hold the values from `.env`: denied. So are the commands that
  delete the local database's data (`down -v`, `volume rm` / `prune`, `system prune`).
- `curl` is allowed to `localhost:3000` / `127.0.0.1:3000` only. A rule ending in `localhost:*`
  would also match `localhost.example.com`.
- The pstack plugin's own `node` scripts sit under the home directory, so their rule lives in the
  git-ignored `.claude/settings.local.json`; that file and `.claude/worktrees/` are now ignored.
- Paths follow the `apps/api` layout from PR #5, so this lands after it.

Rejected: allowing `git rebase`, `reset`, `restore`, `checkout`, `clean` (they can discard
work); `--force-with-lease` pushes, which pstack uses to restack PRs (CLAUDE.md: never
force-push); `gh api`, since a GET-only rule cannot be written and it can change branch
protection; `gh pr merge`.

By hand: choosing which prompts to drop (Bình).

## 2026-11-24 — PA#3 API: accounts, classes, labs, results, review queue

Tool: Claude Code (Opus 5.5 for the contract, the contract tests and the review; a Sonnet subagent for
the implementation).
Asked for: section 3.1 of the PA#3 plan, after finding that no branch had any of it.
Kept: `docs/contract/pa3-api.md`, then its contract tests run red (101 of 163 failing), then the code,
one part per commit; a role × ownership matrix with one test per cell; six own eval cases.
Changed:

- The implementation passed every test and still spread the request body into the insert. Reading the
  diff showed that a body with `createdAt` reaches the database layer, against "the server ignores
  fields it does not know". Added a test, then named every column.
- `submittedAt` was rounded in the review queue and truncated in the submission review, so the two
  could differ by 1 ms. Added a test and used `floor`.
- Swagger UI offered no `Idempotency-Key` field, so nobody could submit from `/docs`. Added a test
  and the header to the OpenAPI document.
- Own case `s03` looped a fixed 20 times, so its C2 label could be argued either way. Rewrote the
  case, as the dev set's README asks.

Rejected: a review queue that returns the newest Accepted submission (D3 of PA#2): FAQ-02 counts the
last submission, whatever its result.
By hand: Bình approved editing `docs/contract/`, the contract tests and the `eval/` permission rule.

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

## 2026-11-24: queue, worker, judged exactly once

Tool: Claude Code.
Asked for: the pg-boss queue, a worker process with the judge and review jobs, and a test that a
submission is judged exactly once, as designed and approved by Ngọc.
Kept: 18 queue tests first, red because the modules did not exist (`3834e37`); the judge job is sent
in the transaction that stores the submission; two worker processes on the server, so that the one
that may use Docker has no model key and refuses to start with one.
Changed: 18 of 18 passed on the first run, which proved little. Ten faults were put in one at a time
(for example `ON CONFLICT` removed, the job sent outside the transaction). Nine were caught at once;
the tenth survived because the fault was written wrong (it enqueued another submission), and was
caught once it was corrected.
Rejected: a required `queue` in `AppDeps`: it would have forced an edit of the contract tests'
helper, so it is optional there and always passed by `server.ts`.
Found while running it, not changed: `§2 a body over 512 KiB is 413` fails on Windows only, with
ECONNRESET, before and after this change; CI (Linux) passes.

By hand: approving the design and every commit message.

## 2026-11-24: public deployment

Tool: Claude Code.
Asked for: a low-cost Azure server, HTTPS, and the workers without a Docker socket in any container.
Kept: Compose for Caddy, the API and PostgreSQL; two systemd services for the workers.
Changed: the first run on the server judged nothing. The docker client may not read the home
directory of the service user and prints a warning before the container's start mark, which the code
expected as the first bytes of stderr. All local and CI runs had passed. Found by running the attacks
through the deployment; a test with a broken client configuration was red first. No submission got a
wrong result meanwhile: they stayed in `judging` and were retried.
Rejected: Malaysia, the nearest region, for Central India: the same machine costs about 40% less.
Verified on the server: 13 attack submissions through HTTPS, the queue and the worker, 4 of them
also against the harmful answer; worker stopped, submit, started: one set of verdicts; a reboot.

By hand: the Azure account and login, the approval of the cost and of every commit message.

## 2026-11-27: continuous deployment

Tool: Claude Code.
Asked for: deploy `main` to the server on every green merge.
Found first: the server still ran a build from before the PA#3 API. `POST /v1/auth/login`,
`/v1/classes` and `/docs` answered 404 while `POST /v1/labs/1/submissions` answered 401, which
matches the `deploy` branch of 2026-11-24. Nothing redeployed it after the later merges.
Kept: a `deploy` workflow after CI on `main`, SSH with one key in a GitHub secret, the host key
pinned in a repository variable, and a check that the new routes answer.
Changed: the assistant first argued for a timer on the server that pulls `main`, so that no secret
sits in GitHub, and cited "CI stores no secret" from PA2.md. That line described CI at the `pa2`
tag, not a rule. We kept the secret and limited what it can do instead: a `deploy` user, a forced
command in `authorized_keys` and one sudo rule, so the key runs `deploy.sh main` and nothing else.
Rejected: `StrictHostKeyChecking=no`, which would hand the key to any server answering on that name.

## 2026-11-24: hard rules

Tool: Claude Code.
Asked for: decide ban-list constraints without the model, with tests first, the dev set's traps and
disguises included.
Kept: comment stripping with a C++ tokenizer, a small preprocessor for the student's macros, a syntax
tree, and name resolution that tells the student's own `sort` from the library's. A constraint that
is not a plain ban list is left to the model.
Changed:

- A macro used inside another macro cited one line too many. The code was fixed, not the test.
- A `friend` function was flagged as the library's, which would be a wrongful deduction, and
  `&std::string::rbegin` was missed. A test for each was red first.

Rejected: the native `tree-sitter` package: the peer range of `tree-sitter-cpp` (`^0.21.1`) does not
cover 0.25. The WASM build fits and needs no compiler.
By hand: Hương decided to install tree-sitter, and copied and committed the dev set herself: the
assistant may not edit `eval/`.

## 2026-11-24: model call, its limits, the checker

Tool: Claude Code.
Asked for: the OpenRouter client, the schema and time limits around it, and the checker command with
its Docker image.
Kept: comments and identity are removed before the prompt is built; an answer that does not fit the
schema, cites a line that is not in the code, or comes too late becomes `unsure`; one call-log entry
per call. Every test uses a fake model or a fake `fetch`.
Changed: the first system prompt gave `mergeSort` as its example of a misleading function name.
Merge sort is in the dev set, so the example was replaced by a neutral sentence.
Rejected: counting an HTTP 200 as a success: OpenRouter can put an error inside one.
Not done yet: no real model has been called so far.

## 2026-11-26: the model in the worker

Tool: Claude Code.
Asked for: merge `foundation`, connect the model to the review worker, write the documentation.
Kept: a worker that reviews stops at once without the model settings, instead of being `unsure` about
every submission.
Changed:

- Four queue tests were red after the merge. They expected two `unsure` verdicts because they were
  written when `review()` was a stub; a hard rule now decides the first constraint. The expectation
  was changed in a commit of its own, and now checks the source and the unsure reason as well.
- Two assistant sessions worked in one folder, and `git add -A` took two test files of the other
  session into a local commit. It was seen before any push; the work moved to a worktree of its own.
- So two sets of commits were made again after the code existed, and are not counted as test-first:
  `0323d1c`, `0f53c89` (the worker's model; its test had run red before the code, in the local commit
  that they replace) and `d52ef0d` … `a4e79bd` (the explanation of a verdict).
- Before the first run, a probe file showed that `npm run format:check` would reject the report that
  `eval.mjs` writes. `eval/runs/` is now left out of Prettier: a run is evidence and is not reformatted.

By hand: Hương approved the plan, and the change to the queue tests, before it was made.

## 2026-11-26: choosing the model

Tool: Claude Code.
Asked for: the DeepSeek models on OpenRouter, with their prices, then the documentation for the
one chosen.
Kept: `deepseek/deepseek-v4-flash-0731`, a version with a date. Of the DeepSeek versions with a date
that OpenRouter listed on 2026-11-26, it was the cheapest ($0.06 in, $0.18 out per million tokens),
and it supports structured outputs.
Rejected:

- `anthropic/claude-haiku-5.5`, proposed first ($0.10 in, $0.50 out).
- Names that start with `~` (`~deepseek/deepseek-flash-latest`): they move to each new version, so a
  dev-set run could not be repeated.
- `:batch` versions: not checked to answer each call at once, which the review job needs.
- The `pro` versions: $4.44 per million output tokens for `deepseek-v4-pro-0813`.

Not checked yet: this model can reason before it answers. Whether that fits in the 4000 output tokens
of a call, and what it costs, is what the trial of three calls before the dev-set run will show.

By hand: Hương chose the model.

## 2026-11-26: the real-model runs on the dev set

Tool: Claude Code.
Asked for: a script that runs the checker with the real model (a trial of three calls, the cost,
a confirmation, the full run, `eval.mjs`, checks of the call log), then the run itself.
Kept: the script refuses uncommitted code, so a run names the commit it measured, and it never
overwrites a run. Its checks: 102 predictions, each of the 47 semantic pairs called once, no call
for a ban list, request ids, no comment of the code in a prompt, no key in the files, `eval.mjs` and
`labels.jsonl` unchanged. Both runs are committed in `eval/runs/`.
Changed:

- First run (`25b065d`): 0 wrongful deductions, recall 78.4%, unsure 22.5%. All 23 `unsure` came
  from one thing: the model wrote `"pass"` or `"violation"` in the `constraint` field. The schema
  allowed any string there. It now allows only the code asked about, so the provider enforces it:
  test `8440e34` (red), then `8a7f449`. The check that the answer names that code is still there.
- Second run (`8a7f449`): 0 wrongful deductions, recall 94.6% (35/37), unsure 2.0% (2/102). Cost of
  a lab of 80: 80 × 1.00 × $0.000213 = $0.017.

Not changed: the prompt and the hard rules. The fix is about the shape of every answer, not about a
problem of the dev set.
Not done yet: one answer wrote spaces until the 4000 output tokens ran out (18 s, the most
expensive call of the run). It is `unsure`, as an answer that does not fit the schema should be.

By hand: Hương asked for both runs and for the fix between them.

## 2026-11-28: the model at Anthropic

Tool: Claude Code.
Asked for: call Claude Haiku directly at Anthropic, with an Anthropic key, instead of through
OpenRouter; then a run on the dev set.
Kept: the official SDK `@anthropic-ai/sdk` 1.14 (`40e10e8`), behind the same model interface as the
OpenRouter client, chosen by `LLM_PROVIDER`. Test first: `dec0b8f` (red), then `dc1977b`. The client
gives the SDK the key and the address itself, so no `ANTHROPIC_*` variable or profile of the machine
is used. The SDK's own retries are off and the client retries, so a 429 at the spend limit becomes
`cost_limit` and is not retried, while a busy 429 is. Anthropic reports tokens, not money: the cost
of a call is computed from the price in the code. A refusal, or an answer cut off at the token
limit, is logged and becomes `unsure`.
Changed:

- The first test expected the key in the `x-api-key` header. SDK 1.x sends it as
  `Authorization: Bearer`, seen in its code. The expectation was changed in a commit of its own,
  before the code and still red (`2710cd7`). It checks as strictly as before that the key is in no
  other header, nor in the address or the body. A lint fix of the test is also its own commit
  (`8404695`).
- Two trials of three calls failed with OpenRouter 401 before the run, because `.env` still named
  OpenRouter as the provider; they cost nothing. The run script's key check now also looks for
  `sk-ant-`.
- Run at `dc1977b`, committed in `eval/runs/2026-11-28-claude-haiku-5-5`: 0 wrongful deductions,
  recall 100.0% (37/37), unsure 0.0% (0/102). 47 calls, all with a request id; 66,554 input and
  8,743 output tokens, $0.011027. Cost of a lab of 80: 80 × 1.00 × $0.000235 = $0.019.

Not changed: the prompt, the hard rules and the schema.
Not done yet: the spending cap on the Anthropic key, and its screenshot.

By hand: Hương chose Claude Haiku at Anthropic, approved the new dependency, and set the key in
`.env` herself.

## 2026-11-28: the deployment writes the model settings

Tool: Claude Code.
Asked for: no more editing `/etc/leetkob/model.env` by hand on the server; the model settings come
from GitHub, as a pull request of its own on `foundation`.
Kept: the forced command and the one sudo rule; the deploy key still runs one command. It now has
`--model-env-on-stdin`, and the job sends `LLM_PROVIDER`, `LLM_MODEL` (variables of the `production`
environment) and `LLM_API_KEY` (its secret) on standard input.
Changed:

- A probe of `deploy.sh` with 21 inputs found that `read` dropped a last line without a newline, so
  the key line was lost. Fixed with `|| [ -n "$line" ]`; every bad input now stops before
  `cd /opt/leetkob`, and no message shows a value.
- The first wording of `PERMISSIONS.md` put `DEPLOY_SSH_KEY` in the `production` environment; the
  README sets it as a repository secret. Corrected.

Rejected: Azure Key Vault with the VM's managed identity, the usual way on Azure: we do not own the
subscription.

Not checked yet: no deployment has run with it. The settings of the repository (the variables, the
secret, and the rule that only `main` may deploy to `production`) are not set.

By hand: Bình chose this way.
