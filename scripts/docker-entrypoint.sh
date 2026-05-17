#!/bin/sh
set -e

# Resolve the DB path (defaults to /app/data/nomly.db inside the container)
DB_PATH="${DATABASE_URL:-/app/data/nomly.db}"
DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DB_DIR"

# Apply pending Drizzle migrations. The seed is NEVER run from the entrypoint —
# users opt in from Einstellungen → Standarddaten laden (spec §7.1 Epic 1).
echo "[nomly] applying migrations…"
node_modules/.bin/tsx scripts/migrate.mts

echo "[nomly] starting server…"
exec node_modules/.bin/tsx server.mts
