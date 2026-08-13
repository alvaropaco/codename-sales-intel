# ============================================================================
# SalesIntel Platform - production container (Coolify-ready)
#
# Build:    docker build -t salesintel .
# Runtime:  node server-prod.js  (serves React SPA + API on one port)
#
# Env (set these in Coolify, not in the image):
#   DATABASE_URL       postgresql://user:pass@host:5432/db?schema=public
#   PORT               3001
#   NODE_ENV           production
#   CNPJ_MCP_URL       https://mcps.0xcloud.net/mcp
#   CNPJ_MCP_TOKEN     <token>
#   NATS_ENABLED       false  (true + NATS_URL to enable pipeline)
#   NATS_*             see NATS_ENRICHMENT.md
# ============================================================================

# ── Stage 1: Build (install deps + build Vite web + generate Prisma) ──────
FROM node:22-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

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
# Safe default: NATS OFF unless explicitly enabled via Coolify env.
# (server-prod.js defaults NATS to ON when unset; in the container we
#  default OFF so the app boots clean with the BrasilAPI fallback.)
ENV NATS_ENABLED=false
RUN apk add --no-cache openssl

# Copy node_modules (includes @prisma/client generated against schema)
COPY --from=builder /app/node_modules ./node_modules

# Copy app runtime files
COPY server-prod.js ./
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
