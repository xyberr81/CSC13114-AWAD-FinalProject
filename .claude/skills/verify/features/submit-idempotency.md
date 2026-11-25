# Submission idempotency

A student whose network drops can resend the same submission with the same `Idempotency-Key` and
get the original answer back instead of a duplicate. Reusing a key for different content is
refused (contract §4.1 Idempotency).

## Sub-features

- `idem-replay` same student, key, lab and body → `201`, the first response's body, header
  `Idempotent-Replayed: true`, no new row.
- `idem-equivalent-body` key order, whitespace and unknown fields do not make a body different.
- `idem-reused` same key with a different body or a different lab → `422 idempotency-key-reused`,
  nothing created.
- `idem-failed-frees-key` a request that fails (for example `409 lab-closed`) does not use up the
  key.
- `idem-per-student` two students may use the same key independently.
- `idem-concurrent` simultaneous requests with one key create exactly one submission, and all get
  its `201`.

## How to get to it (user POV)

- Resend `POST /v1/labs/{labId}/submissions` with an `Idempotency-Key` used before.

## Driving it with verify scripts

Preconditions:

- Baseline preconditions from the README, plus the shell variables from
  [submit-code.md](./submit-code.md), and `OT=$(jq -r .tokens.outsider "$R/seed.json")`.

- **First.** `K=idem-$(uuidgen)`. Submit `$CODE` to `$OPEN` with key `$K` (`idem-first`). `201`.
- **Replay.** Send the identical request again (`idem-replay`). `201`, same `id` and `createdAt`
  as `idem-first`, header `idempotent-replayed: true`.
- **Equivalent body.** Send `{"code":"int main() { return 0; }\n", "language":"cpp", "x":1}` with
  `$K` (`idem-equivalent`). `201` replay of the same `id`.
- **Reused.** With `$K`, send a different `code` (`idem-reused-body`) and the original body to
  `$CLOSED` (`idem-reused-lab`). Both `422 idempotency-key-reused`.
- **Rows.** Run `$S/sql.sh "$R" idem-rows "select id, lab_id, student_id from submissions order by
id"`. One row for `$K`, nothing from the replay or the 422s.
- **Failed frees the key.** `K2=idem-$(uuidgen)`. Submit to `$CLOSED` with `$K2` (`idem-closed`):
  `409`. Then submit `$CODE` to `$OPEN` with `$K2` (`idem-after-409`): `201`, a new `id`.
- **Per student.** Submit `$CODE` to `$OTHER` as the outsider (`$OT`) with `$K`
  (`idem-per-student`). `201`, a new `id` belonging to `users.outsider`.
- **Concurrent.** `K3=idem-$(uuidgen)`; run ten copies at once:
  `seq 10 | xargs -P10 -I{} $S/req.sh "$R" idem-concurrent-{} POST "/v1/labs/$OPEN/submissions"
-H "authorization: Bearer $ST" "${J[@]}" -H "idempotency-key: $K3" --data "$CODE"`
  (spell out the `-H` flags; `xargs` does not expand the array). All ten `201` with one `id`; then
  `sql.sh` shows exactly one row for it.

## Gotchas

- Replays are compared on the parsed body, so `"x":1` and reordered keys still replay; a change
  inside `code`, even one space, is a different body.
- "Replay after the deadline passed" (§4.1) needs a lab whose deadline moves between the first
  request and the replay. The seed has no such lab and the journey must not edit deadlines: report
  that sub-case as not driven.
- Use a new key per journey: keys persist for the whole run, so a key from an earlier step makes a
  later "first" request a replay.
