#!/usr/bin/env bash
# Deploys one version. Run as root on the server: deploy.sh [branch-or-tag], default main.
set -euo pipefail

REF=${1:-main}
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

install -m 644 deploy/leetkob-judge.service deploy/leetkob-review.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --quiet leetkob-judge leetkob-review
systemctl restart leetkob-judge leetkob-review

docker image prune -f >/dev/null
sleep 5
systemctl is-active leetkob-judge leetkob-review
docker compose -f deploy/compose.yml ps
