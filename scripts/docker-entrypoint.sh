#!/bin/sh
set -e

# Resolve the DB path (defaults to /app/data/nomly.db inside the container)
DB_PATH="${DATABASE_URL:-/app/data/nomly.db}"
DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DB_DIR"

# Apply pending Drizzle migrations. The seed is NEVER run from the entrypoint —
# users opt in from Einstellungen → Standarddaten laden (spec §7.1 Epic 1).
# `--experimental-transform-types` is required because some classes in the
# imported modules use TS parameter properties (strip-only mode rejects
# those).
NODE_OPTS="--experimental-transform-types --disable-warning=ExperimentalWarning"

echo "[nomly] applying migrations…"
node $NODE_OPTS scripts/migrate.mts

echo "[nomly] starting server…"
exec node $NODE_OPTS server.mts
