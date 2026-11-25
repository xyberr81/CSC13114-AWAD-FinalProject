#!/usr/bin/env bash
# Stop what up.sh started for one run: the API process group and the Postgres container.
# Keeps <run-dir>/evidence, api.log and seed.json.
#
#   down.sh <run-dir>
set -uo pipefail
[ $# -eq 1 ] || {
  echo "usage: down.sh <run-dir>" >&2
  exit 2
}
DIR=$1
# shellcheck disable=SC1091
. "$DIR/env" || exit 1

if [ -n "${API_PGID:-}" ] && tr '\0' ' ' <"/proc/$API_PGID/cmdline" 2>/dev/null | grep -q 'apps/api/src/server.ts'; then
  kill -TERM -- "-$API_PGID" 2>/dev/null
  for _ in $(seq 1 20); do
    kill -0 -- "-$API_PGID" 2>/dev/null || break
    sleep 0.25
  done
  kill -KILL -- "-$API_PGID" 2>/dev/null
  echo "down: stopped api process group $API_PGID"
else
  echo "down: api process ${API_PGID:-?} already gone (or not ours: left alone)"
fi

case "$CONTAINER" in
  leetkob-verify-*)
    if docker rm -f "$CONTAINER" >/dev/null 2>&1; then
      echo "down: removed container $CONTAINER"
    else
      echo "down: container $CONTAINER already gone"
    fi
    ;;
  *) echo "down: refusing to remove container '$CONTAINER' (not a verify container)" >&2 ;;
esac

echo "down: evidence kept in $DIR/evidence"
