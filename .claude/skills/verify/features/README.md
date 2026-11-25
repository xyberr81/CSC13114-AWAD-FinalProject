# LeeTKOB verification map

The maintained source for verifying LeeTKOB's user-facing behaviour. Read this index, then use the
matching feature file as the recipe. Harness: the scripts in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- A run started with `R=$(.claude/skills/verify/scripts/up.sh | tail -1)`, from the repo root.
- `.claude/skills/verify/scripts/doctor.sh "$R"` exits 0.
- The seed in `$R/seed.json` is untouched apart from what earlier steps of the same journey did.
- Never drive an instance this run did not start.

## Driving conventions

- `S=.claude/skills/verify/scripts`. Every request goes through `$S/req.sh`, every side-effect
  check through `$S/sql.sh`, so each step leaves an evidence file.
- Name evidence `<feature-id>-<step>` (for example `submit-create-201`).
- Use a fresh `$(uuidgen)` as `Idempotency-Key` unless the step is about reusing one.
- The contract in `docs/contract/` is the spec. Each step names the section it proves.

## Proof and skip reporting

- Proof is the saved request and response plus a `sql.sh` read of the rows it should (or should
  not) have written.
- Report each sub-feature as verified (with evidence names), failed (with expected vs actual), or
  not driven (with the missing precondition). A skipped sub-feature is never reported as verified
  through another one.

## Feature entry contract

Each feature file has an H1 title and one paragraph, then four H2s in order: `Sub-features`,
`How to get to it (user POV)`, `Driving it with verify scripts` (starting with `Preconditions:`),
and `Gotchas`. Keep implementation detail out; name routes, headers, seed keys and observable
results.

## Features

- [Health](./health.md): the liveness endpoint.
- [Submit code for a lab](./submit-code.md): `POST /v1/labs/{labId}/submissions`, who may call
  it, body checks and the deadline (contract §4.1).
- [Submission idempotency](./submit-idempotency.md): replays, reused keys, failed requests that
  leave the key free, and concurrent retries (contract §4.1 Idempotency).
- [Problem responses](./problem-responses.md): every 4xx/5xx is `application/problem+json` with
  the contract's shape, including unknown paths (contract §2).

## Not built yet (PA#3 stubs)

These routes are registered as empty plugins and answer `404 not-found`. Add a feature file when
each one lands; until then they cannot be verified.

- `POST /v1/auth/login`
- admin: classes, accounts, TA assignment; TA adds students (FAQ-01)
- labs: a TA creates a lab with tests and constraints; a student views it (FAQ-06)
- a student's submission result: status and per-test results (FAQ-02, FAQ-08)
- `GET /v1/labs/{labId}/review-queue` for the lab's TA (FAQ-09, FAQ-10)
- the judge worker (pg-boss), the `gcc` sandbox and tree-sitter hard rules
