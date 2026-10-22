#!/usr/bin/env bash
# Starts the dev server as a Paseo service (see paseo.json). Also usable by hand.
#
#   scripts/paseo-dev.sh local   # local dev DB (DATABASE_URL from env / .env.local, default ./data/nomly.db)
#   scripts/paseo-dev.sh prod    # fresh working copy of the latest prod dump (data/nomly-prodtest.db)
#
# Paseo hands every service its own port and a proxy URL:
#   PASEO_PORT  port to listen on            → PORT
#   HOST        bind address (127.0.0.1 when the daemon is loopback-only) → HOSTNAME
#   PASEO_URL   public proxy URL of this service → BASE_URL
# BASE_URL drives the OIDC redirect_uri, the post-login redirect and the cookie
# `secure` flag, so it has to be the URL the browser actually uses — the proxy
# URL, not localhost:PORT. Values set here win over .env.local (Next's env
# loader never overrides variables that are already set).
#
# The dev server does not migrate on its own (only the Docker entrypoint does),
# so this script always migrates the database before serving it.
set -euo pipefail

cd "$(dirname "$0")/.."

mode="${1:-local}"
port="${PASEO_PORT:-${PORT:-3000}}"
# Not $HOSTNAME as fallback: bash sets it to the machine name.
bind_host="${HOST:-0.0.0.0}"
# Under Paseo the proxy URL; run by hand, empty → BASE_URL from .env.local applies.
base_url="${PASEO_URL:-${BASE_URL:-}}"

# DATABASE_URL as the dev server would resolve it: env, then .env.local, then default.
env_local_db() {
  [ -f .env.local ] || return 0
  sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' .env.local \
    | tail -n 1 | sed -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//'
}

# The main checkout of this repo; worktrees fall back to its data/prod dump.
source_checkout() {
  dirname "$(git rev-parse --path-format=absolute --git-common-dir)"
}

# Worktrees link .env.local to the main checkout's (one place for the secrets;
# edits there apply everywhere). Worktrees created before paseo.json existed
# missed that setup step; catch up here.
if [ ! -e .env.local ]; then
  src_env="$(source_checkout)/.env.local"
  if [ -f "$src_env" ] && [ "$src_env" != "$PWD/.env.local" ]; then
    echo "→ linking .env.local to $src_env"
    ln -sfn "$src_env" .env.local
  fi
fi

# Fail here with one clear message instead of a server that throws on every
# request. BASE_URL is supplied by this script, the rest must come from the
# environment or .env.local (loaded the same way the server loads it).
BASE_URL="${base_url:-${BASE_URL:-}}" node -e '
  require("@next/env").loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const missing = ["BASE_URL", "SESSION_SECRET", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]
    .filter((k) => !(process.env[k] || "").trim());
  if (missing.length > 0) {
    console.error("Missing required environment: " + missing.join(", "));
    console.error("Put them in " + process.argv[1] + "/.env.local (see .env.example);");
    console.error("Paseo worktrees link their .env.local to that file.");
    process.exit(1);
  }
' "$(source_checkout)"

case "$mode" in
  local)
    db="${DATABASE_URL:-$(env_local_db)}"
    db="${db:-./data/nomly.db}"
    # A fresh worktree starts without data. Give it the dev seed (a sanitized
    # prod snapshot, see scripts/dev-seed-create.mts) or, without one, the base
    # data. Only when empty: never overwrite what you've been working with.
    # (`npm run seed:dev:load -- --force` resets to the seed on purpose.)
    if node -e '
      const fs = require("fs");
      if (!fs.existsSync(process.argv[1])) process.exit(0);
      const db = new (require("better-sqlite3"))(process.argv[1], { readonly: true });
      try { process.exit(db.prepare("SELECT count(*) AS c FROM unit").get().c === 0 ? 0 : 1); }
      catch { process.exit(0); }
    ' "$db"; then
      if [ -f ./data/dev-seed/nomly-dev.db ] || [ -f "$(source_checkout)/data/dev-seed/nomly-dev.db" ]; then
        echo "→ empty database at $db, loading the dev seed"
        DATABASE_URL="$db" npm run -s seed:dev:load
      else
        echo "→ empty database at $db, no dev seed found, loading base data"
        DATABASE_URL="$db" npm run -s migrate
        DATABASE_URL="$db" npm run -s seed
      fi
    fi
    DATABASE_URL="$db" npm run -s migrate
    ;;
  prod)
    dump="./data/prod/nomly.db"
    if [ ! -f "$dump" ]; then
      dump="$(source_checkout)/data/prod/nomly.db"
    fi
    if [ ! -f "$dump" ]; then
      echo "No prod dump found at ./data/prod/nomly.db or $dump." >&2
      echo "Pull one with: scp 'docker-1:/DATA/AppData/nomly/data/nomly.db*' ./data/prod/" >&2
      exit 1
    fi
    # The dump stays pristine; the server only ever touches the working copy.
    db="./data/nomly-prodtest.db"
    echo "→ refreshing $db from $dump"
    mkdir -p "$(dirname "$db")"
    rm -f "$db" "$db-shm" "$db-wal"
    cp "$dump" "$db"
    # A dump pulled with its -wal holds changes not yet checkpointed into the
    # main file; take them along, or the copy silently misses them.
    if [ -f "$dump-wal" ]; then cp "$dump-wal" "$db-wal"; fi
    DATABASE_URL="$db" npm run -s migrate
    ;;
  *)
    echo "usage: $0 [local|prod]" >&2
    exit 2
    ;;
esac

echo "→ nomly dev ($mode) on ${bind_host}:${port}, public URL ${base_url:-(BASE_URL from .env.local)}, DB ${db}"
export DATABASE_URL="$db" PORT="$port" HOSTNAME="$bind_host"
if [ -n "$base_url" ]; then export BASE_URL="$base_url"; fi
exec node --experimental-transform-types --disable-warning=ExperimentalWarning server.mts
