# ============================================================================
# B2Base Platform - production container (Coolify-ready)
#
# Build:    docker build -t b2base .
# Runtime:  node server-prod.js  (serves React SPA + API on one port)
#
# Env (set these in Coolify, not in the image):
#   DATABASE_URL       postgresql://user:pass@host:5432/db?schema=b2base
#                      IMPORTANT: use a dedicated schema (e.g. b2base).
#                      The boot runs `prisma migrate deploy`, which aborts with
#                      P3005 if the target schema is not empty (e.g. reusing a
#                      shared Postgres that already has tables). A dedicated
#                      schema keeps B2Base tables isolated and lets migrate
#                      deploy run cleanly.
#   PORT               3001
#   METRICS_PORT       9090  (endpoint Prometheus /metrics, separado do app)
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

# Firebase Web SDK config (build-time). Vite inlines VITE_* into the JS bundle,
# so these MUST be present during `pnpm --filter web build`. Unset/empty values
# fall back to the defaults baked in apps/web/src/services/firebase.ts.
# Coolify: set these in the Build section (not runtime). Plain docker:
#   docker build --build-arg VITE_FIREBASE_AUTH_DOMAIN=b2base.net .
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN} \
    VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID} \
    VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY} \
    VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID} \
    VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET} \
    VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID}

# Install root workspace deps (apps/*)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# Copy source (skips .env, node_modules, dist via .dockerignore)
COPY . .

# Build the React SPA into apps/web/dist and generate the Prisma client
RUN pnpm --filter web build \
  && npx prisma generate

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
# Commit que originou a imagem — exposto pelo GET /api/version para conferir
# remotamente qual build está rodando no cluster. "unknown" em builds locais.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
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
COPY enrichment-graph.js ./
COPY gmail-api.js ./
COPY gmail-auth.js ./
COPY email-provider.js ./
COPY plan-masking.js ./
COPY outreach-queues.js ./
COPY outreach-rate-limiter.js ./
COPY outreach-workers.js ./
COPY campaign-suite.js ./
COPY stripe-billing.js ./
COPY waha-provider.js ./
COPY whatsapp-utils.js ./
COPY whatsapp-rate-limiter.js ./
COPY whatsapp-queues.js ./
COPY whatsapp-nats.js ./
COPY whatsapp-engine.js ./
COPY whatsapp-workers.js ./
COPY metrics.js ./
COPY package.json ./

# Copy built SPA + fallback dashboard
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY public ./public

# Copy prisma schema + migrations (so `prisma migrate deploy` works at boot)
COPY prisma ./prisma

EXPOSE 3001
EXPOSE 9090

# Apply DB migrations, then boot the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node server-prod.js"]
