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

| Part            | Choice                                         |
| --------------- | ---------------------------------------------- |
| Language        | TypeScript on Node.js 22                       |
| API             | Fastify, errors as problem details (RFC 9457)  |
| Database        | PostgreSQL, schema and migrations with Drizzle |
| Queue           | pg-boss on the same PostgreSQL (planned, PA#3) |
| Sandbox         | Docker containers with `gcc` (planned, PA#3)   |
| Hard rules      | tree-sitter-cpp (planned, PA#3)                |
| Tests           | Vitest — unit tests and HTTP contract tests    |
| Lint and format | ESLint (type-aware), Prettier, `tsc --noEmit`  |
| CI              | GitHub Actions                                 |
| Model           | not chosen yet (PA#3)                          |

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
├── drizzle/                 # generated SQL migrations (do not edit by hand)
├── src/
│   ├── app.ts               # builds the Fastify app: JSON parsing, problem+json errors, routes
│   ├── server.ts            # entry point: reads config, connects to PostgreSQL, listens
│   ├── config.ts            # environment variables → typed config
│   ├── problem.ts           # the error model: problem types, ProblemError
│   ├── auth.ts              # bearer tokens (HS256 JWT), id parsing
│   ├── idempotency.ts       # Idempotency-Key rules, request fingerprint
│   ├── db/
│   │   ├── schema.ts        # users, classes, class_members, labs, submissions, idempotency_keys
│   │   └── client.ts        # PostgreSQL pool + Drizzle client
│   └── routes/
│       ├── health.ts        # GET /v1/health
│       └── submissions.ts   # POST /v1/labs/{labId}/submissions
├── test/
│   ├── unit/                # fast tests: no database, no network, no real model calls
│   └── contract/            # HTTP-only tests written from docs/contract/, against PostgreSQL
├── .env.example             # every variable the app reads, without values
├── docker-compose.yml       # local PostgreSQL
├── drizzle.config.ts        # migration tool config
├── eslint.config.js         # lint rules
├── tsconfig.json            # type check (src, test, configs)
├── tsconfig.build.json      # build: src → dist
├── vitest.config.ts         # test projects: unit, contract
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
| All of them    | `npm run check`         |

Contract tests need the PostgreSQL from `docker compose` (they read `DATABASE_URL` and
`JWT_SECRET` from `.env`), migrate it, and start the app in-process. Each test creates its own users,
classes and labs, so they can run against a database that already has data. To run them against a
deployed server, also set `CONTRACT_BASE_URL`, e.g. `CONTRACT_BASE_URL=https://example.org`.

## Model and cost

- Provider and model: not chosen yet — the LLM feature arrives in PA#3. Unit tests never call a real
  model.
- Spending cap on the API key: **to be set before the key is created** (PA#3), and recorded here.
- Cost of one lab (about 80 submissions): measured in PA#3.
- Data sent to the model: the lab statement, the constraints, and the submission code with comments,
  names and student IDs stripped. Nothing else.

## Working on this repository

- `main` is protected: every change goes through a pull request with green checks.
- Rules for the coding assistant: [`CLAUDE.md`](CLAUDE.md); its permissions:
  [`PERMISSIONS.md`](PERMISSIONS.md); how AI was used: [`AI-LOG.md`](AI-LOG.md).
