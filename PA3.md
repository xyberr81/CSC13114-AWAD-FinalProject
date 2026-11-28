# PA#3 — what to run

Team: 23120024 — Nguyễn Thanh Bình · 23120046 — Hồ Thùy Hương · 23120061 — Nguyễn Thị Ánh Ngọc

Rows marked **TODO** are filled in before the `pa3` tag, from the real run.

## 1. Deployment

URL: <https://leetkob-awad.centralindia.cloudapp.azure.com> · API documentation: `/docs`

Test accounts. They hold no real data.

| Role    | Email    | Password | Class   |
| ------- | -------- | -------- | ------- |
| admin   | **TODO** | **TODO** | —       |
| TA 1    | **TODO** | **TODO** | class 1 |
| TA 2    | **TODO** | **TODO** | class 2 |
| student | **TODO** | **TODO** | class 1 |
| student | **TODO** | **TODO** | class 1 |

Walk-through of criterion 1, in Swagger UI:

1. `POST /v1/auth/login` as TA 1, then **Authorize** with the token. `GET /v1/classes` gives the class id.
2. `POST /v1/classes/{classId}/labs` with the statement, tests and constraints of `sort-merge`.
3. Log in as a student. `GET /v1/labs/{labId}` shows the constraints, the deductions and the notice.
4. `POST /v1/labs/{labId}/submissions` for a compliant, a violating and an injection solution. Only the
   last submission of a student is in the review queue (FAQ-02), so use one student per solution, or
   open the earlier ones with `GET /v1/submissions/{submissionId}/review`.
5. `GET /v1/submissions/{submissionId}` goes from `queued` to a result, with no verdict in it (FAQ-08).
6. Log in as TA 1. `GET /v1/labs/{labId}/review-queue` shows verdicts, evidence and deductions. Log in
   as TA 2: the lab and its queue are `404`.

## 2. CI run of the `pa3` tag, with the sandbox tests

**TODO**

## 3. Checker

Command (model on, needs `LLM_PROVIDER`, `LLM_MODEL` and `LLM_API_KEY` in `.env`):

```bash
npm run checker -- eval/leetkob-eval --out predictions.jsonl --calls calls.jsonl
```

Docker build line, and the run with the model off (`MODEL_OFF=1`), without network or key:

```bash
docker build -t leetkob-checker -f Dockerfile.checker .
docker run --rm --network none -e MODEL_OFF=1 -v "$PWD/eval/leetkob-eval:/data:ro" \
  leetkob-checker /data > predictions.jsonl
node eval/leetkob-eval/eval.mjs --data eval/leetkob-eval --predictions predictions.jsonl
```

Expected with the model off: 102 lines, 0 wrongful deductions, `eval.mjs` exits with 1. Options and
exit codes: README §Checker.

Own cases: `eval/own-cases/`.

## 4. Real-model run on the dev set

Model `claude-haiku-5-5` at Anthropic, 2026-11-28: the last row. Each folder has
`predictions.jsonl`, the `eval.mjs` report (`eval.txt`, `eval.json`), the call log with the
provider's request ids (`calls.jsonl`), `cost.txt` and the commit it ran (`run.txt`).

| Folder in `eval/runs/`                         | Commit    | Wrongful | Recall         | Unsure         |
| ---------------------------------------------- | --------- | -------: | -------------- | -------------- |
| `2026-11-26-deepseek-v4-flash-0731`            | `25b065d` |        0 | 78.4% (29/37)  | 22.5% (23/102) |
| `2026-11-26-deepseek-v4-flash-0731-schema-fix` | `8a7f449` |        0 | 94.6% (35/37)  | 2.0% (2/102)   |
| `2026-11-28-claude-haiku-5-5`                  | `dc1977b` |        0 | 100.0% (37/37) | 0.0% (0/102)   |

The first two rows are the earlier model, `deepseek/deepseek-v4-flash-0731` through OpenRouter,
before and after the schema fix (README §Checker). Cost of a lab of 80, from the last run:
80 × 1.00 × $0.000235 = $0.019 (README §Model and cost).

## 5. Recording

**TODO**
