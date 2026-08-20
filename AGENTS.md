<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Local dev server & databases

The dev server reads `DATABASE_URL` from `.env.local` (defaults to `./data/nomly.db`). It does **not** auto-run migrations — only the Docker entrypoint does. So always migrate a fresh DB before serving it.

**Databases under `data/`:**
- `data/nomly.db` — the normal local dev DB (`.env.local` default).
- `data/prod/nomly.db` — **most recent prod copy.** Pulled manually with `scp docker-1:/DATA/AppData/nomly/data/nomly.db ./data/prod/`. Treat as pristine; never point the server at it directly (it would mutate the dump).
- `data/nomly-prodtest.db` — disposable working copy of prod used to run dev against real data.

**Kill the dev server (port 3000):**
```bash
lsof -ti tcp:3000 | xargs kill
```

**Start dev normally (local dev DB):**
```bash
npm run dev
```

**Start dev against the latest prod data:** refresh the working copy from the prod dump, migrate it to the current head, then serve it:
```bash
rm -f data/nomly-prodtest.db data/nomly-prodtest.db-shm data/nomly-prodtest.db-wal
cp data/prod/nomly.db data/nomly-prodtest.db
DATABASE_URL=./data/nomly-prodtest.db npm run migrate
DATABASE_URL=./data/nomly-prodtest.db npm run dev
```
Note: only the DB is copied — prod photos and the live OIDC issuer (`.env.local`) are unchanged, so referenced images may be missing and login still hits the real IdP.

# Tests

`npm test` runs the unit suite (vitest) — fast, no browser, no server.

`npm run test:e2e` builds and runs the Playwright suite. It boots the app itself
against a disposable `data/e2e.db` (rebuilt and reseeded on every run) and puts a
**fault-injecting proxy** in front of it on port 3100, which the browser talks to:

```bash
npm run test:e2e                       # everything
npx playwright test --grep 503         # one scenario, against an existing build
```

Two details worth knowing before touching it:

- **Auth is bypassed without a test-only code path.** `tests/e2e/support/global-setup.ts`
  mints a real iron-session cookie with the same secret the app boots with, so no
  IdP is contacted and the app carries no test hooks. The minted session has no
  refresh token on purpose.
- **The proxy is how "the server goes down" is simulated** (`GET /__mode/fail` →
  everything answers 503 text/html, `/__mode/pass` → back to normal). It has to
  be a real proxy rather than Playwright request interception, because the
  service worker must see the same responses the browser does — the reload loop
  those specs guard against is an interaction between the router, the service
  worker and the network.

Set `E2E_CHROMIUM_PATH` to use a Chromium already on the machine instead of the
build Playwright wants to download.
