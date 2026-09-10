# Prompt — Implementar Serviço Distribuído de Enriquecimento de Empresas

Implemente serviço independente:

```text
company-enrichment-worker
```

Objetivo:

Consumir lotes de eventos de solicitação de enriquecimento via **NATS JetStream**, executar pipeline distribuído de descoberta/análise de empresas, persistir resultados e publicar eventos de conclusão.

Serviço deve ser:

```text
standalone
event-driven
sem REST API de negócio
durável
reinicializável
idempotente
horizontalmente escalável
fault-tolerant
observável
Docker-first
Kubernetes-ready
deployado no cluster K3s/Kubernetes existente na VPS
```

Produto principal somente publica eventos.

Este serviço não deve depender diretamente do frontend ou backend principal.

---

# 1. Infraestrutura existente — REGRA PRINCIPAL

Toda infraestrutura já existente na VPS deve ser reaproveitada.

Antes de implementar ou provisionar qualquer componente:

```text
1. inspecionar cluster Kubernetes/K3s existente
2. listar namespaces
3. identificar NATS + JetStream existente
4. identificar PostgreSQL existente
5. identificar Infisical existente
6. identificar FlareSolverr existente
7. identificar SearXNG existente
8. identificar object storage existente
9. identificar LiteLLM/AI Gateway existente
10. identificar observabilidade existente
11. identificar ingress
12. identificar storage classes
13. identificar métricas/Prometheus/Grafana existentes
```

Criar:

```text
docs/INFRASTRUCTURE_INVENTORY.md
```

Documentar:

```text
recurso
namespace
service name
porta
finalidade
como será reutilizado
```

Não duplicar infraestrutura existente.

Exemplo proibido:

```text
NATS já existe
→ instalar outro NATS
```

Proibido.

Mesmo para:

```text
PostgreSQL
Redis
SearXNG
FlareSolverr
LiteLLM
MinIO/S3
Prometheus
Infisical
```

---

# 2. Deploy

Ambiente de produção:

```text
VPS existente
↓
Kubernetes/K3s existente
↓
namespace dedicado
↓
company-enrichment-worker
```

Criar namespace:

```text
company-enrichment
```

ou reutilizar namespace existente se arquitetura atual indicar opção melhor.

Deploy deve ser feito exclusivamente via:

```text
Helm
```

Não fazer produção usando:

```bash
docker run
docker compose up
python worker.py
systemd
pm2
screen
tmux
```

Docker Compose pode ser usado somente para desenvolvimento/teste local.

---

# 3. Helm Chart

Criar:

```text
helm/company-enrichment-worker/
```

Com:

```text
Deployment
Service
ConfigMap
Infisical integration
ServiceAccount
HPA
PodDisruptionBudget opcional
NetworkPolicy
ServiceMonitor/PodMonitor se compatível
migration Job
```

Não incluir dependencies de:

```text
NATS
PostgreSQL
Infisical
FlareSolverr
SearXNG
LiteLLM
```

se já existem no cluster.

Referenciar serviços existentes.

Exemplo:

```yaml
nats:
  existingService: nats.nats.svc.cluster.local
```

Mesmo conceito para demais recursos.

---

# 4. Secrets — Infisical obrigatório

Todos secrets devem ficar no **Infisical já existente na VPS**.

Não usar secrets hardcoded.

Não salvar credenciais em:

```text
.env
Git
values.yaml
ConfigMap
Dockerfile
source code
CI logs
```

`.env.example` pode conter somente nomes:

```env
DATABASE_URL=
NATS_URL=
AI_GATEWAY_API_KEY=
```

Nunca valores.

Antes do deploy:

```text
1. identificar integração Infisical/Kubernetes existente
2. reutilizar padrão atual
3. criar path/environment específico para serviço
```

Sugestão:

```text
/project/company-enrichment-worker/
```

Secrets possíveis:

```text
DATABASE_URL
NATS_URL
NATS_CREDS

AI_GATEWAY_URL
AI_GATEWAY_API_KEY

SEARXNG_URL

S3_ENDPOINT
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY

FLARESOLVERR_URL
```

Quando secret necessário e inexistente:

```text
NÃO inventar
NÃO colocar placeholder em produção
```

Reportar:

```text
SECRET_REQUIRED:
<secret>
```

e continuar implementando tarefas não bloqueadas.

---

# 5. Arquitetura

```text
Main Platform
      ↓
NATS JetStream
      ↓
enrichment.company.requested.v1
      ↓
┌──────────────────────────────────┐
│ Enrichment Workers               │
│                                  │
│ worker pod 1                     │
│ worker pod 2                     │
│ worker pod 3                     │
│ worker pod N                     │
└──────────────────────────────────┘
      ↓
Existing PostgreSQL
      ↓
Transactional Outbox
      ↓
Existing NATS JetStream
      ↓
enrichment.company.completed.v1
```

Escala:

```text
1 pod
→
5 pods
→
20 pods
```

sem mudança de arquitetura.

---

# 6. Stack

Preferir:

```text
Python 3.12
asyncio
Pydantic v2
nats-py
SQLAlchemy 2 async
Alembic
httpx
structlog
Prometheus
OpenTelemetry
Docker
Helm
Kubernetes/K3s
```

Reutilizar bibliotecas existentes se projeto já possuir stack equivalente.

Não adicionar:

```text
Celery
RabbitMQ
Kafka
Redis Queue
```

NATS JetStream já fornece infraestrutura assíncrona.

---

# 7. Modelo de execução

Serviço NÃO deve possuir REST API de negócio.

Não implementar:

```text
POST /enrich
GET /company
POST /company
```

Entrada:

```text
NATS JetStream
```

Saída:

```text
NATS JetStream
```

HTTP permitido somente para:

```text
/healthz
/readyz
/metrics
```

---

# 8. NATS JetStream

Reutilizar NATS já instalado no cluster.

Inspecionar streams existentes antes de criar novo.

Subject de entrada:

```text
enrichment.company.requested.v1
```

Saídas:

```text
enrichment.company.completed.v1
enrichment.company.failed.v1
enrichment.company.discarded.v1
enrichment.company.partial.v1
```

DLQ:

```text
enrichment.company.dlq.v1
```

Consumer:

```text
durable
pull-based
explicit ACK
```

Todos pods:

```text
mesmo durable consumer
```

Isso permite distribuição horizontal.

---

# 9. Concorrência

Cada pod:

```text
NATS
↓
fetch small batch
↓
bounded semaphore
↓
parallel enrichment
```

Configuração:

```env
WORKER_CONCURRENCY=10
NATS_FETCH_BATCH_SIZE=20
NATS_MAX_ACK_PENDING=100
```

Exemplo:

```text
10 pods
×
10 concurrent jobs
=
até 100 jobs simultâneos
```

Mas provider limits têm precedência.

---

# 10. Autoscaling

Criar HPA.

Inicialmente:

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 20

  cpu:
    targetUtilization: 70
```

Investigar se cluster possui:

```text
KEDA
Prometheus Adapter
```

Se existir, preferir autoscaling por:

```text
JetStream consumer backlog
```

Exemplo conceitual:

```text
queue small
→ 2 pods

queue growing
→ 8 pods

large backlog
→ 20 pods
```

Não instalar KEDA automaticamente.

Se necessário:

```text
documentar
criar Helm
testar local/staging
solicitar aprovação
```

---

# 11. Durabilidade

Princípio:

```text
attempt is disposable
job is durable
```

Se worker morrer durante:

```text
DOMAIN_DISCOVERY
↓
WEBSITE_CRAWL
↓
TECH_DETECTION
↓
CRASH
```

outro worker pode executar:

```text
DOMAIN_DISCOVERY
↓
...
```

desde começo.

Isso é comportamento esperado.

---

# 12. Garantia arquitetural

Sistema opera:

```text
at-least-once
```

Assumir:

```text
mesmo evento pode chegar 2x
mesmo job pode rodar 2x
worker pode morrer
pod pode ser removido
node pode reiniciar
cluster pode reiniciar
```

Mesmo assim:

```text
resultado final durável
não pode duplicar semanticamente
```

Usar:

```text
stable event_id
+
database unique constraints
+
leases
+
idempotent writes
+
transactional outbox
```

---

# 13. Banco

Reutilizar PostgreSQL existente na VPS.

Criar:

```text
database dedicada
```

ou:

```text
schema dedicado
```

dependendo das práticas existentes.

Não compartilhar tabelas do produto principal.

Tabela:

```text
enrichment_jobs
```

Campos:

```text
id UUID
event_id UUID UNIQUE
tenant_id UUID NULL
company_id UUID
cnpj VARCHAR

status
attempt
worker_id

started_at
heartbeat_at
lease_expires_at
completed_at

error_code
error_message

created_at
updated_at
```

---

# 14. Job lease

Antes de processar:

```text
acquire lease atomically
```

Campos:

```text
worker_id
heartbeat_at
lease_expires_at
```

Config:

```env
WORKER_HEARTBEAT_SECONDS=15
WORKER_LEASE_SECONDS=60
```

Se lease ativo:

```text
não executar duplicado
```

Se stale:

```text
novo worker assume
```

---

# 15. Pipeline

Pipeline principal:

```text
COMPANY_NORMALIZATION
        ↓
FIRMOGRAPHIC_ANALYSIS
        ↓
DOMAIN_DISCOVERY
        ↓
DOMAIN_VALIDATION
        ↓
WEB_DISCOVERY
        ↓
WEB_CRAWL
        ↓
DIGITAL_PRESENCE
        ↓
TECHNOLOGY_DETECTION
        ↓
BUSINESS_PROFILE
        ↓
CORPORATE_CONTACT_DISCOVERY
        ↓
LAUNCH_SIGNAL_ANALYSIS
        ↓
OPERATIONAL_READINESS
        ↓
COMMERCIAL_POTENTIAL
        ↓
BUYING_INTENT
        ↓
AI_BUSINESS_ANALYSIS
        ↓
FINAL_AGGREGATION
```

---

# 16. Search providers

Prioridade:

```text
existing internal data
↓
existing SearXNG
↓
direct public web
↓
FlareSolverr quando necessário
```

Não utilizar FlareSolverr em toda request.

---

# 17. FlareSolverr

Existe FlareSolverr no cluster.

Localizar:

```text
namespace
Service
port
```

Reutilizar.

Configuração recebida pelo Infisical:

```env
FLARESOLVERR_URL=
```

Criar provider:

```text
FlareSolverrProvider
```

Fluxo:

```text
HTTP normal
↓
403 / anti-bot challenge / compatible failure
↓
avaliar fallback
↓
FlareSolverr
```

Objetivo:

```text
reduzir bloqueios simples
melhorar acesso a páginas públicas
```

Não usar para:

```text
bypassar login
bypassar autenticação
bypassar paywall
bypassar autorização
resolver CAPTCHA para acesso restrito
acessar conteúdo privado
```

Não tentar evasão agressiva contra mecanismos de proteção.

Somente conteúdo publicamente acessível.

---

# 18. FlareSolverr rate limiting

FlareSolverr é recurso pesado.

Criar limite separado:

```env
FLARESOLVERR_MAX_CONCURRENCY=3
FLARESOLVERR_TIMEOUT_SECONDS=60
```

Mesmo com 20 workers:

```text
não deixar todos dispararem browsers simultaneamente
```

Implementar controle distribuído se necessário.

Primeiro verificar se Redis ou mecanismo equivalente já existe.

Não instalar infraestrutura nova sem necessidade.

---

# 19. Domain Discovery

Providers:

```text
existing company data
SearXNG
DNS
RDAP
web search
```

Queries:

```text
"<legal_name>" "<city>"
"<trade_name>" "<state>"
"<legal_name>" "<cnpj>"
```

Gerar candidatos.

Score:

```text
legal name match
trade name match
CNPJ match
address match
city match
phone match
website title
email domain
social links
```

---

# 20. Domain Validation

Validar:

```text
DNS
HTTPS
HTTP
redirect
TLS
title
company identity
CNPJ
address
phone
```

SSRF obrigatório.

Bloquear:

```text
localhost
RFC1918
link-local
metadata endpoints
private IPv6
```

Validar novamente depois de redirect.

---

# 21. Website discovery/crawler

Tentar:

```text
httpx
```

primeiro.

Fallback controlado:

```text
FlareSolverr
```

Crawler:

```env
CRAWLER_MAX_PAGES=30
CRAWLER_MAX_DEPTH=3
CRAWLER_TIMEOUT_SECONDS=15
CRAWLER_MAX_RESPONSE_BYTES=5000000
```

Prioridade:

```text
/
/sobre
/about
/empresa
/company
/contato
/contact
/produtos
/products
/servicos
/services
```

---

# 22. Digital Presence

Detectar:

```text
official website
corporate email
LinkedIn company
Instagram
Facebook
YouTube
GitHub organization
WhatsApp business contact
Google Business signals
```

Classificar:

```text
VERIFIED
FOUND
INFERRED
```

Não transformar inferência em fato.

---

# 23. Technology Intelligence

Detectar:

```text
Google Analytics
Google Tag Manager
Meta Pixel

HubSpot
RD Station
Hotjar

Google Workspace
Microsoft 365

Cloudflare
AWS
Azure
GCP
Vercel

WordPress
Shopify
Nuvemshop
WooCommerce

Stripe
Mercado Pago
Pagar.me

Intercom
Zendesk
```

Fontes:

```text
DNS
MX
headers
HTML
scripts
public web fingerprints
```

Sem scans invasivos.

---

# 24. Business Launch Velocity

Usar:

```text
CNPJ opening date
domain registration date
website availability
corporate email readiness
social presence
technology footprint
```

Gerar:

```text
0-100
```

e:

```text
VERY_LOW
LOW
MEDIUM
HIGH
VERY_HIGH
```

---

# 25. Operational Readiness

Calcular usando:

```text
domain
website
corporate email
MX
analytics
marketing stack
social
payments
communications
```

Exemplo:

```json
{
  "score": 89,
  "level": "HIGH",
  "reasons": [
    "DOMAIN_ACTIVE",
    "WEBSITE_ACTIVE",
    "CORPORATE_EMAIL",
    "GOOGLE_WORKSPACE",
    "META_PIXEL"
  ]
}
```

---

# 26. Commercial Potential

Não estimar faturamento como fato.

Gerar:

```text
Commercial Potential Score
```

Inputs:

```text
capital social
porte
natureza jurídica
CNAE
empresa recém-aberta
digital readiness
technology footprint
launch velocity
location
contactability
```

Output:

```json
{
  "score": 86,
  "level": "HIGH",
  "confidence": 0.81,
  "reasons": []
}
```

---

# 27. Buying Intent

Calcular por vertical.

Inicial:

```text
ACCOUNTING
BANKING
PAYMENTS
CRM
ERP
PROFESSIONAL_EMAIL
CLOUD
CYBERSECURITY
TELECOM
MARKETING
INSURANCE
HR_SOFTWARE
ECOMMERCE
```

Exemplo:

```json
{
  "CRM": {
    "score": 83,
    "confidence": 0.79
  },
  "PROFESSIONAL_EMAIL": {
    "score": 96,
    "confidence": 0.94
  }
}
```

---

# 28. LLM Gateway

Reutilizar AI gateway existente.

Primeiro procurar:

```text
LiteLLM
OpenAI-compatible gateway
existing routing layer
```

Nunca chamar provider diretamente se gateway já existe.

---

# 29. Modelos preferidos

Modelos preferenciais:

```text
gpt-4.1-mini
deepseek-v4-flash-0731
kimi-k2.6
```

Não hardcode modelo em código.

Configurar:

```env
ENRICHMENT_MODEL_PRIMARY=gpt-4.1-mini
ENRICHMENT_MODEL_FALLBACK_1=deepseek-v4-flash-0731
ENRICHMENT_MODEL_FALLBACK_2=kimi-k2.6
```

ou usar nomes lógicos definidos no gateway existente.

Preferência inicial:

```text
1. gpt-4.1-mini
2. deepseek-v4-flash-0731
3. kimi-k2.6
```

Mas roteamento deve permitir:

```text
custo
latência
disponibilidade
task type
```

---

# 30. Uso inteligente de LLM

Não chamar LLM em todo estágio.

LLM somente para:

```text
business classification
website understanding
product/service extraction
B2B/B2C classification
company summary
intent reasoning
ambiguous evidence reconciliation
```

Não usar LLM para:

```text
DNS
HTTP status
regex
email parsing
MX
dates
hashing
deterministic scoring
technology fingerprints
```

Objetivo:

```text
maximizar throughput
minimizar custo
minimizar latency
```

---

# 31. Contexto LLM

Não mandar HTML inteiro.

Antes:

```text
extract relevant text
deduplicate
remove navigation
remove boilerplate
truncate
```

Config:

```env
LLM_MAX_INPUT_CHARS=30000
```

Preferir:

```text
homepage
about
services/products
contact
```

---

# 32. Structured output

Toda resposta LLM:

```text
JSON structured output
```

Validar com Pydantic.

Se falhar:

```text
retry estruturado
```

Se continuar inválido:

```text
partial result
```

Nunca deixar texto livre quebrar pipeline.

---

# 33. Evidence-first

Toda descoberta:

```text
value
confidence
source
observed_at
```

Exemplo:

```json
{
  "value": "Google Workspace",
  "confidence": 0.99,
  "source": {
    "type": "DNS_MX",
    "observed_at": "..."
  }
}
```

---

# 34. Persistência

Criar histórico imutável:

```text
company_enrichments
```

Não sobrescrever resultado anterior.

Cada execução válida gera:

```text
enrichment_version
```

Campos:

```text
firmographics
domain
business_profile
digital_presence
technologies
contacts
launch_velocity
operational_readiness
commercial_potential
buying_intent
evidence
provider_statistics
AI_analysis
```

---

# 35. Outbox

Dentro de única transação:

```text
save enrichment
mark job COMPLETED
create outbox event
```

Commit.

Depois:

```text
outbox publisher
↓
NATS
↓
PubAck
```

Não fazer:

```text
DB commit
↓
direct publish
```

sem Outbox.

---

# 36. Provider error strategy

Erros:

```text
TRANSIENT
PERMANENT
PARTIAL
```

`403` em site público:

```text
normal HTTP
↓
FlareSolverr fallback elegível
```

`429`:

```text
respect Retry-After
↓
rate limiter
```

`5xx`:

```text
retry
```

`404`:

```text
permanent for URL
continue pipeline
```

---

# 37. Circuit breaker

Por provider:

```text
SearXNG
RDAP
FlareSolverr
AI Gateway
```

Estados:

```text
CLOSED
OPEN
HALF_OPEN
```

Evitar avalanche contra serviço degradado.

---

# 38. Graceful shutdown

SIGTERM:

```text
stop pulling messages
↓
finish jobs within grace period
↓
ACK completed
↓
leave incomplete unacked
↓
exit
```

Kubernetes:

```yaml
terminationGracePeriodSeconds: 90
```

Config:

```env
SHUTDOWN_GRACE_SECONDS=60
```

---

# 39. HPA + worker efficiency

Worker deve exportar:

```text
active_jobs
available_slots
jobs_completed
jobs_failed
average_duration
provider_latency
```

Preparar futura métrica:

```text
nats_pending_messages
```

para backlog-based autoscaling.

---

# 40. Resource allocation

Default:

```yaml
resources:
  requests:
    cpu: 500m
    memory: 512Mi

  limits:
    cpu: "2"
    memory: 2Gi
```

Ajustar depois de benchmarks.

FlareSolverr continua serviço externo existente.

Não executar browser dentro de worker se FlareSolverr já resolve necessidade.

---

# 41. Network policies

Worker precisa acessar:

```text
NATS
PostgreSQL
Infisical integration
SearXNG
FlareSolverr
AI Gateway
Object Storage
DNS
public internet
```

Não precisa receber tráfego externo.

Ingress:

```text
NONE
```

Health/metrics:

```text
ClusterIP only
```

---

# 42. Pod security

```yaml
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
  seccompProfile:
    type: RuntimeDefault
```

Adicionar:

```text
/tmp emptyDir
```

para temporários.

---

# 43. Docker

Criar multi-stage Dockerfile.

Local:

```bash
docker compose up
```

Pode subir mocks ou infra mínima para testes.

Produção:

```text
Helm → Kubernetes
```

Docker Compose nunca é produção.

---

# 44. Observabilidade

Primeiro reutilizar stack existente.

Exportar:

```text
Prometheus metrics
OpenTelemetry
JSON logs
```

Métricas:

```text
enrichment_jobs_total
enrichment_jobs_completed_total
enrichment_jobs_failed_total
enrichment_job_duration_seconds

enrichment_provider_requests_total
enrichment_provider_failures_total
enrichment_provider_latency_seconds

enrichment_flaresolverr_requests_total
enrichment_flaresolverr_fallback_total

enrichment_ai_requests_total
enrichment_ai_failures_total
enrichment_ai_tokens_total

enrichment_domains_found_total
enrichment_websites_found_total
```

Não usar:

```text
CNPJ
company_id
tenant_id
```

como labels Prometheus.

---

# 45. E2E crítico

Primeiro vertical slice:

```text
publish NATS request
↓
worker A receives
↓
job persisted
↓
worker A starts enrichment
↓
kill worker A
↓
JetStream ACK timeout
↓
worker B receives
↓
lease stale/takeover
↓
pipeline restarts from beginning
↓
result produced
↓
PostgreSQL transaction
↓
Outbox
↓
completed event
↓
ACK
```

Só depois expandir providers.

---

# 46. Teste FlareSolverr

Fixture/test environment deve provar:

```text
normal HTTP success
→ não usa FlareSolverr
```

e:

```text
normal HTTP receives compatible blocking response
↓
fallback
↓
FlareSolverr
↓
public page retrieved
```

Sem testes envolvendo bypass de login/CAPTCHA restritivo.

---

# 47. Teste horizontal

Publicar:

```text
1000 events
```

Executar múltiplos workers.

Validar:

```text
todos processados
nenhum perdido
nenhum resultado final duplicado
distribuição entre pods
backpressure
provider rate limits
```

---

# 48. Restart completo

Teste:

```text
200 events
↓
iniciar processamento
↓
kill deployment
↓
restart deployment
↓
todos eventos incompletos retomados
↓
zero loss
```

---

# 49. Guardrails

Criar:

```text
AGENTS.md

docs/
  ARCHITECTURE.md
  INFRASTRUCTURE_INVENTORY.md
  ENGINEERING_GUARDRAILS.md
  ENRICHMENT_POLICY.md
  SECURITY.md
  EVENT_CONTRACTS.md
  SCORING.md
  PROVIDERS.md
  AI_POLICY.md
  OPERATIONS.md
  DEPLOYMENT.md
```

---

# 50. AGENTS.md

Regras mínimas:

```text
Reuse existing VPS infrastructure.

Never provision duplicate NATS/PostgreSQL/Infisical/SearXNG/FlareSolverr.

Production deploy happens through Kubernetes + Helm.

Secrets belong exclusively in existing Infisical.

Never hardcode credentials.

Workers must be restart-safe.

NATS delivery is at-least-once.

Final persistence must be idempotent.

Do not ACK before durable completion.

All concurrency must be bounded.

All external calls require timeout.

Respect provider rate limits.

Use normal HTTP before FlareSolverr.

FlareSolverr only for publicly accessible resources.

Never use FlareSolverr to bypass authorization/login/paywalls.

Never scrape authenticated/private pages.

Never perform invasive scans.

Never fabricate enrichment results.

Every inferred fact requires confidence.

Every discovered fact requires evidence.

Do not represent estimated revenue as factual revenue.

Use existing AI gateway.

Prefer:
gpt-4.1-mini
deepseek-v4-flash-0731
kimi-k2.6

Avoid unnecessary LLM calls.

No business REST API.

No state critical to local filesystem.

No unbounded retries.

No infinite message redelivery.
```

---

# 51. Production deploy flow

Obrigatório:

```text
local tests
↓
Docker build
↓
unit tests
↓
integration tests
↓
E2E tests
↓
helm lint
↓
helm template
↓
inspect cluster dependencies
↓
verify Infisical secrets
↓
deploy Helm to VPS Kubernetes
↓
wait rollout
↓
readiness checks
↓
publish synthetic enrichment event
↓
verify completion
↓
verify metrics/logs
```

---

# 52. Rollback

Helm deployment deve suportar:

```bash
helm history
helm rollback
```

Não executar migration destrutiva automaticamente.

Migrations devem ser backward-compatible quando possível.

---

# 53. Definition of Done

```text
[ ] Existing VPS infrastructure inventoried
[ ] Existing NATS reused
[ ] Existing PostgreSQL reused
[ ] Existing Infisical reused
[ ] Existing SearXNG reused
[ ] Existing FlareSolverr reused
[ ] Existing AI gateway reused

[ ] gpt-4.1-mini supported
[ ] deepseek-v4-flash-0731 supported
[ ] kimi-k2.6 supported
[ ] LLM fallback configurable

[ ] NATS worker implemented
[ ] Durable consumer
[ ] Pull-based processing
[ ] Explicit ACK
[ ] Restart from zero works
[ ] Worker crash recovery works
[ ] Horizontal scaling works
[ ] HPA works
[ ] Backpressure works
[ ] Distributed provider limits considered
[ ] Outbox works
[ ] Idempotency works
[ ] Job lease works
[ ] DLQ works

[ ] Firmographic analysis
[ ] Domain discovery
[ ] Domain validation
[ ] Website discovery
[ ] HTTP crawler
[ ] FlareSolverr fallback
[ ] Digital presence
[ ] Technology detection
[ ] Launch velocity
[ ] Operational readiness
[ ] Commercial potential
[ ] Buying intent
[ ] AI business analysis
[ ] Evidence persistence

[ ] Docker local test passes
[ ] Helm lint passes
[ ] Helm template passes
[ ] Kubernetes deploy to VPS passes
[ ] Synthetic production smoke test passes

[ ] Multi-worker 1000-event test passes
[ ] Full deployment restart test passes
[ ] No lost events
[ ] No duplicate final enrichments
```

---

# 54. Ordem de implementação

## Fase 0 — Discovery

```text
inspect VPS cluster
inspect Helm releases
inspect namespaces
inspect NATS
inspect PostgreSQL
inspect Infisical
inspect SearXNG
inspect FlareSolverr
inspect AI Gateway
inspect Object Storage
inspect observability
```

Não implementar nova infraestrutura antes disso.

---

## Fase 1 — Durability skeleton

Implementar somente:

```text
NATS
↓
Worker
↓
PostgreSQL Job
↓
intentional failure
↓
redelivery
↓
restart from zero
↓
result
↓
Outbox
↓
NATS completion
```

Provar durabilidade.

---

## Fase 2 — Horizontal workers

```text
multiple pods
bounded concurrency
worker lease
heartbeats
graceful shutdown
HPA
```

---

## Fase 3 — Basic enrichment

```text
firmographics
DNS
RDAP
domain discovery
domain validation
```

---

## Fase 4 — Web intelligence

```text
SearXNG
HTTP crawler
FlareSolverr fallback
digital presence
technologies
contacts
```

---

## Fase 5 — Intelligence

```text
launch velocity
operational readiness
commercial potential
buying intent
LLM analysis
```

---

## Fase 6 — Production hardening

```text
provider rate limiting
circuit breakers
metrics
tracing
security
load tests
restart tests
```

---

## Fase 7 — VPS Production

```text
Helm deploy
Infisical integration
Kubernetes rollout
smoke test
monitoring
rollback validation
```

---

# 55. Critical invariants

Never violate:

```text
Infrastructure existing > new infrastructure

Infisical > Kubernetes plaintext secrets

NATS events > REST business API

durable state > local state

at-least-once + idempotency > assumed exactly-once

normal HTTP > FlareSolverr

public data only > bypassing access controls

deterministic code > unnecessary LLM

evidence > hallucination

horizontal scale > giant single worker
```

Start with **Fase 0**.

Do not modify cluster until infrastructure inventory is complete.

Then implement **Fase 1** and prove crash/restart semantics before building enrichment features.