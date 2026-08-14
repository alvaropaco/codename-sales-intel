# ============================================================================
# SalesIntel Platform - production container (Coolify-ready)
#
# Build:    docker build -t salesintel .
# Runtime:  node server-prod.js  (serves React SPA + API on one port)
#
# Env (set these in Coolify, not in the image):
#   DATABASE_URL       postgresql://user:pass@host:5432/db?schema=salesintel
#                      IMPORTANT: use a dedicated schema (e.g. salesintel).
#                      The boot runs `prisma migrate deploy`, which aborts with
#                      P3005 if the target schema is not empty (e.g. reusing a
#                      shared Postgres that already has tables). A dedicated
#                      schema keeps SalesIntel tables isolated and lets migrate
#                      deploy run cleanly.
#   PORT               3001
#   NODE_ENV           production
#   CNPJ_MCP_URL       https://mcps.0xcloud.net/mcp
#   CNPJ_MCP_TOKEN     <token>
#   NATS_ENABLED       false  (true + NATS_URL to enable pipeline)
#   NATS_*             see NATS_ENRICHMENT.md
#   FIREBASE_SERVICE_ACCOUNT_JSON  inline JSON of the Firebase service account
#   SESSION_SECRET     >= 32 chars (signs the session cookie)
#   SESSION_COOKIE_SECURE  true when serving via HTTPS
#   AUTH_ALLOWED_DOMAINS    optional corporate domain allowlist (comma separated)
# ============================================================================

# ── Stage 1: Build (install deps + build Vite web + generate Prisma) ──────
FROM node:22-alpine AS builder

WORKDIR /app
RUN apk add --no-cache openssl \
  && corepack enable && corepack prepare pnpm@9 --activate

# IMPORTANT: override any build-time NODE_ENV from the platform (e.g. Coolify
# injects NODE_ENV=production at build time, which makes pnpm skip
# devDependencies — and the web build needs tsc + vite from devDependencies).
# Setting NODE_ENV=development here guarantees a full install in the builder.
# The runtime stage sets NODE_ENV=production below.
ENV NODE_ENV=development

# Install root workspace deps (apps/*)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# Firebase Web SDK config baked into the Vite build. These are public by design
# (they ship in the JS bundle); pass them via `docker build --build-arg ...`.
# Defaults cover the shadowtrace-7199f project; API key / app id must be supplied.
ARG VITE_FIREBASE_PROJECT_ID=shadowtrace-7199f
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_AUTH_DOMAIN=shadowtrace-7199f.firebaseapp.com
ARG VITE_FIREBASE_STORAGE_BUCKET=shadowtrace-7199f.firebasestorage.app
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=421752671625
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID

# Copy source (skips .env, node_modules, dist via .dockerignore)
COPY . .

# Build the React SPA into apps/web/dist and generate the Prisma client
RUN pnpm --filter web build \
  && npx prisma generate

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
# Safe default: NATS OFF unless explicitly enabled via Coolify env.
# (server-prod.js defaults NATS to ON when unset; in the container we
#  default OFF so the app boots clean with the BrasilAPI fallback.)
ENV NATS_ENABLED=false
RUN apk add --no-cache openssl

# Copy node_modules (includes @prisma/client generated against schema)
COPY --from=builder /app/node_modules ./node_modules

# Copy app runtime files
COPY server-prod.js ./
COPY firebase-auth.js ./
COPY mcp-cnpj.js ./
COPY cnpj-enrichment.js ./
COPY nats-enrichment.js ./
COPY package.json ./

# Copy built SPA + fallback dashboard
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY public ./public

# Copy prisma schema + migrations (so `prisma migrate deploy` works at boot)
COPY prisma ./prisma

EXPOSE 3001

# Apply DB migrations, then boot the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node server-prod.js"]
