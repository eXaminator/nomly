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
