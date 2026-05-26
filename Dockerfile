# syntax=docker/dockerfile:1.7

# ---------- Builder ----------
FROM node:24-alpine AS builder

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
FROM node:24-alpine AS runtime

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
