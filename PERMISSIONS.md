# Assistant permissions

Tool: Claude Code. Enforced in [`.claude/settings.json`](.claude/settings.json) (committed); this
file explains it. Deny wins over ask, ask wins over allow. Anything in no list asks.

## Allowed — without asking

- Read any file in the repository, except `.env` files (only `.env.example` is readable).
- Edit `src/`, `test/unit/`, `README.md`, `AI-LOG.md`.
- Run the checks: `npm run lint`, `format`, `format:check`, `typecheck`, `test`, `test:contract`,
  `check`, `build`, `db:generate`.
- Read-only git: `status`, `diff`, `log`, `show`, `blame`, `rev-parse`, `merge-base`,
  `remote -v`, list branches.
- Local git: create or switch a branch; `fetch`, `pull`, `stash`; `add`; `commit` on a branch.
- `git push` of a feature branch.
- Read-only `gh pr`: `view`, `list`, `checks`, `diff`, `status`.
- The local database: `docker compose up -d db`, `ps`, `logs`, `stop`, and `npm run db:migrate`
  against it.
- `curl` to the dev server on `localhost:3000` / `127.0.0.1:3000`.

## Ask first — a human approves each time

- Edit `docs/contract/` or `test/contract/` (the spec and the tests that judge the code).
- Edit `.github/workflows/`, `package.json`, `drizzle/`, `CLAUDE.md`, `PERMISSIONS.md`,
  `.claude/settings.json`.
- Install, remove or upgrade a dependency.
- Any other `docker` command, `curl` to any other host, or fetching a web page.
- `gh pr` `create`, `comment`, `edit`, `merge`, `close`.

## Never — denied in the settings

- Read or edit `.env`, `.env.local`, `.env.production`, anything under `~/.ssh`.
- Edit eval data or labels (`eval/`).
- `git push --force` / `-f`, `git push` to `main`, delete a branch or a tag. `main` is also
  protected on GitHub (ruleset `main`).
- `docker compose config` (it prints the values it reads from `.env`).
- `gh api` (it can change repository settings such as branch protection).
- `sudo`, `rm -rf`.

## Secrets

- `.env` is git-ignored; [`.env.example`](.env.example) lists every variable, without values.
- CI needs no stored secret: its database is a throw-away service container with no password,
  and `JWT_SECRET` is generated for each run.
- History scan: `gitleaks` over the full history before submitting — see `PA2.md`.
- The model API key is an OpenRouter key with a $2 credit limit set on the key itself, recorded
  in README §Model and cost. It lives only in `.env`, which the assistant may not read.
