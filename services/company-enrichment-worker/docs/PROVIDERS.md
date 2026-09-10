# Providers

All providers reuse existing VPS infrastructure; none are provisioned by this
service. Each provider has a timeout, a per-provider circuit breaker, and a rate
limit. Requests are metered via Prometheus metrics.

## DNS

- Purpose: A/AAAA, MX, NS, TXT/SPF.
- Used by: domain validation, technology detection (mail provider).
- Deterministic; never routed to an LLM.

## RDAP

- Purpose: domain registration, registrar, created/updated/expires.
- Used by: domain validation, launch-velocity (domain age).
- Bootstrap servers per TLD; falls back to `rdap.org`.

## SearXNG (existing)

- Priority search provider for domain discovery.
- Queries are bounded and deduplicated; only public web.
- `SEARXNG_URL` from Infisical.

## Web fetch (httpx) + FlareSolverr fallback

- Normal HTTP first (SSRF-guarded, redirects re-validated).
- 403/anti-bot challenge → bounded FlareSolverr fallback (only public pages).
- `CRAWLER_*` bounds pages/depth/bytes; `FLARESOLVERR_MAX_CONCURRENCY` bounds browsers.
- Never bypasses login/paywalls/authorization.

## AI gateway (LiteLLM, existing)

- OpenAI-compatible; model chain configured via `ENRICHMENT_MODEL_*`.
- Structured JSON output validated with Pydantic.
- Fallback across models; tokens/requests/failures metered.

## BBOT (primary OSINT recon engine, graph mode)

- Bounded subprocess wrapper (`providers/bbot.py`): runs `bbot -t <target>
  --json -om stdout -p <presets> -m <modules> --force -y` with a strict
  module/preset allowlist (subdomain-enum, email-enum, tech-detect, wayback,
  spider presets; certspotter, crt, hackertarget, urlscan, wayback,
  securitytrails, sslcert, securitytxt, dnscommonsrv, dnscaa modules),
  per-scan timeout (`BBOT_TIMEOUT_SECONDS`, default 300, kill on expiry), and a
  hard event cap (`BBOT_MAX_EVENTS`, default 2000).
- Parses BBOT JSON NDJSON (streamed via the `stdout` output module) into
  normalized `BbotEvent`s (DNS_NAME, EMAIL_ADDRESS, TECHNOLOGY, SOCIAL, URL,
  HOST, PHONE_NUMBER, …) that the `bbot` capability maps onto
  entities/facts/relations.
- The OSINT image pre-installs BBOT module dependencies at build time
  (`bbot --install-all-deps`), so the non-root runtime user never hits BBOT's
  `ensure_root`/sudo requirement.
- Installed only in OSINT-enabled images (`docker build --build-arg
  BUILD_WITH_OSINT=true`); `bbot` worker type requires it.
- Public-data modules only; never auth bypass / invasive scanning.

## SpiderFoot (optional, complementary)

- Optional subprocess wrapper (`providers/spiderfoot.py`), disabled by default
  (`SPIDERFOOT_ENABLED=false`). Uses passive modules (sfp_certspotter,
  sfp_crt) for CERTHISTORY / co-hosted site discovery that BBOT does not cover.
- Bounded: per-scan timeout (`SPIDERFOOT_TIMEOUT_SECONDS`, default 600), event
  cap, and an allowlist. Never starts the SpiderFoot web server.

## Entity graph (workers)

- `registry` / `people`: QSA (quadro societário) → people + OWNER_OF /
  DIRECTOR_OF edges; deterministic only.
- `contacts`: email/phone regex extraction from public page text/HTML, bounded
  by the crawler budget.
- `finance`: registry-derived indicators (porte, capital, CNAE) with
  `is_estimate=False`; revenue is never reported as fact.
- Entity canonical keys are deterministic (`services/entity_resolution.py`);
  no LLM is used for the graph tier.

## Error strategy

- `403` → FlareSolverr fallback eligible (public page).
- `429` → respect Retry-After, rate-limited.
- `5xx` → retry (bounded).
- `404` → permanent for URL, continue pipeline.
- BBOT/SpiderFoot timeout/exit ≠ 0 → provider error (transient if timeout), no
  unbounded retries; circuit breaker per provider.
- Circuit breaker states: CLOSED / OPEN / HALF_OPEN.
