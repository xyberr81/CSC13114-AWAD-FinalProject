---
name: verify
description: Launch a throw-away LeeTKOB API (Fastify + its own Postgres container) and drive it over HTTP the way a client does, keeping request/response and database evidence. Use to prove an API change works end to end, beyond unit and contract tests, or to reproduce a bug against a running server.
---

# Verify LeeTKOB

LeeTKOB's user surface today is the HTTP API in `apps/api` (no web UI yet; `apps/web` arrives in
PA#4). Verification means: start a private instance, call it with `curl` as a client would, and
keep the responses and the resulting database rows as proof. Feature recipes live in
[`features/`](features/README.md); read its README before driving anything.

Run everything from the repo root. The helpers are in `.claude/skills/verify/scripts/`; below,
`S=.claude/skills/verify/scripts`.

## Launch

```bash
S=.claude/skills/verify/scripts
R=$($S/up.sh | tail -1)    # the run directory, e.g. .verify/20261123-185331-590703
```

`up.sh` takes about 5 seconds and is ready when it prints `up: ready` and the run directory. It:

1. starts `postgres:17` as container `leetkob-verify-<run-id>` on a random `127.0.0.1` port, and
   waits until a TCP query succeeds (not `pg_isready`, which passes while init is still running);
2. applies every migration in `apps/api/drizzle/` and seeds the baseline fixtures
   (`scripts/prepare-db.js` → `$R/seed.json`);
3. starts the API with `node --import tsx apps/api/src/server.ts` on a random port, in its own
   process group, with a clean environment (`env -i`): **`.env` is never read**, `JWT_SECRET` is
   generated per run, and no model key is present;
4. waits for `GET /v1/health` → `{"status":"ok"}`.

`$R/env` holds `BASE_URL`, `DATABASE_URL`, `JWT_SECRET`, ports, the container name and the API's
process group. `source "$R/env"` to use them. The API does **not** reload: after changing code
under `apps/`, run `down.sh` and `up.sh` again (the doctor catches this).

Why not `docker compose up` / `npm run dev`: the compose file binds `127.0.0.1:5432`, which other
projects on a dev machine may already own, and `npm run dev` reads `.env`, which an agent must not
read. Two runs never share anything, so parallel verifications are safe.

`docker` and `curl` are on the "ask" list in `.claude/settings.json`: expect a permission prompt.

## Doctor

```bash
$S/doctor.sh "$R"
```

Read-only. Exits 0 only when every line says `ok`: the container is running, all migrations are
applied, the API process is this run's `server.ts`, that process group owns the port, health
answers, `apps/` has not changed since launch, and `seed.json` has tokens. Run it first whenever a
response looks wrong. Never drive an instance this run did not start.

## Drive

Plain HTTP. `req.sh` sends one request with `curl`, saves it as evidence, and prints it:

```bash
T=$(jq -r .tokens.student "$R/seed.json")
L=$(jq -r .labs.openLab "$R/seed.json")
$S/req.sh "$R" submit-ok POST "/v1/labs/$L/submissions" \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  --data '{"language":"cpp","code":"int main() { return 0; }\n"}'
```

Usage: `req.sh <run-dir> <evidence-name> <METHOD> <path> [curl args...]`. It writes three files
in `$R/evidence/`: `<name>.http` (command with bearer tokens redacted, status line, headers, body),
`<name>.status` (the code alone) and `<name>.body` (the body as received). Assert on the last two:
`cat "$R/evidence/submit-ok.status"`, `jq -r .type "$R/evidence/submit-ok.body"`.

`sql.sh` runs one read-only query and saves the output, to prove side effects:

```bash
$S/sql.sh "$R" submit-ok-rows "select id, lab_id, student_id, status from submissions"
```

Seed fixtures (`$R/seed.json`; ids are numbers, tokens valid for 8 hours):

| Key                     | What it is                                                       |
| ----------------------- | ---------------------------------------------------------------- |
| `users.admin`           | role `admin`, in no class                                        |
| `users.ta`              | role `ta`, TA of class A                                         |
| `users.student`         | role `student`, enrolled in class A                              |
| `users.outsider`        | role `student`, enrolled in class B only                         |
| `labs.openLab`          | class A, deadline in 7 days                                      |
| `labs.closedLab`        | class A, deadline 1 hour before launch                           |
| `labs.otherClassLab`    | class B, deadline in 7 days                                      |
| `tokens.<user>`         | a valid HS256 token for that user, signed with this run's secret |
| `tokens.expiredStudent` | `users.student`, expired 1 hour before launch                    |

There is no login route yet (PA#3), so tokens come from the seed, signed the same way the API's
`issueToken` signs them. When `POST /v1/auth/login` lands, journeys should log in instead.

## Evidence

Everything goes to `$R/evidence/` (`.verify/` is git-ignored and outlives cleanup); `$R/api.log`
has the server log. A proof:

- uses the real client path: HTTP to the running server, with headers and bodies a client would
  send. Never call route handlers, never insert rows mid-journey to fake an outcome;
- records the request and the response (status, headers, body) for every step, not just the last;
- checks the side effect separately with `sql.sh`: a `201` is proven by the row that now exists,
  a rejection by the row that does not;
- compares against `docs/contract/*.md`, which is the spec. Name the section (`§4.1`) a step proves.

Report each feature you verified with the evidence file names, and each step you could not drive
with the reason.

## Cleanup

```bash
$S/down.sh "$R"
```

Stops this run's API process group (after checking it is still `server.ts`) and removes this
run's container. It never kills by name and refuses any container not named `leetkob-verify-*`.
Evidence, `api.log` and `seed.json` stay in `$R`. Run it after failed attempts too. To find runs
left behind: `docker ps --filter name=leetkob-verify-`, then `down.sh` on the matching
`.verify/<run-id>`.

## Helpers

| Script                  | Invocation                                         |
| ----------------------- | -------------------------------------------------- |
| `scripts/up.sh`         | `R=$($S/up.sh \| tail -1)`                         |
| `scripts/doctor.sh`     | `$S/doctor.sh "$R"`                                |
| `scripts/req.sh`        | `$S/req.sh "$R" <name> <METHOD> <path> [curl ...]` |
| `scripts/sql.sh`        | `$S/sql.sh "$R" <name> "<select ...>"`             |
| `scripts/down.sh`       | `$S/down.sh "$R"`                                  |
| `scripts/prepare-db.js` | run by `up.sh`; not called directly                |

Needs: Docker, Node 22, `npm ci` done, `curl`, `jq`, `ss`, `uuidgen`.
