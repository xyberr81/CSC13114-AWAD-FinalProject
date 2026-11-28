#!/usr/bin/env bash
# Read-only: is this verify instance worth driving? Exit 0 only if every check passes.
#
#   doctor.sh <run-dir>
set -uo pipefail
[ $# -eq 1 ] || {
  echo "usage: doctor.sh <run-dir>" >&2
  exit 2
}
DIR=$1
# shellcheck disable=SC1091
. "$DIR/env" || exit 1
cd "$(git rev-parse --show-toplevel)"
bad=0
ok() { echo "ok    $1"; }
no() {
  echo "FAIL  $1"
  bad=1
}

if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = true ]; then
  ok "postgres container $CONTAINER running on 127.0.0.1:$PG_PORT"
else
  no "postgres container $CONTAINER is not running"
fi

want=$(jq '.entries | length' apps/api/drizzle/meta/_journal.json)
have=$(docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -d leetkob -tAc \
  'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null)
if [ "$have" = "$want" ]; then ok "migrations applied: $have of $want"; else no "migrations applied: ${have:-?} of $want"; fi

if [ -n "${API_PGID:-}" ] && tr '\0' ' ' <"/proc/$API_PGID/cmdline" 2>/dev/null | grep -q 'apps/api/src/server.ts'; then
  ok "api process $API_PGID is ours (apps/api/src/server.ts)"
else
  no "api process ${API_PGID:-?} is gone or is not this run's server"
fi

owner=$(ss -ltnpH "sport = :$API_PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
if [ -n "$owner" ] && [ "$(ps -o pgid= -p "$owner" | tr -d ' ')" = "$API_PGID" ]; then
  ok "port $API_PORT is held by our process group"
else
  no "port $API_PORT is not held by process group ${API_PGID:-?}"
fi

health=$(curl -s --max-time 3 "$BASE_URL/v1/health")
if [ "$health" = '{"status":"ok"}' ]; then ok "GET /v1/health → $health"; else no "GET /v1/health → ${health:-no answer}"; fi

if [ "$(git rev-parse HEAD)" = "$GIT_HEAD" ] &&
  [ "$(git status --porcelain -- apps | sha1sum | cut -c1-12)" = "$GIT_TREE" ]; then
  ok "running the code that is checked out (HEAD ${GIT_HEAD:0:7}, apps/ unchanged)"
else
  no "apps/ changed since launch: the API does not reload; run down.sh and up.sh again"
fi

if [ "$(jq -r '.tokens.student | length > 0' "$DIR/seed.json" 2>/dev/null)" = true ]; then
  ok "seed.json has tokens"
else
  no "seed.json is missing or has no tokens"
fi

exit $bad
