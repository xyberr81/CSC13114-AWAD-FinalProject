# LeeTKOB API — accounts, classes, labs, results and the review queue — contract, version 1

LeeTKOB · 2026-11-24

This file is the specification of every PA#3 endpoint except `POST /v1/labs/{labId}/submissions`,
which keeps its own contract ([post-lab-submissions.md](post-lab-submissions.md)). Contract tests
named `PA3 §…` check an implementation against it. FAQ numbers refer to the product owners'
[FAQ](https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md).

## 1. Conventions

§1 (ids, timestamps, unknown fields, tokens) and §2 (problem details) of post-lab-submissions.md
apply to every endpoint here. Every endpoint needs a token, except `POST /v1/auth/login`.

Text fields may not contain the character U+0000 or an unpaired surrogate (`\ud800`). Nothing is coerced: `"3"` is not a number.

**Checks, in this order.** The first check that fails decides the response:

1. token → `401 unauthenticated`
2. the caller's role may call this endpoint → otherwise `403 forbidden`
3. the resource in the path exists and belongs to the caller → otherwise `404 not-found`, the same
   response for a missing resource and for someone else's, and for an id that is not a positive
   integer
4. body sent as `application/json` → `415 unsupported-media-type`; not over the size limit →
   `413 payload-too-large`; valid JSON → `400 invalid-json`
5. body and query follow the field rules → otherwise `400 validation`, listing every problem
6. the rules of the endpoint (the 4xx statuses named in its section)

A body is at most 1 MiB, and at most 8 MiB for `POST /v1/classes/{classId}/labs`.

**Roles.** A `ta` may act on a class only as a TA of that class, a `student` only as a student of it.
The role is decided before the resource is looked up, so a `403` tells nothing about it.

Problem types added by this file:

| Slug                  | Status | Title               | When                                                                    |
| --------------------- | -----: | ------------------- | ----------------------------------------------------------------------- |
| `invalid-credentials` |    401 | Invalid credentials | login with an unknown email or a wrong password, the same for both      |
| `email-taken`         |    409 | Email taken         | an account with this email exists                                       |
| `class-code-taken`    |    409 | Class code taken    | a class with this code exists                                           |
| `user-not-eligible`   |    422 | User not eligible   | no account has this email, or its role is not the role asked for (§3.3) |

## 2. Accounts

### 2.1 `POST /v1/auth/login`

Body: `email` (string, 1–254 characters), `password` (string, 1–200 characters). Emails are compared
in lower case. Success is `200`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": "2026-11-25T09:00:00.000Z",
  "user": { "id": 3, "email": "ta@example.test", "role": "ta" }
}
```

`expiresAt` is the `exp` of the token, 8 hours after login.

### 2.2 `GET /v1/me`

Any role. `200` with the caller's `{ id, email, role }`.

### 2.3 `POST /v1/users`

`admin` only (FAQ-01). Body: `email` (an email address, at most 254 characters, stored in lower case),
`password` (8–200 characters), `role` (`admin`, `ta` or `student`). `201` with `{ id, email, role }`;
the password is never returned. An existing email → `409 email-taken`.

## 3. Classes

### 3.1 `POST /v1/classes`

`admin` only. Body: `code` (1–50 characters) and `name` (1–200 characters), each with a character that
is not whitespace. `201` with `{ id, code, name }`. An existing code → `409 class-code-taken`.

### 3.2 `GET /v1/classes`

Any role. `200` with `{ "items": [{ id, code, name }] }`, by id: every class for an admin, the
caller's own classes for a TA or a student.

### 3.3 `POST /v1/classes/{classId}/members`

Body: `email` (string, 1–254 characters) and `role` (`ta` or `student`). An admin adds a TA; a TA of
the class adds a student (FAQ-01). Any other combination → `403 forbidden`:

| Caller               | `role: "ta"` | `role: "student"` |
| -------------------- | ------------ | ----------------- |
| admin                | `200`        | `403`             |
| TA of the class      | `403`        | `200`             |
| TA of another class  | `404`        | `404`             |
| student              | `403`        | `403`             |
| admin, missing class | `404`        | `404`             |

The caller's own rights to the class are checked before the body (checks 2 and 3); whether the caller
may add this `role` is checked after it (check 6). The account must exist and have the role asked
for, otherwise `422 user-not-eligible`. `200` with `{ classId, user: { id, email, role } }`. Adding
the same person again changes nothing and gives the same `200`.

## 4. Labs

### 4.1 `POST /v1/classes/{classId}/labs`

A `ta` of the class; admin and student → `403`; a TA of another class → `404`.

| Field           | Required | Rule                                                                                                |
| --------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `title`         | yes      | 1–200 characters, not only whitespace                                                               |
| `statement`     | yes      | 1–65 536 characters, not only whitespace                                                            |
| `deadline`      | yes      | RFC 3339 date-time with an offset, such as `2026-12-01T15:00:00Z`                                   |
| `timeLimitMs`   | no       | integer, 1000–5000; default 1000 (FAQ-05)                                                           |
| `memoryLimitMb` | no       | integer, 64–512; default 256 (FAQ-05)                                                               |
| `constraints`   | yes      | 1–50 objects `{ code, text, deduction }`; `code` is unique in the lab                               |
| `tests`         | yes      | 1–100 objects `{ input, expectedOutput }`, strings that may be empty. Their order is their position |

In a constraint, `code` has 1–20 characters and `text` has 1–4000, each not only whitespace, and
`deduction` is an integer from 0 to 10 (points out of 10). A repeated `code` is a `validation` problem
at `/constraints/{i}/code` of the second one.

`201` with the Lab (§4.2). The lab, its constraints and its tests are stored together or not at all.

### 4.2 `GET /v1/labs/{labId}`

A TA or a student of the lab's class; another class → `404`; admin → `403`. `200` with the **Lab**:

```json
{
  "id": 7,
  "classId": 2,
  "title": "Sorting with merge sort",
  "statement": "Read `n` integers ...",
  "deadline": "2026-12-01T15:00:00.000Z",
  "timeLimitMs": 1000,
  "memoryLimitMb": 256,
  "constraints": [{ "code": "C1", "text": "Do not call ...", "deduction": 3 }],
  "reviewNotice": "Your code will be reviewed by hard rules and by a model. ..."
}
```

`reviewNotice` says that the code is reviewed by hard rules and a model; that the model gets only the
statement, the constraints and the code without comments, names or student IDs; and that a TA decides
every deduction before marks are published (FAQ-06). Constraints are in the order they were sent.
Tests are never part of this response (FAQ-02).

### 4.3 `GET /v1/classes/{classId}/labs`

A TA or a student of the class; another class → `404`; admin → `403`. `200` with
`{ "items": [{ id, title, deadline }] }`, by id.

## 5. Results for the student

### 5.1 `GET /v1/submissions/{submissionId}`

The student who submitted it; another student → `404`; TA and admin → `403`. `200`:

```json
{
  "id": 41,
  "labId": 7,
  "language": "cpp",
  "status": "wrong_answer",
  "createdAt": "2026-11-11T14:59:00.000Z",
  "tests": [{ "position": 1, "status": "accepted", "timeMs": 12, "memoryKb": 3500 }]
}
```

`status` is `queued`, `judging`, `accepted`, `wrong_answer`, `compile_error`, `time_limit`,
`memory_limit` or `runtime_error`. `tests` is ordered by position and holds only tests with a result.
`timeMs` and `memoryKb` may be `null`. The response contains exactly these fields: no test input or
output (FAQ-02), and no verdict, evidence, constraint or review state (FAQ-08).

## 6. Review for the TA

Verdicts are visible in these two endpoints and nowhere else. Neither changes a mark.

### 6.1 `GET /v1/labs/{labId}/review-queue`

A `ta` of the lab's class. A TA of another class → `404`; student and admin → `403`.

Query: `page` (integer ≥ 1, default 1) and `pageSize` (1–100, default 20), digits only. A bad value is
a `validation` problem whose entry has `parameter` (`page` or `pageSize`) instead of `pointer`; both
are listed if both are bad.

Only the **counted submission** of each student is in the queue: the latest one by time, then by id
(FAQ-02). If that one has no verdicts, for example because it is not Accepted, the student has no
items; an earlier Accepted submission does not replace it.

Items are the verdicts of counted submissions (FAQ-10):

- every `violation` and every `unsure`;
- 10% of the `pass` verdicts, rounded up, chosen by a hash of the submission and constraint ids: the
  choice does not change between requests while the verdicts are the same.

Order: submission id, then constraint id. `200`:

```json
{
  "provisional": true,
  "items": [
    {
      "submissionId": 41,
      "student": { "id": 12, "email": "student@example.test" },
      "submittedAt": "2026-11-11T14:59:00.000Z",
      "constraint": { "code": "C1", "text": "Do not call ...", "deduction": 3 },
      "verdict": "violation",
      "evidence": [{ "line": 12, "text": "std::sort(a.begin(), a.end());" }],
      "source": "hard_rule",
      "unsureReason": null
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

`provisional` is true until the deadline has passed. `unsureReason` is `model_unsure`, `bad_schema`,
`evidence_mismatch`, `timeout`, `cost_limit` or `model_off` for an `unsure` verdict and `null`
otherwise (FAQ-09). `source` is `hard_rule` or `model`. `total` counts all pages. A page past the end
is `200` with no items.

### 6.2 `GET /v1/submissions/{submissionId}/review`

A `ta` of the class of the submission's lab; another class → `404`; student and admin → `403`. A TA
may open any submission, counted or not, sampled or not (FAQ-10). `200` with `submissionId`, `labId`,
`student`, `submittedAt`, `status`, `code` (the full code, FAQ-09) and `verdicts`: every verdict, by
constraint id, each with `constraint`, `verdict`, `evidence`, `source` and `unsureReason` as in §6.1.

## 7. Documentation

`GET /docs` is a Swagger UI of every `/v1` endpoint, with bearer authorization. It needs no token and
is not part of `/v1`.

## 8. Non-goals

Publishing, resolving a verdict, appeals and real-time results are PA#4 and PA#5. So is a rate limit
on login. Invite codes are not offered: FAQ-01 asks for invite codes or a TA who adds students.
