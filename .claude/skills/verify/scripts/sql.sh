#!/usr/bin/env bash
# Run one read-only query against a verify instance's database and keep the output as evidence.
#
#   sql.sh <run-dir> <evidence-name> "<select ...>"
#
# Writes <run-dir>/evidence/<evidence-name>.sql.txt. Use it to prove side effects (rows written or
# not written); never to arrange state mid-journey — that is what the seed is for.
set -euo pipefail
[ $# -eq 3 ] || {
  echo 'usage: sql.sh <run-dir> <evidence-name> "<select ...>"' >&2
  exit 2
}
DIR=$1 NAME=$2 QUERY=$3
# shellcheck disable=SC1091
. "$DIR/env"
OUT=$DIR/evidence/$NAME.sql.txt
{
  printf '=> %s\n\n' "$QUERY"
  docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -d leetkob \
    -v ON_ERROR_STOP=1 -c "begin read only" -c "$QUERY" -c "commit" | sed '/^BEGIN$/d;/^COMMIT$/d'
} >"$OUT"
cat "$OUT"
