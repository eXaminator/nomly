# syntax=docker/dockerfile:1.7

# Node base image, pinned on purpose — do not float this back to `node:24-alpine`.
#
# Node 24.19.0 (2026-08-03) gave `node::ObjectWrap` its own environment cleanup
# hook (nodejs/node#63642): `~ObjectWrap()` now calls
# `node::RemoveEnvironmentCleanupHook()`, which 24.18.x never did. That call
# CHECKs that `Environment::GetCurrent(isolate)` is non-null, and it only is
# while a V8 context is entered — so a wrapped object destroyed off that path
# aborts the whole process:
#
#   node[6]: void node::RemoveEnvironmentCleanupHook(...) at ../src/api/hooks.cc:142
#   Assertion failed: (env) != nullptr
#
# better-sqlite3 sits squarely in the blast radius: Database, Statement,
# StatementIterator and Backup all derive from `node::ObjectWrap`, and
# `ObjectWrap::Wrap()` makes every instance weak, so each one is freed by a GC
# weak callback during normal operation — every prepared statement we hand to
# drizzle is eventually destroyed through that new code path.
#
# Which of those frees actually finds no context entered is timing-dependent, so
# the abort is not deterministic: the server boots, serves traffic, then dies
# minutes later with no JS stack, and Docker restarts it into the same fate.
# That restart loop is what users see as a 503 in a fresh browser and an endless
# reload in one that already has the app cached.
#
# `node:24-alpine` started resolving to 24.19.0, which is how a rebuild carrying
# no code change of ours took prod down. Keep the pin until better-sqlite3 ships
# a fix for the new hook lifecycle, then bump deliberately.
#
# 24.18.1 is the last release on the 24.18 line: it carries the July security
# fixes (12 CVEs) without the 24.19 `ObjectWrap` change. Both stages read this
# one ARG so the headers better-sqlite3 compiles against in the builder can
# never drift from the Node that loads it at runtime.
ARG NODE_IMAGE=node:24.18.1-alpine

# ---------- Builder ----------
FROM ${NODE_IMAGE} AS builder

# Build deps for native modules (better-sqlite3, sharp)
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs ./
COPY drizzle.config.ts ./
COPY public ./public
COPY src ./src
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY server.mts ./

RUN npm run build

# Drop dev dependencies in place so we can copy node_modules straight into
# the runtime image.
RUN npm prune --omit=dev

# ---------- Runtime ----------
FROM ${NODE_IMAGE} AS runtime

# Runtime deps: tini for proper PID-1 signal handling, libc6-compat for native
# modules built on Alpine, wget for the HEALTHCHECK probe.
RUN apk add --no-cache tini libc6-compat wget

WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=/app/data/nomly.db \
    NEXT_TELEMETRY_DISABLED=1

# Copy build output and runtime deps from the builder.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/server.mts ./server.mts
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=node:node /app/package.json ./package.json

# The data directory is the SQLite + photos mount point — created at build
# time with the right ownership so a bind mount inherits it on platforms
# where Docker doesn't `chown` the source.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
