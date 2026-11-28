# Assistant permissions

Tool: Claude Code. Enforced in [`.claude/settings.json`](.claude/settings.json) (committed); this
file explains it. Deny wins over ask, ask wins over allow. Anything in no list asks.

## Allowed — without asking

The project uses the [pstack](https://github.com/michael-denyer/pstack-claude) skills, which run
subagents in git worktrees, run single tests and open PRs. The allow list is wide enough for that
to run without prompts; the ask and deny lists keep the spec, the judges of the code, the
dependencies, the database history and `main` under a human.

- Read any file in the repository, except `.env` files (only `.env.example` is readable).
- Edit code, docs and config: `apps/`, `docs/`, top-level `*.md`, `*.js`, `*.ts`, `*.json`, the
  ignore and Prettier files, `.env.example`, `.claude/skills/`. The ask list below wins over this.
- Run any `npm run` script and `npm test` (with arguments, e.g. one test file), and `npx vitest`,
  `eslint`, `prettier`, `tsc`, `drizzle-kit generate`.
- Git: read (`status`, `diff`, `log`, `show`, `blame`, `grep`, `ls-files`, `rev-parse`,
  `merge-base`, `patch-id`, `ls-remote`, `remote -v`, list branches); `switch`, `fetch`, `pull`,
  `stash`, `add`, `commit`; `push` of a feature branch; `worktree list`, `add`, `prune`.
- GitHub: `gh pr view`, `list`, `checks`, `diff`, `status`, `create`, `edit`, `ready`, `comment`;
  `gh run view`, `list`, `watch`.
- `docker`, except the commands denied below. `curl` to the dev server on `localhost:3000` /
  `127.0.0.1:3000`. `jq`, `tail`, `uuidgen`.
- The verify skill's scripts in `.claude/skills/verify/scripts/`: `up.sh`, `doctor.sh`, `req.sh`,
  `sql.sh`, `down.sh`. They start a throw-away Postgres container and API without reading `.env`,
  call only that API, run read-only queries (`sql.sh`), and remove only `leetkob-verify-*`
  containers.
- Web search, and fetching pages from the stack's documentation sites (GitHub, Fastify, Drizzle,
  Vitest, Node.js, PostgreSQL, MDN, TypeScript, Ajv, Docker, Claude Code).
- Per machine, in the git-ignored `.claude/settings.local.json`: `node` on the pstack plugin's own
  scripts, whose path includes the home directory.

## Ask first — a human approves each time

- Edit `docs/contract/` or `apps/api/test/contract/` (the spec and the tests that judge the code).
- Edit `.github/workflows/`, `package.json` (any), `package-lock.json`, `apps/api/drizzle/`.
- Edit `CLAUDE.md`, `PERMISSIONS.md`, `SELF_ASSESSMENT_REPORT.md`, `.claude/settings.json`, and the
  verify scripts (they run without asking, so changing them asks).
- Install, remove or upgrade a dependency (`npm install`, `i`, `ci`, `uninstall`, `update`).
- Git that rewrites or discards work: `rebase`, `reset`, `restore`, `checkout`, `clean`, `merge`,
  `branch -d`, `worktree remove`.
- `gh pr merge`, `gh pr close`.
- Fetching any other web page; `curl` to any other host or port.

## Never — denied in the settings

- Read or edit `.env`, `.env.local`, `.env.production`, anything under `~/.ssh`.
- Edit the published dev set (`eval/leetkob-eval/`) or a committed run (`eval/runs/`).
- `git push --force` / `-f` / `--force-with-lease`, `git push` to `main`, delete a remote branch or
  a tag, `git branch -D`. `main` is also protected on GitHub.
- `docker compose config`, `docker inspect`, and `env` / `printenv` through `docker exec`: they
  print container environments, which hold the values from `.env`.
- `docker compose down -v`, `docker volume rm` / `prune`, `docker system prune`: they delete the
  local database's data.
- `gh api` (it can change repository settings such as branch protection).
- `sudo`, `rm -rf`.

## Plugins

- [pstack](https://github.com/michael-denyer/pstack-claude) (`pstack@pstack-claude`) is enabled for
  the project; Claude Code offers to install it on first trust of the folder. Its skills run
  under the same allow / ask / deny rules above.

## Secrets

- `.env` is git-ignored; [`.env.example`](.env.example) lists every variable, without values.
- CI needs no stored secret: its database is a throw-away service container with no password,
  and `JWT_SECRET` is generated for each run.
- History scan: `gitleaks` over the full history before submitting — see `PA2.md`.
- The model API key is a Claude Console API key. Its workspace has a spend limit of $50 a
  month (README §Model and cost). It lives only in `.env`, which the assistant may not read.
