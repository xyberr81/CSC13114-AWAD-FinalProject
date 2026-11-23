#!/usr/bin/env bash
# Send one HTTP request to a verify instance and keep it as evidence.
#
#   req.sh <run-dir> <evidence-name> <METHOD> <path> [curl args...]
#
# Writes, in <run-dir>/evidence/:
#   <evidence-name>.http    the command (tokens redacted), status line, headers and body; also printed
#   <evidence-name>.status  the status code alone, e.g. 201
#   <evidence-name>.body    the response body exactly as received, for jq and diff
# Tokens from seed.json: "$(jq -r .tokens.student <run-dir>/seed.json)".
set -euo pipefail
[ $# -ge 4 ] || {
  echo "usage: req.sh <run-dir> <evidence-name> <METHOD> <path> [curl args...]" >&2
  exit 2
}
DIR=$1 NAME=$2 METHOD=$3 URL_PATH=$4
shift 4
# shellcheck disable=SC1091
. "$DIR/env"

[[ $NAME =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "req: evidence name may use only letters, digits, . _ -: $NAME" >&2
  exit 2
}
OUT=$DIR/evidence/$NAME
HEADERS=$(mktemp)
trap 'rm -f "$HEADERS"' EXIT

curl -sS -X "$METHOD" "$BASE_URL$URL_PATH" -D "$HEADERS" -o "$OUT.body" -w '%{http_code}\n' \
  "$@" >"$OUT.status"

{
  printf '$ curl -X %s %s' "$METHOD" "$URL_PATH"
  printf ' %q' "$@" | sed -E 's/Bearer\\? [A-Za-z0-9._-]+/Bearer <token>/g'
  printf '\n\n'
  tr -d '\r' <"$HEADERS"
  if jq . "$OUT.body" >/dev/null 2>&1; then jq . "$OUT.body"; else cat "$OUT.body"; fi
} >"$OUT.http"
cat "$OUT.http"
