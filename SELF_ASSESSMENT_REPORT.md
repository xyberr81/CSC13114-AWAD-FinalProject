# Self-assessment — PA#2

Submitted by:

- 23120024 — Nguyễn Thanh Bình
- 23120046 — Hồ Thùy Hương
- 23120061 — Nguyễn Thị Ánh Ngọc

Total we claim: 93 / 100

| Criterion                            | Max | We claim | Evidence                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | --: | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules file                           |  15 |       14 | `CLAUDE.md`: Stack, Commands, Conventions, Never, 58 lines. The Never list is about LeeTKOB (no secret in the sandbox, no real model in unit tests, never edit a test / the contract / eval data / a label). Five lines marked _(story)_, each traced to an AI-LOG entry (TypeScript pin, Ajv `allErrors`, `coerceTypes` off, no early `return` in a test, no force-push) |
| Permissions and secrets              |  10 |        8 | `PERMISSIONS.md` + `.claude/settings.json`: allow / ask / deny. `.env.example` lists every variable without values; `.env` ignored. CI holds no secret. PA2.md §Secrets: gitleaks over the full history. Minus 2: no model API key with a spending cap yet (README §Model and cost)                                                                                       |
| One command for every check          |  10 |       10 | README §Checks = `CLAUDE.md` §Commands = `.github/workflows/ci.yml` steps: `npm run lint`, `format:check`, `typecheck`, `npm test`, `npm run test:contract`. CI run on tag `pa2` (PA2.md)                                                                                                                                                                                 |
| CI that blocks a merge               |  20 |       19 | Ruleset `main` (docs/evidence/main-ruleset.png): `checks` required, review required, empty bypass list. PR #2 blocked at `fc96110` (run 42984921531, docs/evidence/pr2-blocked.png), green at `8ff2e8d` (run 42985360745). Minus 1: the first protection had no required check (PA2.md §The gate)                                                                         |
| The contract of one LeeTKOB endpoint |  25 |       23 | `docs/contract/post-lab-submissions.md`: role `student` + ownership (enrolled in the lab's class, otherwise 404 like a missing lab), field rules, 11 problem types with status, check order, idempotency (scope, fingerprint, replay, 422 on reuse), §5 versions and changes, §6 decisions D1–D5                                                                          |
| Contract tests that bite             |  15 |       14 | `test/contract/post-lab-submissions.contract.test.ts`: 50 tests named after contract sections — every problem type, `§4.1 ownership` (3 tests), idempotency incl. 8 concurrent requests. Run in the required `checks`. Deliberate break: PR #3 / `e015564` (run 43017569428), red on exactly the 3 ownership tests, no test changed                                       |
| AI-LOG.md                            |   5 |        5 | `AI-LOG.md`: tool per part, and real Changed / Rejected entries — e.g. the contract test that could never fail (early `return`), the required check that was off                                                                                                                                                                                                          |

## What we did not manage

- No model API key yet, so there is no spending cap to show; the README says it will be set before
  the key is created in PA#3.
- The gate was not really closed until 2026-11-11: the first branch protection had no required
  status check, and we only noticed when checking the rubric.
- We did not compare our contract section by section with `CONTRACT.md` from IA#3 again after
  freezing it.
- Nobody re-ran the README from a fresh clone on a second machine; the evidence for a clean run is
  CI.

## What we would do differently

Turn on the required check before writing any code, and open the red pull request straight away:
the gate is the first thing to prove, not the last.
