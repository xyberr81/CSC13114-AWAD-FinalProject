# Submit code for a lab

A student sends C++ code for a lab of their class and gets back a queued Submission. Everyone else
is turned away in a fixed order that never reveals another class's labs (contract §4.1).

## Sub-features

- `submit-create` an enrolled student gets `201` with a queued Submission, and one row is stored.
- `submit-auth` no token, an expired token, or a token for a missing user → `401 unauthenticated`.
- `submit-role` a TA or admin → `403 forbidden`, whatever the lab.
- `submit-ownership` a lab of another class, a missing lab, or a non-integer `labId` →
  `404 not-found`, with byte-identical bodies for the first two.
- `submit-body` wrong content type `415`, body over 512 KiB `413`, broken JSON `400 invalid-json`,
  missing key `400 idempotency-key-missing`, bad fields `400 validation` listing every field.
- `submit-closed` a lab past its deadline → `409 lab-closed`, nothing stored.

## How to get to it (user POV)

- `POST /v1/labs/{labId}/submissions` with `Authorization: Bearer <token>`,
  `Content-Type: application/json`, `Idempotency-Key: <key>` and
  `{"language":"cpp","code":"..."}`. There is no other entry point yet (no web UI).

## Driving it with verify scripts

Preconditions:

- Baseline preconditions from the README.
- Shell variables: `ST=$(jq -r .tokens.student "$R/seed.json")`,
  `OPEN=$(jq -r .labs.openLab "$R/seed.json")`, `CLOSED=$(jq -r .labs.closedLab "$R/seed.json")`,
  `OTHER=$(jq -r .labs.otherClassLab "$R/seed.json")`,
  `J=(-H 'content-type: application/json')`, `CODE='{"language":"cpp","code":"int main() { return 0; }\n"}'`.

- **Create.** Submit to the open lab. Run `$S/req.sh "$R" submit-create-201 POST
"/v1/labs/$OPEN/submissions" -H "authorization: Bearer $ST" "${J[@]}" -H "idempotency-key:
$(uuidgen)" --data "$CODE"`. `201`, body `{id, labId: OPEN, language: "cpp", status: "queued",
createdAt}` with no `code`, no `Idempotent-Replayed` header.
- **Create stored.** Run `$S/sql.sh "$R" submit-create-row "select id, lab_id, student_id,
status, code from submissions order by id"`. Exactly one new row, `student_id` = `users.student`,
  status `queued`, the code as sent.
- **Auth.** Repeat the create call with no `authorization` header (`submit-auth-none`), with
  `$(jq -r .tokens.expiredStudent "$R/seed.json")` (`submit-auth-expired`), and with
  `Basic abc` (`submit-auth-scheme`). Each: `401`, type `.../problems/unauthenticated`.
- **Role.** Repeat with `tokens.ta` and with `tokens.admin`, against `$OPEN` and against
  `999999` (`submit-role-ta`, `submit-role-admin`, `submit-role-ta-missing-lab`). Each: `403`
  `forbidden`, the same body whether or not the lab exists.
- **Ownership.** As the student, submit to `$OTHER` (`submit-ownership-other`) and to `999999`
  (`submit-ownership-missing`). Both `404 not-found`, and
  `cmp "$R"/evidence/submit-ownership-{other,missing}.body` finds no difference. Also `/v1/labs/abc/submissions` and
  `/v1/labs/0/submissions` → `404`.
- **Body.** As the student on `$OPEN`, each with a fresh key: `-H 'content-type: text/plain'`
  → `415`; `--data-binary @<(head -c 600000 /dev/zero | tr '\0' a)` → `413`; `--data '{"language":'`
  → `400 invalid-json`; no `idempotency-key` header → `400 idempotency-key-missing`;
  `--data '{"language":"java","code":""}'` → `400 validation` whose `errors` pointers are
  `/language`, `/code`, `/code` (an empty `code` breaks both the length and the non-blank rule); `--data '{"language":"cpp","code":12345}'` → `400 validation`
  (never coerced to a string).
- **Closed.** As the student, submit to `$CLOSED` (`submit-closed-409`). `409 lab-closed`.
- **Nothing extra stored.** Run `$S/sql.sh "$R" submit-final-rows "select count(*) from
submissions"`. Only the rows from the create steps exist.

## Gotchas

- The checks run in the contract's order (§4.1, 1–10): a request with two faults answers for the
  first one. A TA with a broken body still gets `403`. Fix one thing per step.
- Ownership `404` and missing-lab `404` must match byte for byte. Compare bodies, not just status.
- `413` needs a body over 524 288 bytes **and** a JSON content type; otherwise `415` wins.
- `curl --data` strips newlines from `@file` input; use `--data-binary` for real files.
- The seed's closed lab closed an hour before launch. To prove "open, then closed" for one lab you
  would have to move a deadline in the database, which the journey must not do: report it as not
  driven instead.
