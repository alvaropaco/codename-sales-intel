// =============================================================================
// discovery/orchestrator.js — fan-out/fan-in do Discovery Engine (T015).
//
// Um job de discovery = N runs de provider independentes (SC-001): timeout,
// retry TRANSIENT com backoff, budget por provider e fallback com precedência
// self-hosted (T039/T040) são por-RUN; falha de um provider NUNCA derruba o
// job — vira partial. Toda persistência é via persistence.js (idempotente).
// NATS é injetado (`publish`): in-process no v1, o contrato discovery.*.v1
// já permite mover a execução para worker sem mudar contrato.
// =============================================================================

const contracts = require('./contracts');
const { createDiscoveryPersistence } = require('./persistence');
const normalizer = require('./normalizer');
const { candidateConfidence } = require('./confidence');
const { scoreIcp } = require('./icp');
const { deriveSignals } = require('./enrichers/signals');
const metrics = require('../metrics');

const SLEEP_DEFAULT = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Registro dos providers nativos; adapters falham NOT_CONFIGURED fora do ar. */
function nativeProviderMap(overrides = {}) {
  const map = {};
  for (const name of Object.keys(contracts.PROVIDER_CATALOG)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    map[name] = require(`./providers/${name}`);
  }
  return { ...map, ...overrides };
}

function createDiscoveryOrchestrator({
  prisma,
  publish = null,
  providerMap = null,
  registry = null,
  now = () => new Date(),
  sleep = SLEEP_DEFAULT,
  logger = console,
  maxConcurrency = contracts.DEFAULTS.concurrency,
} = {}) {
  const providers = providerMap || nativeProviderMap();
  const persistence = createDiscoveryPersistence({ prisma, now });
  // Providers já escalados por job (fila + fallback não podem duplicar run).
  const handledByJob = new Map(); // jobId → Set(providerName)

  // ── Criação do job (API) ──────────────────────────────────────────────────
  async function createJob({ orgId, trigger = 'api', criteria = null, seed = null, providers: enabled = null, providerOverrides = null }) {
    validateSeed({ criteria, seed });
    const enabledNames = Array.isArray(enabled) && enabled.length ? enabled : Object.keys(contracts.PROVIDER_CATALOG);
    for (const name of enabledNames) {
      if (!contracts.PROVIDER_CATALOG[name]) {
        const err = new Error(`provider desconhecido: ${name}`);
        err.code = 'DISCOVERY_INVALID_INPUT';
        throw err;
      }
    }
    const providerConfig = contracts.buildProviderConfig(enabledNames, providerOverrides);
    const job = await persistence.createJob({ orgId, trigger, criteria, seed, providerConfig });
    if (publish) {
      publish(contracts.buildJobRequestedMessage({
        version: contracts.VERSION,
        jobId: job.id,
        orgId,
        trigger,
        criteria,
        seed,
        providers: enabledNames,
        requestedAt: now().toISOString(),
      }));
    }
    return job;
  }

  function validateSeed({ criteria, seed }) {
    if (!criteria && !seed) {
      const err = new Error('criteria ou seed obrigatório');
      err.code = 'DISCOVERY_INVALID_INPUT';
      throw err;
    }
    if (seed && seed.domain) {
      const domain = normalizer.normalizeDomain(seed.domain);
      if (!domain) {
        const err = new Error(`seed.domain inválido: ${seed.domain}`);
        err.code = 'DISCOVERY_INVALID_INPUT';
        throw err;
      }
    }
    if (seed && seed.cnpj && !normalizer.normalizeCnpj(seed.cnpj)) {
      const err = new Error(`seed.cnpj inválido: ${seed.cnpj}`);
      err.code = 'DISCOVERY_INVALID_INPUT';
      throw err;
    }
  }

  // ── Execução do job (worker ou in-process) ────────────────────────────────
  async function runJob(jobId, orgId) {
    const job = await persistence.getJob(jobId, orgId);
    if (!job) return null;
    if (['running', 'completed', 'partial'].includes(job.status)) return job; // idempotente
    await persistence.startJob(jobId, orgId);

    const enabled = contracts.enabledProviders(job.providerConfig);
    await runProviders({ job, providerNames: enabled });
    const finalJob = await persistence.recomputeJob(jobId, orgId);
    if (finalJob) {
      metrics.incDiscoveryJobFinished(finalJob.status);
      await persistJobSignals(finalJob);
    }
    return persistence.getJob(jobId, orgId);
  }

  /** Fan-out com limite de concorrência; cada provider é isolado. */
  async function runProviders({ job, providerNames }) {
    const queue = [...providerNames];
    const workers = Array.from({ length: Math.min(maxConcurrency, queue.length) }, async () => {
      while (queue.length) {
        const name = queue.shift();
        try {
          await runProvider({ job, providerName: name });
        } catch (err) {
          // Rede de segurança: o run já foi finalizado como failed pelo próprio
          // executor; nada aqui pode derrubar os demais providers (SC-001).
          logger.warn && logger.warn(`[discovery] provider ${name} exception: ${err.message}`);
        }
      }
    });
    await Promise.all(workers);
  }

  /**
   * Executa UM provider com fallback/retry/budget. Status finais do run:
   * completed | failed | skipped (NOT_CONFIGURED/BUDGET_EXHAUSTED/sem semente).
   */
  async function runProvider({ job, providerName }) {
    // Dedup: provider já escalado neste job (fila ∩ fallback) sai sem run.
    let handled = handledByJob.get(job.id);
    if (!handled) { handled = new Set(); handledByJob.set(job.id, handled); }
    if (handled.has(providerName)) return;
    handled.add(providerName);

    const config = (job.providerConfig && job.providerConfig[providerName]) || contracts.providerDefaults(providerName);
    const module = providers[providerName];
    const orgId = job.orgId;
    const jobId = job.id;
    const { criteria, seed } = job.query || {};

    // Todo provider escalado ganha run visível (mesmo skipped) — progresso na API.
    const run = await persistence.startRun({ orgId, jobId, provider: providerName, capability: contracts.PROVIDER_CATALOG[providerName].capabilities[0] });
    const started = now();
    let attempt = run.attempt || 1;
    let requests = 0;
    let estimatedCost = 0;
    let lastError = null;

    const input = deriveInput(providerName, { criteria, seed });
    if (!input) {
      await finishAndEmit({ job, providerName, orgId, jobId, runId: run.id, status: 'skipped', errorCode: 'INVALID_INPUT', errorMessage: 'sem semente aplicável' });
      return;
    }

    // Provider não configurado → skipped + fallback para alternativa (T040).
    if (typeof module.isConfigured === 'function' && !module.isConfigured()) {
      await finishAndEmit({ job, providerName, orgId, jobId, runId: run.id, status: 'skipped', errorCode: 'NOT_CONFIGURED', errorMessage: 'credenciais ausentes' });
      await maybeFallback({ job, providerName, input });
      return;
    }

    while (attempt <= (config.retries || 0) + 1) {
      // ── Budget (T042): maxRequests do snapshot do job (0 = sem orçamento) ─
      const maxRequests = config.maxRequests != null ? config.maxRequests : Infinity;
      if (requests >= maxRequests) {
        await finishAndEmit({ job, providerName, orgId, jobId, runId: run.id, attempt, status: 'skipped', errorCode: 'BUDGET_EXHAUSTED', errorMessage: `maxRequests=${config.maxRequests}`, items: 0, requests, estimatedCost });
        await maybeFallback({ job, providerName, input });
        return;
      }
      try {
        if (registry) {
          const admission = await registry.acquire(providerName);
          if (!admission.ok) {
            const e = new Error(`provider recusado: ${admission.reason}`);
            e.code = admission.reason === 'RATE_LIMIT' ? 'RATE_LIMIT' : 'PROVIDER_CIRCUIT_OPEN';
            throw e;
          }
        }
        const result = await withTimeout(Promise.resolve(module.execute(input, { timeoutMs: config.timeoutMs })), config.timeoutMs);
        requests += result.requests || 1;
        estimatedCost += result.estimatedCost || 0;
        const counts = await persistObservations({ orgId, jobId, runId: run.id, provider: providerName, items: result.items || [], criteria: (job.query && job.query.criteria) || null });
        await finishAndEmit({
          job, providerName, orgId, jobId, runId: run.id, attempt,
          status: 'completed', items: counts.items, entities: counts.entities,
          candidates: counts.candidates, requests, estimatedCost,
          partial: Boolean(result.partial),
          durationMs: now() - started,
        });
        return;
      } catch (err) {
        lastError = err;
        const transient = contracts.isTransientError(err.code);
        if (!transient || attempt > (config.retries || 0)) break;
        await sleep(Math.min(500 * 2 ** (attempt - 1), 8000)); // backoff exponencial capado
        attempt += 1;
      }
    }

    const code = lastError && contracts.ERROR_TAXONOMY.TRANSIENT.concat(contracts.ERROR_TAXONOMY.PERMANENT).includes(lastError.code)
      ? lastError.code : 'INTERNAL';
    await finishAndEmit({
      job, providerName, orgId, jobId, runId: run.id, attempt,
      status: 'failed',
      errorCode: code, errorMessage: lastError && lastError.message,
      requests, estimatedCost,
      durationMs: now() - started,
    });
    await maybeFallback({ job, providerName, input });
  }

  /** Fallback para alternativa habilitada da MESMA capability (T040). */
  async function maybeFallback({ job, providerName, input }) {
    const capabilities = contracts.PROVIDER_CATALOG[providerName].capabilities;
    const used = new Set([providerName]);
    for (const capability of capabilities) {
      const alternatives = contracts.enabledProviders(job.providerConfig).filter((name) =>
        !used.has(name) && contracts.PROVIDER_CATALOG[name].capabilities.includes(capability));
      for (const alt of alternatives) {
        const altConfig = job.providerConfig[alt] || {};
        if (altConfig.dailyBudget != null && altConfig.dailyBudget <= 0) continue; // budget da org zerou
        used.add(alt);
        await runProvider({ job, providerName: alt });
        return;
      }
    }
  }

  function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error(`provider excedeu ${timeoutMs}ms`);
        e.code = 'TIMEOUT';
        reject(e);
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // ── Persistência das observações → entidades/evidências/candidatos (T044) ─
  async function persistObservations({ orgId, jobId, runId, provider, items, criteria = null }) {
    let entities = 0;
    const evidenceConfidences = [];
    const companyEntities = [];

    for (const obs of items || []) {
      const canonical = obs.canonicalKey || normalizer.canonicalKey(obs.entityType, obs.value);
      const { entity, evidence } = await persistence.recordObservation({
        orgId, jobId, providerRunId: runId,
        entityType: obs.entityType,
        canonicalKey: canonical,
        displayName: obs.displayName || null,
        attributes: obs.attributes || {},
        evidence: {
          evidenceType: obs.evidenceType,
          sourceProvider: obs.sourceProvider,
          sourceUrl: obs.sourceUrl || null,
          sourceRef: obs.sourceRef || null,
          observedValue: obs.attributes || { value: obs.value },
          observedAt: obs.observedAt || null,
          confidence: obs.confidence,
        },
      });

      // Relações apontam para entidades REAIS: cria/recupera a entidade alvo.
      for (const rel of (obs.related || [])) {
        const relKey = normalizer.canonicalKey(rel.entityType, rel.value);
        if (!relKey || !entity) continue;
        const metadata = rel.rel && typeof rel.rel === 'object' && !Array.isArray(rel.rel) ? rel.rel : {};
        const target = await persistence.upsertEntity({
          orgId,
          type: rel.entityType,
          canonicalKey: relKey,
          displayName: rel.displayName || null,
          attributes: { ...metadata, ...(rel.attributes || {}) },
          confidence: rel.confidence != null ? rel.confidence : obs.confidence,
        });
        if (target) {
          await persistence.upsertRelationship({
            orgId,
            fromEntityId: entity.id,
            toEntityId: target.id,
            type: rel.type,
            confidence: rel.confidence != null ? rel.confidence : obs.confidence,
            metadata,
            observedAt: obs.observedAt || null,
          });
        }
      }

      if (entity) entities += 1;
      if (evidence && !evidence.duplicated) metrics.incDiscoveryEvidence();
      if (entity && obs.entityType === 'company') companyEntities.push({ entity, obs });
      evidenceConfidences.push(obs.confidence);
    }

    // ── Candidatos: toda empresa descoberta vira projeção de venda (T044) ──
    // Com pontuação ICP (T060): match contra criteria do onboarding.
    let candidates = 0;
    for (const { entity, obs } of companyEntities) {
      const key = companyDedupeKey(entity);
      if (!key) continue;
      const icpScore = scoreIcp(obs.attributes || {}, criteria);
      const candidate = await persistence.upsertCandidate({
        orgId, jobId,
        companyEntityId: entity.id,
        cnpj: (entity.attributes && entity.attributes.cnpjDigits) || null,
        name: entity.displayName,
        location: {
          city: (obs.attributes && obs.attributes.city) || null,
          state: (obs.attributes && obs.attributes.state) || null,
          industry: (obs.attributes && obs.attributes.industry) || null,
          icpScore,
        },
        confidence: candidateConfidence([obs.confidence], { sources: 1, hasOfficialCnpj: obs.sourceProvider === 'cnpj-mcp' }),
        dedupeKey: key,
        evidenceCount: 1,
      });
      if (candidate) {
        candidates += 1;
        metrics.incDiscoveryCandidates();
        if (publish) {
          publish(contracts.buildCandidateUpsertedMessage({
            version: contracts.VERSION,
            candidateId: candidate.id,
            jobId, orgId,
            companyEntityId: entity.id,
            dedupeKey: key,
            upsertedAt: now().toISOString(),
          }));
        }
      }
    }

    const itemsCount = (items || []).length;
    return { items: itemsCount, entities, candidates };
  }

  function companyDedupeKey(entity) {
    if (entity.canonicalKey && entity.canonicalKey.startsWith('cnpj:')) return entity.canonicalKey;
    const nameKey = entity.displayName ? normalizer.nameKey(entity.displayName) : null;
    return nameKey ? `name:${nameKey}` : null;
  }

  // ── Finalização + eventos ─────────────────────────────────────────────────
  async function finishAndEmit({ job, providerName, orgId, jobId, runId = null, attempt = 1, status, items = 0, entities = 0, candidates = 0, requests = 0, estimatedCost = 0, errorCode = null, errorMessage = null, partial = false, durationMs = 0 }) {
    await persistence.finishRun({ orgId, jobId, provider: providerName, status, items, requests, estimatedCost, errorCode, errorMessage });
    metrics.incDiscoveryProviderRun(providerName, status);
    metrics.observeDiscoveryProviderDuration(providerName, durationMs);
    metrics.incDiscoveryEstimatedCost(estimatedCost);
    if (!publish) return;
    const base = {
      version: contracts.VERSION,
      runId: runId || `${jobId}:${providerName}`,
      jobId, orgId,
      provider: providerName,
      capability: (contracts.PROVIDER_CATALOG[providerName] || {}).capabilities ? contracts.PROVIDER_CATALOG[providerName].capabilities[0] : null,
      attempt,
    };
    if (status === 'completed') {
      publish(contracts.buildProviderCompletedMessage({
        ...base,
        status: partial ? 'PARTIAL' : 'COMPLETED',
        counts: { items, entities, candidates },
        durationMs: 0,
        estimatedCost,
        completedAt: now().toISOString(),
      }));
    } else {
      publish(contracts.buildProviderFailedMessage({
        ...base,
        errorCode: errorCode || 'INTERNAL',
        errorMessage,
        requests,
        estimatedCost,
        failedAt: now().toISOString(),
      }));
    }
  }

  // ── Sinais do job: empresas tocadas pelo job recebem projeções (T037) ─────
  async function persistJobSignals(job) {
    const companies = await prisma.discoveryEntity.findMany({
      where: { orgId: job.orgId, type: 'company', lastSeenAt: { gte: job.startedAt || job.createdAt } },
    });
    for (const company of companies.slice(0, contracts.DEFAULTS.maxCandidates)) {
      const intelligence = await persistence.getCompanyIntelligence({ orgId: job.orgId, entityId: company.id });
      // funding: evidências de rodada (provider funding) → sinal recent_funding.
      const rounds = intelligence.evidence
        .filter((ev) => ev.sourceProvider === 'funding' && ev.observedValue && ev.observedValue.stage)
        .map((ev) => ({
          name: ev.observedValue.stage,
          stage: ev.observedValue.stage,
          amount: ev.observedValue.amount,
          currency: ev.observedValue.currency,
          announcedAt: ev.observedValue.announcedAt || (ev.observedAt && ev.observedAt.toISOString()),
          confidence: ev.confidence,
          evidenceId: ev.id,
        }));
      const signals = deriveSignals({
        financial: rounds.length ? { funding: rounds } : null,
        legal: null,
        digital: null,
        now,
      });
      for (const signal of signals) {
        await persistence.upsertSignal({ orgId: job.orgId, companyEntityId: company.id, ...signal });
      }
    }
  }

  return {
    createJob,
    runJob,
    runProvider,
    persistence,
    persistObservations,
    deriveInput,
  };
}

// ── Derivação de semente por provider (fan-out dirigido) ────────────────────

/** Input específico por provider; null = sem semente aplicável (run skipped). */
function deriveInput(providerName, { criteria, seed }) {
  const domain = seed && seed.domain ? normalizer.normalizeDomain(seed.domain) : null;
  const cnpj = seed && seed.cnpj ? normalizer.normalizeCnpj(seed.cnpj) : null;
  const query = buildQuery({ criteria, seed });

  switch (providerName) {
    case 'cnpj-mcp':
      if (cnpj) return { cnpj };
      if (criteria && (criteria.cnae || criteria.state || criteria.city || criteria.legalNameContains || criteria.status)) {
        return { criteria, limit: 20 };
      }
      if (query) return { query, limit: 20 };
      return null;
    case 'searxng':
    case 'serper':
    case 'brave':
    case 'exa':
      return query ? { query } : null;
    case 'crtsh':
    case 'dns-rdap':
    case 'projectdiscovery':
    case 'http-metadata':
    case 'spiderfoot':
      return domain ? { domain } : null;
    case 'jusbrasil':
    case 'escavador':
      if (cnpj) return { cnpj };
      if (criteria && criteria.legalNameContains) return { companyName: criteria.legalNameContains };
      return null;
    case 'cvm':
    case 'funding':
      return cnpj ? { cnpj } : null;
    default:
      return null;
  }
}

function buildQuery({ criteria, seed }) {
  if (seed && seed.query) return String(seed.query);
  if (seed && seed.domain) return null; // buscas de domínio não usam web.search
  if (!criteria) return null;
  const parts = [];
  if (criteria.legalNameContains) parts.push(criteria.legalNameContains);
  if (criteria.query) parts.push(criteria.query);
  if (criteria.cnae) parts.push(criteria.cnae);
  if (criteria.city) parts.push(criteria.city);
  if (criteria.state) parts.push(criteria.state);
  return parts.length >= 2 || (parts.length && (criteria.legalNameContains || criteria.query)) ? parts.join(' ') : null;
}

module.exports = { createDiscoveryOrchestrator, deriveInput, buildQuery, nativeProviderMap };
