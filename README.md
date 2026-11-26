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

| Part            | Choice                                             |
| --------------- | -------------------------------------------------- |
| Language        | TypeScript on Node.js 22                           |
| API             | Fastify, errors as problem details (RFC 9457)      |
| Database        | PostgreSQL, schema and migrations with Drizzle     |
| Queue           | pg-boss on the same PostgreSQL                     |
| Sandbox         | one-shot Docker containers, `gcc` pinned by digest |
| Hard rules      | web-tree-sitter with the tree-sitter-cpp grammar   |
| Tests           | Vitest — unit tests and HTTP contract tests        |
| Lint and format | ESLint (type-aware), Prettier, `tsc --noEmit`      |
| CI              | GitHub Actions                                     |
| Model           | `deepseek/deepseek-v4-flash-0731` via OpenRouter   |

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
capabilities dropped. Limits are those of FAQ-05: 1 s CPU per test, wall clock 3× that, which kills
the container, 256 MB with swap included, 1 MB of output. Compiling gets 10 s and 512 MB: a program
that uses `<regex>` does not compile within 256 MB.

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

Otherwise it needs `LLM_PROVIDER=openrouter`, `LLM_MODEL` and `LLM_API_KEY` from `.env`. The summary
goes to standard error. Exit code: 0 done, 1 some pair failed, 2 wrong usage or missing settings;
through `npm` every failure is 1.

The same command as an image, without network and without a key:

```bash
docker build -t leetkob-checker -f Dockerfile.checker .
docker run --rm --network none -e MODEL_OFF=1 -v "$PWD/eval/leetkob-eval:/data:ro" \
  leetkob-checker /data > predictions.jsonl
```

With the model off, the hard rules decide 55 of the 102 pairs of the dev set with 0 wrongful
deductions; the other 47 are `unsure`, so `eval.mjs` exits with 1 (recall 40.5%, unsure 46.1%).

With `deepseek/deepseek-v4-flash-0731`, measured on 2026-11-26 (the folder has the predictions, the
`eval.mjs` report and the call log with the provider's request ids):

| Run in `eval/runs/`                            | Commit    | Wrongful | Recall        | Unsure         |
| ---------------------------------------------- | --------- | -------: | ------------- | -------------- |
| `2026-11-26-deepseek-v4-flash-0731`            | `25b065d` |        0 | 78.4% (29/37) | 22.5% (23/102) |
| `2026-11-26-deepseek-v4-flash-0731-schema-fix` | `8a7f449` |        0 | 94.6% (35/37) | 2.0% (2/102)   |

In the first run the model put the verdict in the `constraint` field of 23 answers, which were then
`unsure`. The schema now allows only the code of the constraint asked about. The two violations
still missed are `unsure`: one answer gave no evidence line, and one wrote spaces until the 4000
output tokens ran out, so it was not valid JSON.

## Deployment

<https://leetkob-awad.centralindia.cloudapp.azure.com>: one Ubuntu server. Caddy (HTTPS), the API and
PostgreSQL run in Docker Compose; the two workers run on the host under systemd, so no container
mounts the Docker socket. The model key is only in `/etc/leetkob/model.env`, which systemd gives to
the review worker.

```bash
sudo deploy/setup.sh <dns-name>           # once, on a fresh Ubuntu 24.04
sudo /opt/leetkob/deploy/deploy.sh main   # every version: a branch or a tag
```

## Model and cost

- Provider: [OpenRouter](https://openrouter.ai). Model: `deepseek/deepseek-v4-flash-0731`.
  `LLM_MODEL` is this name, not a key; the only key is `LLM_API_KEY`. Unit tests never call a real
  model.
- The name has a date: the model behind it does not change, so a run can be repeated. Not an alias
  such as `~deepseek/deepseek-flash-latest`, which moves to each new version.
- OpenRouter sends each call to one of several providers of this model. The request asks only for
  providers that enforce the JSON schema (`provider.require_parameters`). Their prices differ: on
  2026-11-26 OpenRouter listed $0.06 per million input tokens and $0.18 per million output tokens,
  and its providers ranged from $0.047 to $0.44 input. The call log keeps the cost OpenRouter
  reports for each call.
- Spending cap: the project's API key ("AWAD Final Project") has a **credit limit of $2 in
  total**, set on the key in OpenRouter when it was created on 2026-11-11. The limit does not
  reset, and the key expires on 2027-05-10
  ([screenshot](docs/evidence/openrouter-key-cap.png): $0.000 used, never used). Once the $2 is
  spent, OpenRouter refuses requests made with that key. The key lives only in each
  member's `.env` (`LLM_API_KEY`), never in the repository, CI or the sandbox.
- Cost of one lab (80 submissions), from the call log of the run after the schema fix: $0.010028
  for 47 calls is $0.000213 per call; the dev set has 47 semantic constraints for 47 solutions, 1.00
  per submission; 80 × 1.00 × $0.000213 = **$0.017**. A ban list costs nothing: the model is not
  called for it. A lab with more semantic constraints per submission costs that many times more.
- Spent on 2026-11-26: $0.018624 for the two committed runs, $0.019892 with the three trials of
  three calls before them (call logs and the run script's output).
- Data sent to the model: the lab statement, one constraint, and the submission code without
  comments, with the words of string literals masked and eight-digit student IDs in identifiers
  zeroed. Nothing else.

## Working on this repository

- `main` is protected: every change goes through a pull request with green checks.
- Rules for the coding assistant: [`CLAUDE.md`](CLAUDE.md); its permissions:
  [`PERMISSIONS.md`](PERMISSIONS.md); how AI was used: [`AI-LOG.md`](AI-LOG.md).
