#!/usr/bin/env bash
# Start a throw-away LeeTKOB instance: its own Postgres container on a random port, migrated and
# seeded, and the API on a random port. Never reads .env. Prints the run directory last.
#
#   .claude/skills/verify/scripts/up.sh
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
SCRIPTS=.claude/skills/verify/scripts

RUN_ID=$(date +%Y%m%d-%H%M%S)-$$
DIR=$ROOT/.verify/$RUN_ID
CONTAINER=leetkob-verify-$RUN_ID
mkdir -p "$DIR/evidence"

fail() {
  echo "up: $1 (run dir: $DIR; clean up with $SCRIPTS/down.sh $DIR)" >&2
  exit 1
}

# Written first, so down.sh can clean up whatever got started even if a later step fails.
cat >"$DIR/env" <<EOF
RUN_ID=$RUN_ID
DIR=$DIR
CONTAINER=$CONTAINER
EOF

echo "up: postgres container $CONTAINER"
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=leetkob \
  -p 127.0.0.1::5432 postgres:17 >/dev/null
PG_PORT=$(docker port "$CONTAINER" 5432/tcp | head -1 | sed 's/.*://')

# pg_isready passes while the init scripts still run on a socket-only server; a TCP query does not.
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -d leetkob -tAc 'select 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" psql -h 127.0.0.1 -U postgres -d leetkob -tAc 'select 1' >/dev/null 2>&1 ||
  fail "postgres did not accept TCP connections within 60 s"

DATABASE_URL=postgres://postgres@127.0.0.1:$PG_PORT/leetkob
JWT_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
API_PORT=$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})")
BASE_URL=http://127.0.0.1:$API_PORT

cat >>"$DIR/env" <<EOF
PG_PORT=$PG_PORT
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
API_PORT=$API_PORT
BASE_URL=$BASE_URL
GIT_HEAD=$(git rev-parse HEAD)
GIT_TREE=$(git status --porcelain -- apps | sha1sum | cut -c1-12)
EOF

echo "up: migrate and seed"
DATABASE_URL=$DATABASE_URL JWT_SECRET=$JWT_SECRET node "$SCRIPTS/prepare-db.js" >"$DIR/seed.json" ||
  fail "migrate/seed failed"

echo "up: api on $BASE_URL"
# env -i: the API sees only these variables, so nothing from the user's shell or .env leaks in.
# setsid: the API leads its own process group; down.sh kills exactly that group.
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development \
  PORT="$API_PORT" HOST=127.0.0.1 LOG_LEVEL=info \
  DATABASE_URL="$DATABASE_URL" JWT_SECRET="$JWT_SECRET" \
  setsid node --import tsx apps/api/src/server.ts >"$DIR/api.log" 2>&1 </dev/null &
echo "API_PGID=$!" >>"$DIR/env"

for _ in $(seq 1 30); do
  if [ "$(curl -s "$BASE_URL/v1/health" 2>/dev/null)" = '{"status":"ok"}' ]; then
    echo "up: ready"
    echo "$DIR"
    exit 0
  fi
  sleep 0.5
done
tail -20 "$DIR/api.log" >&2
fail "api did not answer /v1/health within 15 s"
