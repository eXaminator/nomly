# syntax=docker/dockerfile:1.7

# Node base image, pinned to an exact patch — never a floating tag like
# `node:24-alpine`. A rebuild must not be able to change the runtime underneath
# us: that is what took prod down once already. Node 24.19.0 gave
# `node::ObjectWrap` a cleanup hook whose destructor aborts the process when it
# runs without an entered V8 context (nodejs/node#63642), and better-sqlite3 12
# derived its Database/Statement objects from exactly that class — so a rebuild
# carrying no code change of ours started crash-looping the server
# (WiseLibs/better-sqlite3#1515).
#
# better-sqlite3 13 fixes that at the root by moving to `Napi::ObjectWrap`
# (node-addon-api), which never touches the aborting API, so this no longer
# needs to sit on 24.18. Bumping it stays a deliberate, reviewable edit.
ARG NODE_IMAGE=node:24.19.0-alpine

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
