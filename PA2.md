# PA#2 — Harness and quality gate: evidence

Team: 23120024 — Nguyễn Thanh Bình · 23120046 — Hồ Thùy Hương · 23120061 — Nguyễn Thị Ánh Ngọc

Submitted commit: tag [`pa2`](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/tree/pa2).
Self-assessment: [`SELF_ASSESSMENT_REPORT.md`](SELF_ASSESSMENT_REPORT.md).

## Links

| What                       | Link                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository (public)        | https://github.com/xyberr81/CSC13114-AWAD-FinalProject                                                                                                                                                                                                                                                                                                   |
| Protected-branch settings  | ruleset `main`: [screenshot](docs/evidence/main-ruleset.png) · [ruleset](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/rules/27014878)                                                                                                                                                                                                          |
| Blocked PR                 | [#2](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/pull/2) at `fc96110`: [red run](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/actions/runs/42984921531) (contract tests 43 of 50 failing) · [screenshot: merging is blocked](docs/evidence/pr2-blocked.png)                                                                         |
| PR that turned green       | [#2](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/pull/2), commit [`8ff2e8d`](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/commit/8ff2e8d17e87417a7408a018e48704b94d891871): [green run](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/actions/runs/42985360745) (unit 23/23, contract 50/50)                               |
| CI run for the tag         | [CI runs for `pa2`](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/actions/workflows/ci.yml?query=branch%3Apa2)                                                                                                                                                                                                                                  |
| Deliberate contract break  | [#3](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/pull/3), commit [`e015564`](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/commit/e015564cb517610626b240062726918a892d73da): [red run](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/actions/runs/43017569428) (contract tests 3 of 50 failing, all three `§4.1 ownership`) |
| Pushes to `main` (history) | [activity of `main`](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/activity?ref=main)                                                                                                                                                                                                                                                           |

## The gate

- `main` is protected by the repository ruleset `main` (active, empty bypass list): a pull request
  with 1 approving review, the status check **`checks`** (GitHub Actions) required, no force-push,
  no deletion. The repository allows merge commits only, so the commit ids cited here stay in
  `main`'s history.
- `checks` is the one job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). It runs on
  every pull request, on `main` and on `pa*` tags, one step per check, with the same commands as
  the README: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
  `npm run test:contract`. No `|| true`, no `continue-on-error`.
- Timeline of `main`:
  - 2026-11-10 15:29 (+07): last push straight to `main` — a force-push by a team member that
    removed an attribution trailer from the scaffold commit (AI-LOG, "scaffold"). Protection was
    not on yet.
  - Later, before 2026-11-11: classic branch protection turned on, but with **no required status check**
    (`enforcement_level: off`). We found this while checking the rubric (AI-LOG, "the gate").
  - 2026-11-11 14:56 (+07): ruleset `main` created with `checks` required. Since then `main` has
    changed only by merging pull requests: #1 (contract, merged 15:10), #2 (merged 16:09), [#4](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/pull/4) (this file).

## How the gate bit

1. **The contract first, alone** — [#1](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/pull/1)
   adds [`docs/contract/post-lab-submissions.md`](docs/contract/post-lab-submissions.md) and
   nothing else.
2. **Tests before code, red** — #2 starts with `fc96110`: 50 contract tests written from the
   contract, no route yet. `checks` failed on the contract-tests step; GitHub showed "All checks
   have failed · Merging is blocked" ([screenshot](docs/evidence/pr2-blocked.png)).
3. **Green without touching the tests** — `8ff2e8d` changes only `src/app.ts` and
   `src/routes/submissions.ts`. `checks` passed, and #2 was merged after review.
4. **A deliberate break** — [#3](https://github.com/xyberr81/CSC13114-AWAD-FinalProject/pull/3) (`e015564`, branch `break/ownership-check`) drops the
   enrolment check of contract §4.1, so any student could submit to any lab. No test is changed.
   `checks` went red on the three `§4.1 ownership` contract tests. The PR was closed, not merged.

## Secrets

- `.env` is git-ignored; [`.env.example`](.env.example) lists every variable without values.
- CI stores no secret: the database is a password-less throw-away service container, and
  `JWT_SECRET` is generated for each run.
- History scan, 2026-11-11, gitleaks v8.21.2 on a `--mirror` clone (every branch, every commit):

  ```bash
  git clone --mirror https://github.com/xyberr81/CSC13114-AWAD-FinalProject scan
  docker run --rm -v "$PWD/scan:/repo" -v "$PWD/.gitleaksignore:/ignore/.gitleaksignore" \
    ghcr.io/gitleaks/gitleaks:v8.21.2 git --log-opts="--all" \
    --gitleaks-ignore-path /ignore/.gitleaksignore --redact /repo
  # 9 commits scanned … no leaks found (run at 1a78f0d)
  ```

  Without the ignore file it reports exactly one finding, the one listed in
  [`.gitleaksignore`](.gitleaksignore): a made-up example `Idempotency-Key` in the contract
  (`b6d2176`, line 123), not a secret.

- Model API key: an OpenRouter key with a **$2 credit limit** on the key, created 2026-11-11
  ([screenshot](docs/evidence/openrouter-key-cap.png), README §Model and cost). It is only in
  members' local `.env` files; CI does not have it.

## Rerunning the checks

Follow [README §Getting started](README.md#getting-started), then `npm run check` (or each command
from [README §Checks](README.md#checks)).

Checked on 2026-11-11 from a fresh clone on Windows 11 (Node 24, Docker Desktop): lint, format
check, type check, unit tests 23/23, contract tests 50/50. That run found one problem, fixed by
[`.gitattributes`](.gitattributes): without it, Git for Windows checks files out with CRLF and
`npm run format:check` fails on files that CI passes.

Checked again on 2026-11-11 from a fresh clone of `docs/pa2` on Linux (Node 26, Docker), following
the README step by step: lint, format check, type check, build, unit tests 23/23, contract tests
50/50.
