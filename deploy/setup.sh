#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server, once. Run as root: setup.sh <dns-name>
# Then put the model key in /etc/leetkob/model.env by hand and run deploy.sh.
set -euo pipefail

SITE=${1:?usage: setup.sh <dns-name>}
NODE_VERSION=v22.23.4
REPO=https://github.com/xyberr81/CSC13114-AWAD-FinalProject.git

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq docker.io docker-compose-v2 docker-buildx git curl xz-utils openssl
systemctl enable --now docker

if [ "$(node --version 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  case $(uname -m) in
    x86_64) file=node-$NODE_VERSION-linux-x64.tar.xz ;;
    *) echo "unsupported architecture" >&2 && exit 1 ;;
  esac
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$file" -o "$tmp/$file"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$tmp/$file" -C /usr/local --strip-components=1
  rm -r "$tmp"
fi

for user in leetkob-judge leetkob-review; do
  id "$user" >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin "$user"
done

[ -d /opt/leetkob/.git ] || git clone "$REPO" /opt/leetkob

# Generated once, readable by root only: systemd and Docker Compose read them, the services do not.
install -d -m 700 /etc/leetkob
umask 077
if [ ! -e /etc/leetkob/postgres.env ]; then
  password=$(openssl rand -hex 24)
  printf 'POSTGRES_USER=leetkob\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=leetkob\n' "$password" \
    >/etc/leetkob/postgres.env
  printf 'DATABASE_URL=postgres://leetkob:%s@db:5432/leetkob\nJWT_SECRET=%s\n' \
    "$password" "$(openssl rand -hex 32)" >/etc/leetkob/api.env
  printf 'DATABASE_URL=postgres://leetkob:%s@127.0.0.1:5432/leetkob\nWORKER_CONCURRENCY=2\n' \
    "$password" >/etc/leetkob/worker.env
fi
printf 'SITE_ADDRESS=%s\n' "$SITE" >/etc/leetkob/caddy.env
[ -e /etc/leetkob/model.env ] || printf 'LLM_PROVIDER=openrouter\nLLM_MODEL=\nLLM_API_KEY=\n' \
  >/etc/leetkob/model.env

echo "Ready. Fill in /etc/leetkob/model.env, then run /opt/leetkob/deploy/deploy.sh"
