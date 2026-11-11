# LeeTKOB API — `POST /v1/labs/{labId}/submissions` — contract, version 1

LeeTKOB · frozen 2026-11-10

This file is the specification. `test/contract/post-lab-submissions.contract.test.ts` checks an
implementation against it. If the code and this file disagree, the code is wrong. If this file is
wrong, change it in a separate pull request that says why — never quietly, and never in the same
commit as the code.

A student submits C++ code for a lab. The submission is queued for judging in the sandbox (PA#3).
Students submit in the last minutes before a deadline, often on bad connections, so a retried
upload must never create a second submission.

## 1. Conventions

- Every endpoint in this contract lives under `/v1`.
- Requests and responses are JSON, UTF-8.
- Ids are positive integers. Timestamps are ISO 8601 strings in UTC with milliseconds, e.g.
  `2026-11-11T14:59:00.000Z`.
- Clients ignore response fields they do not know. The server ignores request fields it does not
  know.
- **Authentication.** Every request carries `Authorization: Bearer <token>`. The token is a JWT
  signed by LeeTKOB (HS256) whose `sub` is the user's id as a decimal string and which has an
  `exp`. How a token is obtained is not part of this contract. The user's role (`admin`, `ta` or
  `student`) is the one stored for that user, not a claim in the token.

## 2. Errors

Every `/v1` response with a 4xx or 5xx status — including a request for a `/v1` path that does not
exist — is a **problem details** object (RFC 9457), `Content-Type: application/problem+json`:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://leetkob.example/problems/validation",
  "title": "Invalid request",
  "status": 400,
  "detail": "2 fields are invalid",
  "errors": [
    { "pointer": "/language", "detail": "must be equal to one of the allowed values" },
    { "pointer": "/code", "detail": "must NOT have fewer than 1 characters" }
  ]
}
```

| Member   | Rule                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`   | `https://leetkob.example/problems/` followed by a slug from the table below. No other values                                                                 |
| `title`  | the title from the table below                                                                                                                               |
| `status` | a number, equal to the HTTP status of the response                                                                                                           |
| `detail` | one sentence about **this** occurrence. Never a stack trace, an SQL message, a table name, a file path, a secret, or anything about another user's data      |
| `errors` | only on `validation`: one entry **per problem found** (not just the first), each `{ "pointer", "detail" }` — a JSON Pointer into the body, `""` for the body |

| Slug                      | Status | Title                    | When                                                                                                                                    |
| ------------------------- | -----: | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `unauthenticated`         |    401 | Authentication required  | no `Authorization` header, not `Bearer`, a bad signature, an expired token, or a `sub` that is not an existing user                     |
| `forbidden`               |    403 | Forbidden                | the caller's role is not `student`                                                                                                      |
| `not-found`               |    404 | Not found                | `labId` is not a positive integer, no lab has that id, or the student is not enrolled in the lab's class (§4.1 ownership)               |
| `unsupported-media-type`  |    415 | Unsupported media type   | the body is not sent as `application/json`                                                                                              |
| `payload-too-large`       |    413 | Payload too large        | the body is larger than 512 KiB (524 288 bytes)                                                                                         |
| `invalid-json`            |    400 | Malformed JSON           | the body is not valid JSON                                                                                                              |
| `idempotency-key-missing` |    400 | Idempotency-Key required | no `Idempotency-Key` header, or one that is empty, longer than 255 characters, or contains characters outside `!`–`~` (ASCII 0x21–0x7E) |
| `validation`              |    400 | Invalid request          | the body breaks a rule in §4.1                                                                                                          |
| `idempotency-key-reused`  |    422 | Idempotency-Key reused   | this student already used this key for a different lab or a different body (§4.1 idempotency)                                           |
| `lab-closed`              |    409 | Lab closed               | the lab's deadline has passed                                                                                                           |
| `internal`                |    500 | Internal error           | anything else. `detail` is a fixed, generic sentence                                                                                    |

Clients decide what to do from `type`, never from `title` or `detail`.

## 3. Resources

**Submission**

```json
{
  "id": 41,
  "labId": 7,
  "language": "cpp",
  "status": "queued",
  "createdAt": "2026-11-11T14:59:00.000Z"
}
```

- `language` is always `cpp` in version 1 (brief §4: a second language is out of scope).
- `status` is where the submission is in the pipeline. This endpoint only ever returns `queued`.
  Later endpoints (PA#3) will return further values such as `judging`, `accepted`, `rejected`;
  clients must accept a value they do not know and treat it as "not finished yet".
- The submitted `code` is stored but never echoed back by this endpoint.

**Lab** (the parts this endpoint uses)

- Every lab belongs to exactly one class and has a `deadline` (a timestamp).
- A student may submit to a lab only if they are enrolled as a student in that lab's class.

## 4. Endpoints

### 4.1 `POST /v1/labs/{labId}/submissions` — submit code for a lab

**Who may call it**

| Caller                                               | Result                |
| ---------------------------------------------------- | --------------------- |
| a `student` enrolled as a student in the lab's class | allowed               |
| a `student` not enrolled in the lab's class          | `404 not-found`       |
| a `ta` or an `admin` — whatever the lab              | `403 forbidden`       |
| no valid token                                       | `401 unauthenticated` |

Ownership rule: a student only ever submits for themselves (the submission belongs to the user in
the token; there is no field to submit for someone else), and only to labs of their own classes.
For a lab outside their classes the response is **`404`, byte-for-byte the same as for a lab that
does not exist**, so a student cannot discover other classes' labs. The `403` for TAs and admins is
decided from the role alone, before the lab is looked up, so it tells them nothing about the lab
either.

**Request**

```http
POST /v1/labs/7/submissions
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
Content-Type: application/json
Idempotency-Key: 5f0c8a3e-2b1d-4c47-9e0a-6a1f2b3c4d5e

{
  "language": "cpp",
  "code": "#include <iostream>\nint main() { return 0; }\n"
}
```

| Field      | Type   | Required | Rule                                                                                                                |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `language` | string | yes      | exactly `"cpp"`                                                                                                     |
| `code`     | string | yes      | 1 to 65 536 characters, with at least one character that is not whitespace. Never coerced: a number is not a string |

The body must be a JSON object. A missing body is a `validation` problem with pointer `""`.

| Header            | Required | Rule                                                                              |
| ----------------- | -------- | --------------------------------------------------------------------------------- |
| `Authorization`   | yes      | `Bearer <token>` (§1)                                                             |
| `Content-Type`    | yes      | `application/json` (a `charset` parameter is allowed)                             |
| `Idempotency-Key` | yes      | 1–255 characters, each from `!` to `~` (ASCII 0x21–0x7E). A UUID is a good choice |

**Checks, in this order.** The first check that fails decides the response:

1. token → `401 unauthenticated`
2. role is `student` → otherwise `403 forbidden`
3. `labId` is a positive integer, the lab exists, and the student is enrolled in its class →
   otherwise `404 not-found`
4. body sent as `application/json` → otherwise `415 unsupported-media-type`
5. body at most 512 KiB → otherwise `413 payload-too-large`
6. body is valid JSON → otherwise `400 invalid-json`
7. `Idempotency-Key` present and well-formed → otherwise `400 idempotency-key-missing`
8. body follows the field rules above → otherwise `400 validation`, listing **every** problem
9. idempotency (below): a replay returns the stored response; a reused key → `422 idempotency-key-reused`
10. the lab's deadline has not passed (`now ≤ deadline`) → otherwise `409 lab-closed`

**Success**

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "id": 41,
  "labId": 7,
  "language": "cpp",
  "status": "queued",
  "createdAt": "2026-11-11T14:59:00.000Z"
}
```

The body is a Submission (§3). A student may submit to the same lab many times; each request with
a new `Idempotency-Key` creates a new submission. Which submission is reviewed is decided in PA#3
(§6, D3).

**Idempotency**

- Keys are scoped per student: two students may use the same key without affecting each other.
- The same student, the same key, the same `labId` and the same body (`language` and `code` equal;
  key order, whitespace between tokens and unknown fields do not matter) → **`201` with the same
  body as the first response**, plus the header `Idempotent-Replayed: true`. No second submission
  is created. This holds even if the deadline has passed since the first request.
- The same student and the same key with a different `labId` or a different body →
  `422 idempotency-key-reused`. Nothing is created.
- Only a `201` is remembered. If a request fails — for any reason, including `409 lab-closed` — the
  key is not used up, and the client may retry with the same key.
- Requests with the same key that arrive at the same time create exactly one submission; every one
  of them gets the `201` of that submission.
- A key is remembered for at least 24 hours.

**Paging** does not apply: this endpoint creates one resource and returns it.

## 5. Versions and changes

- Within `/v1` only additive changes are made: a new optional request field, a new response
  field, a new `status` value (§3), or a new problem `type` for a situation this contract does not
  cover today. Clients must ignore fields they do not know and must not fail on an unknown
  `status`.
- Anything else — removing or renaming a field, changing a status code, tightening a field rule,
  changing the order of the checks in §4.1 — is a breaking change and ships as
  `/v2/labs/{labId}/submissions`. `/v1` then keeps its own behaviour, errors included, until its
  sunset date, and every `/v1` response carries `Deprecation: @<unix time>`,
  `Sunset: <HTTP date>` (at least 4 weeks later) and
  `Link: </v2/labs/{labId}/submissions>; rel="successor-version"`.
- Every change to this file is its own pull request, says why, and is reviewed by a human before
  any code depends on it.

## 6. Decisions where the brief is silent

| #   | Question                                            | Decision                                                                                             | Source        |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- |
| D1  | Can a student submit after the deadline?            | No: `409 lab-closed`. A replay of a submission accepted before the deadline still returns its `201`. | team decision |
| D2  | 403 or 404 for a lab outside the student's classes? | `404`, identical to a missing lab, so labs of other classes cannot be discovered.                    | team decision |
| D3  | Which of several submissions is reviewed?           | Not decided by this endpoint; every submission is stored. PA#3 will review the latest Accepted one.  | team decision |
| D4  | How large may a submission be?                      | 65 536 characters of code; 512 KiB of body.                                                          | team decision |
| D5  | How does a student get a token?                     | Out of scope for PA#2; a login endpoint comes with accounts in PA#3.                                 | team decision |

## 7. Non-goals

- Judging, compiling or running the code — this endpoint only queues it.
- Rate limiting per student — PA#5, with the load test.
- Uploading several files: one submission is one C++ source file.
- Reading submissions back (`GET /v1/submissions/{id}`) — a separate contract in PA#3.
