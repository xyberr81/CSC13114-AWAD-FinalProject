# LeeTKOB

LeeTKOB helps a teaching assistant check, **with evidence**, that _Accepted_ C++ lab submissions
really follow the assignment's constraints before the marks are published.

Class project of CSC13114 (Advanced Web Application Development), class 2609-AWAD-23/3, built from
checkpoint PA#2 to PA#6. Product proposed by Lê Tấn Hiệp, Tống Dương Thái Hoà and Nguyễn Phúc
Hoàng, who act as the product owners.

## The problem

The night before marks are published, a TA reads about 80 Accepted submissions one by one to check
that each student really implemented, say, merge sort. A submission can pass every test and still
break the rules: it calls `std::sort`, or implements bubble sort where merge sort was required.
Reading them all takes 3–4 hours a week, and a wrongful deduction can push a student below the pass
mark and trigger dozens of appeals.

## What LeeTKOB does

1. **Accounts and roles**: admin, TA and student. TAs belong to classes; each lab belongs to a class.
2. **Submitting and judging**: a student submits C++ code; it is queued, compiled and run in a
   sandbox against the TA's tests, and the student sees the result in real time.
3. **Constraint review** of every Accepted submission:
   - **Hard rules first**: syntax-aware checks (e.g. a call to `std::sort`, not the student's own
     `sort`). When a hard rule decides a constraint, the model is not called.
   - **Then the model**, only for semantic constraints (is the required algorithm really used, is
     recursion really present, is an auxiliary array hidden somewhere). For each constraint it
     returns `pass` / `violation` / `unsure` with the code lines that prove it. It never decides
     the deduction: the TA set that.
   - **Guardrails**: schema-validated output; every evidence line must match the submitted code
     exactly, otherwise the verdict becomes `unsure`; timeouts become `unsure`; a cost cap per lab.
4. **Human gate**: every `violation`, every `unsure` and a random 10% of `pass` verdicts go to the
   TA's review queue. Marks are published only after the TA has reviewed them and pressed
   **Publish**.
5. **Appeals**: after publishing, a student can appeal a deduction; the TA accepts it or rejects it
   with a reason.

Quality bar for the checker, measured on the dev and held-out eval sets: **0** wrongful deductions
on compliant solutions, **≥ 90%** of violations caught with a correct evidence line, **≤ 20%**
`unsure` verdicts.

Only the lab statement, the constraints and the code (comments, names and student IDs stripped) are
ever sent to the model.

## Stack

| Part            | Choice                                                |
| --------------- | ----------------------------------------------------- |
| Language        | TypeScript on Node.js 22                              |
| API             | Fastify, errors as problem details (RFC 9457)         |
| Database        | PostgreSQL, schema and migrations with Drizzle        |
| Queue           | pg-boss on the same PostgreSQL                        |
| Sandbox         | one-shot Docker containers, `gcc` pinned by digest    |
| Hard rules      | web-tree-sitter with the tree-sitter-cpp grammar      |
| Tests           | Vitest — unit tests and HTTP contract tests           |
| Lint and format | ESLint (type-aware), Prettier, `tsc --noEmit`         |
| CI              | GitHub Actions                                        |
| Model           | `claude-haiku-5-5` at Anthropic (`@anthropic-ai/sdk`) |

## API

| Endpoint                            | Contract                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `POST /v1/labs/{labId}/submissions` | [`docs/contract/post-lab-submissions.md`](docs/contract/post-lab-submissions.md) |
| `GET /v1/health`                    | liveness only, no contract                                                       |

Every `/v1` error is a problem details object (RFC 9457); the problem types are listed in each
contract. A contract is changed only by its own pull request, never together with the code.

## Repository structure

```text
.
├── .claude/
│   └── settings.json        # assistant permissions: allow / ask / deny (see PERMISSIONS.md)
├── .github/
│   └── workflows/
│       └── ci.yml           # every check, on each pull request, on main and on pa* tags
├── docs/
│   └── contract/            # frozen API contracts — the spec the code and the tests follow
├── apps/
│   ├── api/                 # the backend (npm workspace @leetkob/api)
│   │   ├── drizzle/         # generated SQL migrations (do not edit by hand)
│   │   ├── src/
│   │   │   ├── app.ts       # builds the Fastify app: JSON parsing, problem+json errors, routes
│   │   │   ├── server.ts    # entry point: reads config, connects to PostgreSQL, listens
│   │   │   ├── config.ts    # environment variables → typed config
│   │   │   ├── problem.ts   # the error model: problem types, ProblemError
│   │   │   ├── auth.ts      # bearer tokens (HS256 JWT), id parsing
│   │   │   ├── idempotency.ts # Idempotency-Key rules, request fingerprint
│   │   │   ├── db/          # schema.ts (every table), client.ts (pool + Drizzle)
│   │   │   ├── queue/       # pg-boss: jobs are sent in the transaction that stores the data
│   │   │   ├── sandbox/     # judge(): compiles and runs code in hardened containers
│   │   │   ├── worker/      # `npm run worker`: the judge and review jobs
│   │   │   ├── review/      # review(): hard rules first, then the model and its limits
│   │   │   ├── checker/     # `npm run checker`: review() over a dataset folder
│   │   │   └── routes/      # one Fastify plugin per part, registered in app.ts
│   │   ├── test/
│   │   │   ├── unit/        # fast tests: no database, no network, no real model calls
│   │   │   ├── contract/    # HTTP-only tests written from docs/contract/, against PostgreSQL
│   │   │   ├── queue/       # the queue and the worker, against PostgreSQL; no Docker, no model
│   │   │   └── sandbox/     # attack submissions and their controls, against Docker
│   │   ├── drizzle.config.ts # migration tool config
│   │   ├── tsconfig.json    # type check (src, test, configs); tsconfig.build.json: src → dist
│   │   └── vitest.config.ts # test projects: unit, contract, queue, sandbox
│   └── web/                 # the frontend (PA#4 onwards; not started)
├── deploy/                  # the public deployment: Compose, systemd units, scripts
├── eval/                    # the published dev set (never edited) and our own cases
├── Dockerfile.checker       # the checker image
├── .env.example             # every variable the app reads, without values
├── docker-compose.yml       # local PostgreSQL
├── eslint.config.js         # lint rules, for every workspace
├── package.json             # npm workspaces; the root scripts run each workspace's checks
├── CLAUDE.md                # rules for the coding assistant: stack, commands, conventions, never
├── PERMISSIONS.md           # what the assistant may do, must ask for, may never do
├── AI-LOG.md                # how AI was used, per task
└── PA2.md                   # PA#2 checkpoint: links to the evidence
```

## Getting started

Requires Node.js 22 (see `.nvmrc`) and Docker for the local database.

```bash
git clone git@github.com:xyberr81/CSC13114-AWAD-FinalProject.git
cd CSC13114-AWAD-FinalProject
cp .env.example .env        # fill in the values, see below
npm ci
docker compose up -d db     # local PostgreSQL
npm run db:migrate
npm run dev                 # http://127.0.0.1:3000/v1/health
```

The worker is a process of its own and needs Docker:

```bash
npm run sandbox:pull        # once: the sandbox image
npm run worker              # judges and reviews what the API puts on the queue
```

A worker that reviews does not start without `LLM_PROVIDER`, `LLM_MODEL` and `LLM_API_KEY` (§Model and
cost). Without a key, start it with `MODEL_OFF=1`: hard rules only.

In `.env`, choose any `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`, set
`DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/<db>` to match, and generate
`JWT_SECRET` with `openssl rand -hex 32`. `.env` is git-ignored; never commit it.

## Checks

CI runs exactly these commands; they must all pass before a pull request can be merged into `main`.

| Check          | Command                 |
| -------------- | ----------------------- |
| Lint           | `npm run lint`          |
| Format check   | `npm run format:check`  |
| Type check     | `npm run typecheck`     |
| Unit tests     | `npm test`              |
| Contract tests | `npm run test:contract` |
| Queue tests    | `npm run test:queue`    |
| All of them    | `npm run check`         |
| Sandbox tests  | `npm run test:sandbox`  |

Lint, format check, type check and unit tests need nothing but the installed dependencies: no
database, no Docker, no network. The sandbox tests need Docker and are not part of `npm run check`;
CI runs them as the job `sandbox`, on every pull request and on `pa*` tags.

Contract and queue tests need the PostgreSQL from `docker compose` (they read `DATABASE_URL` and
`JWT_SECRET` from `.env`), migrate it, and start the app in-process. Each test creates its own users,
classes and labs, so they can run against a database that already has data. To run them against a
deployed server, also set `CONTRACT_BASE_URL`, e.g. `CONTRACT_BASE_URL=https://example.org`.

## Queue and sandbox

The submit route stores the submission and its `judge` job in one transaction and judges nothing.
`npm run worker` runs two jobs:

- `judge` compiles and runs the code against the lab's tests. If the submission is Accepted, the
  `review` job is sent in the transaction that stores the results.
- `review` decides the constraints that have no verdict yet. `verdicts` is unique on (submission,
  constraint) and inserts use `ON CONFLICT DO NOTHING`.

Delivery is at least once and both jobs are safe to repeat, so a submission ends with one set of
verdicts, also when a worker dies while judging. A sandbox that fails is retried and never becomes
the student's result. `WORKER_JOBS=judge` or `review` runs one job per process; the process that may
use Docker refuses to start with `LLM_API_KEY`. Run one judge worker per Docker host: when it starts,
it removes the containers the last one left.

Student code is compiled and run only in one-shot containers (`apps/api/src/sandbox/docker.ts`):
no network, no mounts, no environment of ours, uid 65534, read-only root, 16 processes, all
capabilities dropped. Limits are those of FAQ-05: 1 s CPU per test for all its processes together
(from the container's `cpu.stat`), wall clock 3× that, which kills the container, 256 MB with swap
included, 1 MB of output. Compiling gets 10 s and 512 MB: a program that uses `<regex>` does not
compile within 256 MB.

`apps/api/test/sandbox/attacks.test.ts` has an attack submission for each of the nine minimums of
the brief, and `controls.test.ts` takes one limit away at a time and checks that the attack then
succeeds.

## Checker

`npm run checker` runs the product's own `review()` over a dataset folder in the layout of
`eval/leetkob-eval/` and writes one prediction per (solution, constraint) pair. It reads the problems
and the solutions, never `labels.jsonl` or the tests.

```bash
npm run checker -- eval/leetkob-eval --out predictions.jsonl --calls calls.jsonl
node eval/leetkob-eval/eval.mjs --data eval/leetkob-eval --predictions predictions.jsonl
```

| Option or variable  | Meaning                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `--out <file>`      | the prediction file; without it, standard output (then use `npm run --silent`)   |
| `--calls <file>`    | the call log, with the provider's request ids; an existing file is refused       |
| `--limit <n>`       | only the first `n` solutions                                                     |
| `--concurrency <n>` | pairs reviewed at once, 4 by default                                             |
| `MODEL_OFF=1`       | hard rules only: every semantic constraint is `unsure`, and no network is needed |

Otherwise it needs `LLM_PROVIDER` (`anthropic` or `openrouter`), `LLM_MODEL` and `LLM_API_KEY` from
`.env`. The summary goes to standard error. Exit code: 0 done, 1 some pair failed, 2 wrong usage or
missing settings; through `npm` every failure is 1.

The same command as an image, without network and without a key:

```bash
docker build -t leetkob-checker -f Dockerfile.checker .
docker run --rm --network none -e MODEL_OFF=1 -v "$PWD/eval/leetkob-eval:/data:ro" \
  leetkob-checker /data > predictions.jsonl
```

With the model off, the hard rules decide 55 of the 102 pairs of the dev set with 0 wrongful
deductions; the other 47 are `unsure`, so `eval.mjs` exits with 1 (recall 40.5%, unsure 46.1%).

With a real model (each folder has the predictions, the `eval.mjs` report and the call log with the
provider's request ids):

| Run in `eval/runs/`                            | Commit    | Wrongful | Recall         | Unsure         |
| ---------------------------------------------- | --------- | -------: | -------------- | -------------- |
| `2026-11-26-deepseek-v4-flash-0731`            | `25b065d` |        0 | 78.4% (29/37)  | 22.5% (23/102) |
| `2026-11-26-deepseek-v4-flash-0731-schema-fix` | `8a7f449` |        0 | 94.6% (35/37)  | 2.0% (2/102)   |
| `2026-11-28-claude-haiku-5-5`                  | `dc1977b` |        0 | 100.0% (37/37) | 0.0% (0/102)   |

The model of the product is `claude-haiku-5-5`, called at Anthropic: the last run, on 2026-11-28.
Its 47 answers all fit the schema and ended normally, with at most 757 output tokens; a call took
1.8 s at the median and 3.7 s at most.

The first two runs, on 2026-11-26, are of `deepseek/deepseek-v4-flash-0731` through OpenRouter. In
the first, the model put the verdict in the `constraint` field of 23 answers, which were then
`unsure`. The schema now allows only the code of the constraint asked about. In the second, two
violations were missed and `unsure`: one answer gave no evidence line, and one wrote spaces until
the 4000 output tokens ran out, so it was not valid JSON.

## Deployment

<https://leetkob-awad.centralindia.cloudapp.azure.com>: one Ubuntu server. Caddy (HTTPS), the API and
PostgreSQL run in Docker Compose; the two workers run on the host under systemd, so no container
mounts the Docker socket. The model settings are in `/etc/leetkob/model.env`, which systemd gives to
the review worker only; each deployment from GitHub writes that file (below).

```bash
sudo deploy/setup.sh <dns-name> [deploy-key.pub]   # once, on a fresh Ubuntu 24.04; safe to rerun
sudo /opt/leetkob/deploy/deploy.sh main            # by hand: a branch or a tag
```

Continuous deployment: when CI is green on a push to `main`, `.github/workflows/deploy.yml` logs in
as the `deploy` user and runs `deploy.sh main`, then checks that `/v1/health` and `/docs/json`
answer. Its key can do nothing else: `setup.sh` puts it in `authorized_keys` with
`restrict,command="sudo -n /opt/leetkob/deploy/deploy.sh main --model-env-on-stdin"`, and sudo allows
that one command.

The model settings come from the `production` environment of the repository: `LLM_PROVIDER` and
`LLM_MODEL` are variables, `LLM_API_KEY` is a secret. The job sends the three of them on the standard
input of the SSH session, never on a command line or in a file. `deploy.sh` checks them before it
changes anything (three lines, in that order, none empty) and replaces `model.env` just before the
workers restart. So the model of the server changes in GitHub, not on the server, and a missing
setting fails the deployment while the old version keeps running.
`main` only changes through a green pull request, so the deployment never runs code that failed CI.
One deployment runs at a time; it deploys `main` as it is when the job starts.

Turning it on, once:

```bash
ssh-keygen -t ed25519 -N '' -C leetkob-deploy -f deploy-key       # on your machine
sudo /opt/leetkob/deploy/setup.sh <dns-name> deploy-key.pub        # on the server
gh secret set DEPLOY_SSH_KEY < deploy-key && rm deploy-key
gh variable set DEPLOY_HOST --body <dns-name>
ssh-keyscan -t ed25519 <dns-name> | gh variable set DEPLOY_KNOWN_HOSTS
gh variable set LLM_PROVIDER --env production --body <provider>
gh variable set LLM_MODEL --env production --body <model>
gh secret set LLM_API_KEY --env production                        # paste the key when asked
```

In the repository settings, Environments → `production` → Deployment branches, allow `main` only.
Otherwise a workflow on any branch could name the environment and read `LLM_API_KEY`.

On a server set up before `--model-env-on-stdin` existed, rerun `setup.sh` with the deploy key that
is already installed, once main has the new scripts:

```bash
sudo sh -c "grep -o 'ssh-ed25519 .*' /home/deploy/.ssh/authorized_keys > /root/deploy-key.pub"
sudo /opt/leetkob/deploy/setup.sh <dns-name> /root/deploy-key.pub
```

Until then the old forced command ignores the settings and deploys as before.

Compare the scanned key with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server
before you trust it.

## Model and cost

- Provider: [Anthropic](https://www.anthropic.com), called directly with the official SDK
  `@anthropic-ai/sdk` (`LLM_PROVIDER=anthropic`). Model: `claude-haiku-5-5` (Claude Haiku 5.5).
  `LLM_MODEL` is this name, not a key; the only key is `LLM_API_KEY`. The client gives the SDK the
  key and the address itself, so no `ANTHROPIC_*` variable of the machine is used. Unit tests never
  call a real model.
- The JSON schema of the answer is sent as `output_config.format`, so Anthropic enforces it; the
  answer is checked again here. An answer cut off at the 4000-token limit, or a refusal, is logged
  and becomes `unsure`.
- Price: $0.10 per million input tokens and $0.50 per million output tokens, for a prompt of 100K
  tokens or less ($0.50 and $2.50 above; a prompt of the dev set has about 1,400). The model's
  thinking, if any, is counted as output tokens. Anthropic reports tokens, not money, so the client
  computes the cost of each call from this price (`apps/api/src/review/anthropic.ts`) and the call
  log keeps it.
- Spending cap: a spend limit of **$50 a month** on the Claude Console workspace that holds the key
  (no screenshot yet). At the dev-set cost of a lab below, that is about 2,600 labs a month. When
  Anthropic refuses a call for the cap (429 `enforced_spend_limit_reached`) or for lack of credit (402), the verdict
  becomes `unsure` with the reason `cost_limit`, and the call is not retried. The key lives only in
  each member's `.env` (`LLM_API_KEY`), in the `production` environment secret that the deploy job
  sends to the server, and in the server's `/etc/leetkob/model.env`; never in the repository, the CI
  job or the sandbox.
- Cost of one lab (80 submissions), from the call log of the run of 2026-11-28: 66,554 input and
  8,743 output tokens for 47 calls, 66,554 × $0.10 + 8,743 × $0.50 per million = $0.011027, so
  $0.000235 per call; the dev set has 47 semantic constraints for 47 solutions, 1.00 per submission;
  80 × 1.00 × $0.000235 = **$0.019**. A ban list costs nothing: the model is not called for it. A
  lab with more semantic constraints per submission costs that many times more.
- Spent on 2026-11-28: $0.012477 at the price above (not read from Anthropic's bill): $0.011027 for
  the committed run and $0.001450 for its two trials of three calls. Two trials before them went to
  OpenRouter with this key, were refused (401) and cost nothing.
- Before: the two DeepSeek runs of 2026-11-26 went through [OpenRouter](https://openrouter.ai)
  (`LLM_PROVIDER=openrouter`, still in the code), with a key capped at $2 in total
  ([screenshot](docs/evidence/openrouter-key-cap.png)). They cost $0.018624, $0.019892 with their
  trials, as reported by OpenRouter; a lab of 80 came to 80 × 1.00 × $0.000213 = $0.017.
- Data sent to the model: the lab statement, one constraint, and the submission code without
  comments, with the words of string literals masked and eight-digit student IDs in identifiers
  zeroed. Nothing else.

## Working on this repository

- `main` is protected: every change goes through a pull request with green checks.
- Rules for the coding assistant: [`CLAUDE.md`](CLAUDE.md); its permissions:
  [`PERMISSIONS.md`](PERMISSIONS.md); how AI was used: [`AI-LOG.md`](AI-LOG.md).
