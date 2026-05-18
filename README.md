# nomly

Personal cookbook, meal planner, and shopping list. Self-hosted for two users
behind any OIDC IdP (Authentik, Keycloak, …).

## Quick start (Docker Compose)

```bash
curl -O https://raw.githubusercontent.com/eXaminator/nomly/main/docker-compose.example.yml
mv docker-compose.example.yml docker-compose.yml
curl -O https://raw.githubusercontent.com/eXaminator/nomly/main/.env.example
cp .env.example .env
# Edit .env: set BASE_URL, SESSION_SECRET (>= 32 chars), and your OIDC
# issuer/client credentials. For Authentik, point OIDC_ISSUER at
# https://auth.your-domain.tld/application/o/nomly/ and copy the client
# id/secret from Authentik's "OAuth2/OpenID Provider" settings.
docker compose up -d
```

The image is published at `ghcr.io/examinator/nomly:latest` (and version-tagged
on releases). Migrations apply automatically on container start; seed data
(Tandoor's open-tandoor-data snapshot) does NOT run unless you click
"Standarddaten laden" in Einstellungen.

The SQLite database and uploaded photos live under `./data` — back that up
and you've backed up everything.

## Development

```bash
npm install
cp .env.example .env.local   # point OIDC_ISSUER at a real IdP for the login flow
npm run db:generate           # regenerate migrations if you've edited the schema
npm run db:migrate            # apply migrations to ./data/nomly.db
npm run dev                   # boots the custom server on :3000
```

`npm test` runs the Vitest suite. `npm run typecheck` and `npm run lint`
mirror what CI checks.

## Bulk-import from Familywall

One-shot migration tool for users coming from Familywall. Drives a headless
Chromium session through the user's account, walks every recipe, and writes
them into nomly's local DB. Idempotent — re-runs skip recipes already
present (matched on title + original source URL). No links back to
Familywall are ever stored.

```bash
# First-time setup: fetch the Chromium binary Playwright needs.
npx playwright install chromium

# DATABASE_URL defaults to ./data/nomly.db. Pass --email and --password
# on every invocation.
npm run import:familywall -- --email me@example.tld --password '…'

# Useful flags for first runs:
npm run import:familywall -- --email me@example.tld --password '…' \
  --headed --limit 1 --dry-run
```

Prints one line per recipe (`imported (id 12)` / `skipped` / `failed`) and a
final summary. Use `--headed` whenever a CAPTCHA or 2FA prompt is expected.

## Tech

Next.js 16 (App Router, Turbopack) with a custom server in `server.mts` that
also hosts a `/ws` WebSocket upgrade gate. TypeScript, Tailwind v4, Radix UI +
shadcn-style component layer, `better-sqlite3` + Drizzle ORM, OIDC via
`openid-client` + `iron-session`. See `docs/superpowers/specs/` for the design
spec and `THIRD_PARTY_NOTICES.md` for vendored data attribution.
