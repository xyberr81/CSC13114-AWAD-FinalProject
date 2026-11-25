# Health

A client or a load balancer asks whether the API is up, and gets a fixed JSON answer without
authentication.

## Sub-features

- `health-ok` answers `200 {"status":"ok"}` with no token.

## How to get to it (user POV)

- `GET /v1/health`.

## Driving it with verify scripts

Preconditions:

- Baseline preconditions from the README.

- **Ask.** Call health without a token. Run `$S/req.sh "$R" health-ok GET /v1/health`. Status
  `200`, `content-type: application/json`, body exactly `{"status":"ok"}`.

## Gotchas

- Health does not touch the database: it passes even when Postgres is gone. Use `doctor.sh` to
  judge the whole instance, not health alone.
