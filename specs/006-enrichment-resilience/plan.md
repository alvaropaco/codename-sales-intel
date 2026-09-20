# B2Base-platform — deploy completo no k3s (padrão GitOps do cluster)
#
# Ciclo (ver AGENTS.md do k8s-infra): CI do repo alvaropaco/codename-sales-intel
# builda a imagem no GHCR e faz write-back da tag aqui (branch master); o ArgoCD
# sincroniza (~3min). Substituiu o deploy via Coolify + Endpoints manual —
# o app agora roda DENTRO do cluster, no namespace b2base (mesmo do WAHA).
#
# ⚙️ Passos manuais única vez (fora do git):
#   1. Pull secret do GHCR no namespace b2base (copiar de outro namespace):
#      kubectl -n b2base create secret generic ghcr-pull \
#        --from-file=.dockerconfigjson=<dockerconfig com pull para ghcr.io/alvaropaco> \
#        --type=kubernetes.io/dockerconfigjson
#   2. Secrets no Infisical, path /b2base (projeto eec0ce55-…, env prod):
#      DATABASE_URL               → postgresql://…@cnpj-postgres.cnpj-data.svc.cluster.local:5432/cnpj?schema=public
#      ENRICHMENT_DATABASE_URL    → mesma instância (view company_enrichment.v_company_graph)
#      TOKEN_ENCRYPTION_KEY, SESSION_SECRET, FIREBASE_SERVICE_ACCOUNT_JSON,
#      FIREBASE_PROJECT_ID, CNPJ_MCP_TOKEN, GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI,
#      WAHA_API_KEY, WAHA_WEBHOOK_TOKEN, LITELLM_API_KEY, RESEND_API_KEY (opcional)
#      Billing Stripe (devem ser do MESMO modo — test ou live):
#      STRIPE_SECRET_KEY         → rk_/sk_ do Stripe
#      STRIPE_WEBHOOK_SECRET     → whsec_ do event destination b2base-prod-webhook
#      (o Price ID não é segredo e vai no bloco `env` abaixo)
#      (credenciais universal-auth do Infisical já existem no ns b2base — usadas pelo WAHA)

namespace: b2base
replicaCount: 1

# Mudar este valor força um rollout do deployment (annotation no pod template).
# Necessário após trocar secrets no Infisical: envFrom só é resolvido quando o
# pod (re)cria. Use o timestamp do momento da troca.
restartAt: "2026-09-01T11:00:00Z"

image:
  repository: ghcr.io/alvaropaco/b2base-platform
  tag: sha-15308d4
  pullPolicy: IfNotPresent

imagePullSecretName: ghcr-pull

# Hosts públicos (Cloudflare proxied ☁️ — TLS termina no edge; origem self-signed).
hosts:
  - b2base.net
  - www.b2base.net

tls:
  secretName: b2base-tls
  issuer: selfsigned
  duration: 8760h    # 1 ano
  renewBefore: 720h  # renova 30 dias antes

service:
  port: 80
  targetPort: 3001

# Env NÃO-secreta (config de wiring in-cluster). Secrets ficam no Infisical
# (envFrom do managed secret) e não são versionadas aqui.
env:
  PORT: "3001"
  NODE_ENV: production
  SESSION_COOKIE_SECURE: "true"
  # Pipeline de enriquecimento NATS (consumer do b2base) — in-cluster.
  NATS_ENABLED: "true"
  NATS_URL: nats://legal-nats.laweragent.svc.cluster.local:4222
  # Reconciliação de enriquecimento no boot: retoma prospects presos em
  # 'pending' por reinício do pod (jobs de enriquecimento são em memória e não
  # sobrevivem ao restart). RECONCILE_PENDING_ON_BOOT=false desliga; LIMIT capa o lote.
  RECONCILE_PENDING_ON_BOOT: "true"
  RECONCILE_PENDING_LIMIT: "100"
  # IA via gateway LiteLLM (0xcloud). O gateway in-cluster ai-gateway está
  # fora do ar; key LITELLM_API_KEY vive no Infisical (/b2base, env prod).
  LITELLM_URL: https://litellm.0xcloud.net
  # Modelo padrão da esteira de IA + override da Campanha IA (feature premium).
  # 20/09: alias sem prefixo (DeepInfra) ficou sem saldo (HTTP 402); o grupo
  # com prefixo tem créditos via key b2base-lead-qualifier.
  LITELLM_MODEL: deepseek/deepseek-v4-flash
  AI_CAMPAIGN_LLM_MODEL: deepseek/deepseek-v4-flash
  # Análise profunda de lead (feature 005) — modelo reasoning com JSON mode;
  # key dedicada no Infisical (LITELLM_API_KEY, alias b2base-lead-qualifier).
  DEEP_ANALYSIS_LLM_MODEL: deepseek/deepseek-v4-flash
  # Resiliência do enriquecimento (feature 006): sweeper de tasks PARKED.
  ENRICHMENT_SWEEPER_INTERVAL_MS: "60000"
  ENRICHMENT_PARK_WINDOW_HOURS: "72"
  ENRICHMENT_SWEEPER_PROVIDER_RATE_PER_MIN: "6"
  RETRY_DELAYS_MS: "10000,30000,120000,600000,1800000"
  # Segredos de notificação no Infisical /b2base: SLACK_WEBHOOK_URL, ALERT_EMAIL_TO.
  # WhatsApp via WAHA (mesmo namespace).
  WAHA_BASE_URL: http://b2base-waha.b2base.svc.cluster.local:3000
  # Discovery de CNPJ (público; token vai no Infisical).
  CNPJ_MCP_URL: https://mcps.0xcloud.net/mcp
  # Filas Bull (outreach/whatsapp) no Redis do próprio chart.
  REDIS_URL: redis://b2base-redis.b2base.svc.cluster.local:6379
  # Motor de enriquecimento distribuído v2 — LIGADO para todas as organizações
  # (allowlist vazia) com catálogo completo (capabilities portadas ativas).
  # Rollback: ENRICHMENT_ENGINE_V2="false" (uma linha, sem migration).
  ENRICHMENT_ENGINE_V2: "true"
  ENRICHMENT_CATALOG_FULL: "true"
  # ENRICHMENT_ENGINE_V2_ORGS: ""  (csv de orgIds; vazio = todas as orgs)
  # Bull queue factory (outreach-queues.js/whatsapp-queues.js) lê REDIS_HOST/PORT,
  # NÃO REDIS_URL. Sem estes, caía em 127.0.0.1:6379 (sem Redis no pod) e o
  # ioredis lançava MaxRetriesPerRequestError não tratado -> CrashLoopBackOff.
  REDIS_HOST: b2base-redis.b2base.svc.cluster.local
  REDIS_PORT: "6379"
  # Billing Stripe: Price do plano premium (id de price é público, não segredo).
  # STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET ficam no Infisical (ver header).
  STRIPE_PRICE_ID: price_1UAY3FIROIzezloBRmZ2Xz2K
  # Reengajamento automático de conversas frias (reengagement-agent.js) +
  # continuação automática quando o lead responde (reengagement-reply.js).
  # Envs aqui SOBRESCREVEM chaves homônimas do Infisical (envFrom). Defaults
  # não listados (cooldown 48h, gap 24h, maxAttempts 3, cap frio 12/dia,
  # modelo LLM) vivem no código. Desligar tudo: REENGAGE_ENABLED=false.
  REENGAGE_ENABLED: "true"
  REENGAGE_MODE: auto
  REENGAGE_REPLY_ENABLED: "true"
  REENGAGE_REPLY_MODE: auto
  REENGAGE_REPLY_MAX_PER_CONVERSATION: "8"
  REENGAGE_REPLY_DAILY_CAP: "60"
  REENGAGE_REPLY_MIN_DELAY_SEC: "5"
  REENGAGE_REPLY_JITTER_SEC: "10"
  # Lead respondeu a uma mensagem de CAMPAIGN (sequência de disparo) → a IA
  # continua a conversa com a proposta da campanha. Mensagens MANUAL (humano)
  # nunca viram conversa do agente. Kill switch: "false".
  REENGAGE_REPLY_INCLUDE_CAMPAIGN: "true"
  # Rate limit de disparo de e-mail (outreach-rate-limiter.js). Sem estes, o
  # código usa defaults (30/dia, 5/hora, 9-17h) e o backlog de agendados
  # cresce ~300/dia — 345 mensagens presas em 2026-09-10. Resend free tier
  # tem teto duro de 100/dia (PROVIDER_DAILY_CAPS); 90 deixa folga para os
  # e-mails transacionais da mesma conta.
  OUTREACH_DAILY_LIMIT: "90"
  OUTREACH_HOURLY_LIMIT: "15"
  OUTREACH_ALLOWED_HOURS_START: "9"
  OUTREACH_ALLOWED_HOURS_END: "20"
  OUTREACH_TIMEZONE: America/Sao_Paulo

# Redis para as filas Bull (outreach + whatsapp). Persistência em PVC para
# os delayed jobs sobreviverem a restarts.
redis:
  enabled: true
  image:
    repository: redis
    tag: 7-alpine
  persistence:
    storageClassName: local-path
    size: 1Gi
  resources:
    requests: { cpu: 10m, memory: 32Mi }
    limits: { cpu: 500m, memory: 256Mi }

infisical:
  enabled: true
  hostAPI: "http://infisical-infisical-standalone-infisical.infisical.svc.cluster.local:8080/api"
  resyncInterval: 60
  credentialsSecretName: infisical-universal-auth-credentials
  projectId: "eec0ce55-fcce-47b7-9f7d-f0e11cc5cc61"
  envSlug: prod
  secretsPath: "/b2base"
  managedSecretName: b2base-secrets

resources:
  # Ajustado 2026-08-29: crash-loop por timeout de keepalive do ioredis sob
  # carga de CPU (load alto do VPS). Memória não era o gargalo (uso ~132Mi/1Gi),
  # mas o limit de 1 core estrela o event loop (Redis cai -> exceção não tratada).
  # - CPU: limiar de 1 -> 2 cores p/ dar folga ao event loop em bursts
  # - Mem: 1Gi -> 2Gi (Node+Prisma+3 workers outreach+whatsapp+NATS podem estourar)
  requests: { cpu: 500m, memory: 512Mi }
  limits: { cpu: "2", memory: 2Gi }

# Migrações: o CMD da imagem roda `npx prisma migrate deploy` antes de subir o
# servidor. Com replicaCount 1 não há corrida de migração; se um dia escalar,
# extrair para um Helm hook job (padrão de company-enrichment-worker/migration-job.yaml).

podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  seccompProfile:
    type: RuntimeDefault

containerSecurityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]

nodeSelector: {}
tolerations: []
affinity: {}

# ── Motor de enriquecimento distribuído v2 (specs/001-distributed-enrichment) ──
# Workers = processos da MESMA imagem (entrypoint node workers/<família>.js).
# O motor fica INERTE enquanto ENRICHMENT_ENGINE_V2=false; rollout por fases:
#   1. ENRICHMENT_ENGINE_V2=true + ENRICHMENT_ENGINE_V2_ORGS=<orgIds csv>
#      (allowlist VAZIA = todas as orgs — evitar antes da paridade validada)
#   2. ENRICHMENT_CATALOG_FULL=true habilita as capabilities portadas
#      (PDL/jurídico/logo/deepgraph) — premium não deve ligar v2 sem isto.
workers:
  identity: { replicas: 1 }
  search: { replicas: 1 }
  company-deep: { replicas: 1 }
