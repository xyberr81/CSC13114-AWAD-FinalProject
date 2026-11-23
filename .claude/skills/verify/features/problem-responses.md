# Problem responses

Every error a client can get from `/v1` is an RFC 9457 problem details object with a stable
`type`, so a client can branch on `type` alone (contract §2).

## Sub-features

- `problem-shape` every 4xx/5xx is `application/problem+json` with `type`, `title`, `status`
  (equal to the HTTP status) and `detail`.
- `problem-unknown-path` a path that does not exist → `404 not-found` as problem+json, not
  Fastify's default JSON.
- `problem-validation-all` `validation` lists every broken field in `errors`, not just the first.
- `problem-no-leak` `detail` never contains a stack trace, SQL, a table name, a file path or a
  secret.

## How to get to it (user POV)

- Any failing request: an unknown route, a wrong method, or a rejected submission.

## Driving it with verify scripts

Preconditions:

- Baseline preconditions from the README, plus the shell variables from
  [submit-code.md](./submit-code.md).

- **Unknown path.** Run `$S/req.sh "$R" problem-unknown GET /v1/nope`. `404`,
  `content-type: application/problem+json`, `type` `https://leetkob.example/problems/not-found`,
  `status` `404`, `detail` naming `GET /v1/nope`.
- **Wrong method.** Run `$S/req.sh "$R" problem-method DELETE /v1/health`. `404` problem+json.
- **Validation lists all.** As the student on `$OPEN`, send `--data '{"language":"java"}'` with a
  fresh key (`problem-validation`). `400`, `type` `.../validation`, `errors` has one entry for
  `/language` and one for `/code`, `detail` `2 fields are invalid`.
- **Shape across the surface.** For every `<name>.status` of 400 or more in `$R/evidence/`, check
  that `<name>.body` has a `type` starting with `https://leetkob.example/problems/`, a `status`
  equal to the code in `<name>.status`, and string `title` and `detail`.
- **No leak.** `grep -ilE 'select |insert |at .*\.ts|/home/|node_modules|postgres' "$R"/evidence/*.body`
  lists no file.

## Gotchas

- `500 internal` cannot be reached from the seed without breaking the server, and the journey must
  not break it on purpose. The unit test `internal-error.test.ts` covers it; report it as not
  driven here.
- A wrong method on an existing path answers `404`, not `405`: Fastify routes by method and path,
  and the contract does not define `405`.
