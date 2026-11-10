# Assistant permissions

Tool: Claude Code. Enforced in [`.claude/settings.json`](.claude/settings.json) (committed); this
file explains it. Deny wins over ask, ask wins over allow.

## Allowed — without asking

- Read any file in the repository, except `.env` files (only `.env.example` is readable).
- Edit `src/`, `test/unit/`, `README.md`, `AI-LOG.md`.
- Run the checks: `npm run lint`, `format`, `format:check`, `typecheck`, `test`, `test:contract`,
  `check`, `build`, `db:generate`.
- Read-only git: `status`, `diff`, `log`, `show`; create a branch; `add`; `commit` on a branch.

## Ask first — a human approves each time

- Edit `docs/contract/` or `test/contract/` (the spec and the tests that judge the code).
- Edit `.github/workflows/`, `package.json`, `drizzle/`, `CLAUDE.md`, `PERMISSIONS.md`,
  `.claude/settings.json`.
- Install, remove or upgrade a dependency.
- Run `npm run db:migrate`, any `docker` command, `curl`, or fetch a web page.
- `git push`, `gh pr` (open, comment, merge).

## Never — denied in the settings

- Read or edit `.env`, `.env.local`, `.env.production`, anything under `~/.ssh`.
- Edit eval data or labels (`eval/`).
- `git push --force` / `-f`, `git push` to `main`, delete a branch or a tag.
- `gh api` (it can change repository settings such as branch protection).
- `sudo`, `rm -rf`.

## Secrets

- `.env` is git-ignored; [`.env.example`](.env.example) lists every variable, without values.
- CI needs no stored secret: its database is a throw-away service container with no password,
  and `JWT_SECRET` is generated for each run.
- History scan: `gitleaks` over the full history before submitting — see `PA2.md`.
- The model API key does not exist yet (PA#3). It will have a spending cap set in the provider's
  console before first use, recorded in the README.
