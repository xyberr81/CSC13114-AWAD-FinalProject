#!/usr/bin/env bash
# Deploys one version. Run as root on the server: deploy.sh [branch-or-tag], default main.
# With --model-env-on-stdin, the model settings come on standard input and replace
# /etc/leetkob/model.env just before the workers restart (README, "Deployment").
set -euo pipefail

# Prints the three model settings back, one per line, or fails without showing a value.
read_model_env() {
  local names=(LLM_PROVIDER LLM_MODEL LLM_API_KEY) line i=0
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$i" -ge ${#names[@]} ]; then
      echo "model settings: more than ${#names[@]} lines" >&2
      return 1
    fi
    if ! [[ $line =~ ^${names[i]}=[A-Za-z0-9._/:-]+$ ]]; then
      echo "model settings: line $((i + 1)) is not ${names[i]}=<value>" >&2
      return 1
    fi
    printf '%s\n' "$line"
    i=$((i + 1))
  done
  if [ "$i" -ne ${#names[@]} ]; then
    echo "model settings: ${#names[@]} lines expected, $i given" >&2
    return 1
  fi
}

REF=${1:-main}
MODEL_ENV=
case ${2:-} in
  '') ;;
  --model-env-on-stdin) MODEL_ENV=$(read_model_env) ;;
  *) echo "usage: deploy.sh [branch-or-tag] [--model-env-on-stdin]" >&2 && exit 2 ;;
esac
cd /opt/leetkob

git fetch --quiet --tags origin
git checkout --quiet --detach "$(git rev-parse --verify --quiet "origin/$REF" || git rev-parse "$REF")"
echo "deploying $(git log -1 --format='%h %s')"

npm ci
npm run build
npm run sandbox:pull

docker compose -f deploy/compose.yml up -d --wait db
# Migrations run before the new code starts.
(set -a && . /etc/leetkob/worker.env && set +a && npm run db:migrate)
docker compose -f deploy/compose.yml up -d --build --wait api caddy

if [ -n "$MODEL_ENV" ]; then
  # Root only, and replaced whole: a worker never reads half a file.
  tmp=$(mktemp /etc/leetkob/.model.env.XXXXXX)
  printf '%s\n' "$MODEL_ENV" >"$tmp"
  mv "$tmp" /etc/leetkob/model.env
fi
install -m 644 deploy/leetkob-judge.service deploy/leetkob-review.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --quiet leetkob-judge leetkob-review
systemctl restart leetkob-judge leetkob-review

docker image prune -f >/dev/null
sleep 5
systemctl is-active leetkob-judge leetkob-review
docker compose -f deploy/compose.yml ps
