// =============================================================================
// discovery/persistence.js — persistência tenant-scoped e idempotente (T008).
//
// TODA escrita é keyed por orgId e tolerante a redelivery (SC-005): entidades
// por (org, type, canonicalKey), evidência por (org, rawHash), relação por
// (org, from, to, type), candidato por (org, dedupeKey). Valores mutáveis
// preservam observação como EVIDÊNCIA nova — atributos consolidam, provas
// nunca se sobrescrevem (FR-025). Estratégia: find-first → create, com
// P2002 (violação de unique no Prisma real) como backstop de concorrência.
// =============================================================================

const { createHash } = require('crypto');

function stableHash(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function mergeJson(base = {}, patch = {}) {
  return { ...(base || {}), ...(patch || {}) };
}

function maxConfidence(current, next) {
  return Math.max(Number(current) || 0, Number(next) || 0);
}

/** É violação de unique do Prisma (backstop de corrida entre consumidores). */
function isUniqueViolation(err) {
  return err && (err.code === 'P2002' || /unique/i.test(String(err.message)));
}

function createDiscoveryPersistence({ prisma, now = () => new Date() }) {
  // ── Job ───────────────────────────────────────────────────────────────────
  async function createJob({ orgId, trigger, criteria, seed, providerConfig }) {
    const providers = Object.values(providerConfig || {}).filter((c) => c && c.enabled);
    return prisma.discoveryJob.create({
      data: {
        orgId,
        trigger: String(trigger || 'api'),
        status: 'queued',
        query: { criteria: criteria || null, seed: seed || null },
        providerConfig: providerConfig || {},
        providersTotal: providers.length,
        estimatedCost: 0,
      },
    });
  }

  async function getJob(jobId, orgId) {
    return prisma.discoveryJob.findFirst({ where: { id: jobId, orgId } });
  }

  async function startJob(jobId, orgId) {
    return prisma.discoveryJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: now() },
    });
  }

  async function updateJob(jobId, orgId, data) {
    const job = await getJob(jobId, orgId);
    if (!job) return null;
    return prisma.discoveryJob.update({ where: { id: jobId }, data });
  }

  /**
   * Recalcula status/contadores do job a partir dos runs (fonte de verdade).
   * Falha de provider NÃO falha o job (SC-001): tudo rodo → completed;
   * algo falhou mas há entregáveis → partial.
   */
  async function recomputeJob(jobId, orgId) {
    const job = await getJob(jobId, orgId);
    if (!job) return null;
    const runs = await prisma.discoveryProviderRun.findMany({ where: { jobId, orgId } });
    const terminal = runs.filter((r) => ['completed', 'failed', 'skipped'].includes(r.status));
    const done = runs.filter((r) => r.status === 'completed').length;
    const failed = runs.filter((r) => r.status === 'failed').length;
    const items = runs.reduce((sum, r) => sum + (Number(r.items) || 0), 0);
    const cost = runs.reduce((sum, r) => sum + (Number(r.estimatedCost) || 0), 0);

    let status = job.status;
    if (job.status !== 'cancelled' && terminal.length >= runs.length && runs.length > 0) {
      status = failed > 0 ? 'partial' : 'completed';
    }
    return prisma.discoveryJob.update({
      where: { id: jobId },
      data: {
        status,
        providersDone: done,
        providersFailed: failed,
        itemsFound: items,
        estimatedCost: cost,
        completedAt: ['partial', 'completed', 'failed', 'cancelled'].includes(status) ? now() : null,
      },
    });
  }

  // ── Provider run ──────────────────────────────────────────────────────────
  async function startRun({ orgId, jobId, provider, capability }) {
    const existing = await prisma.discoveryProviderRun.findFirst({ where: { jobId, provider } });
    if (existing) {
      return prisma.discoveryProviderRun.update({
        where: { id: existing.id },
        data: { status: 'running', attempt: { increment: 1 }, startedAt: now(), errorCode: null, errorMessage: null },
      });
    }
    return prisma.discoveryProviderRun.create({
      data: { orgId, jobId, provider, capability, status: 'running', attempt: 1, startedAt: now() },
    });
  }

  async function finishRun({ orgId, jobId, provider, status, items = 0, requests = 0, estimatedCost = 0, errorCode = null, errorMessage = null, lastCursor = null }) {
    const run = await prisma.discoveryProviderRun.findFirst({ where: { jobId, provider, orgId } });
    if (!run) return null;
    const updated = await prisma.discoveryProviderRun.update({
      where: { id: run.id },
      data: {
        status,
        items: (Number(run.items) || 0) + (Number(items) || 0),
        requests: (Number(run.requests) || 0) + (Number(requests) || 0),
        estimatedCost: (Number(run.estimatedCost) || 0) + (Number(estimatedCost) || 0),
        errorCode,
        errorMessage,
        lastCursor: lastCursor != null ? lastCursor : run.lastCursor,
        completedAt: now(),
      },
    });
    await recomputeJob(jobId, orgId);
    return updated;
  }

  // ── Entidade canônica (SC-002/SC-005) ─────────────────────────────────────
  async function upsertEntity({ orgId, type, canonicalKey, displayName = null, identifiers = {}, attributes = {}, confidence = 0 }) {
    if (!canonicalKey) return null;
    const existing = await prisma.discoveryEntity.findFirst({ where: { orgId, type, canonicalKey } });
    if (existing) {
      return prisma.discoveryEntity.update({
        where: { id: existing.id },
        data: {
          displayName: displayName || existing.displayName,
          identifiers: mergeJson(existing.identifiers, identifiers),
          attributes: mergeJson(existing.attributes, attributes),
          confidence: maxConfidence(existing.confidence, confidence),
          lastSeenAt: now(),
        },
      });
    }
    try {
      return await prisma.discoveryEntity.create({
        data: {
          orgId, type, canonicalKey,
          displayName,
          identifiers, attributes,
          confidence,
          firstSeenAt: now(), lastSeenAt: now(),
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await prisma.discoveryEntity.findFirst({ where: { orgId, type, canonicalKey } });
      if (!winner) throw err;
      return winner;
    }
  }

  // ── Relação tipada ────────────────────────────────────────────────────────
  async function upsertRelationship({ orgId, fromEntityId, toEntityId, type, confidence = 0, metadata = {}, observedAt = null }) {
    if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) return null;
    const existing = await prisma.discoveryRelationship.findFirst({
      where: { orgId, fromEntityId, toEntityId, type },
    });
    if (existing) {
      return prisma.discoveryRelationship.update({
        where: { id: existing.id },
        data: { confidence: maxConfidence(existing.confidence, confidence), metadata: mergeJson(existing.metadata, metadata), observedAt: observedAt || existing.observedAt },
      });
    }
    try {
      return await prisma.discoveryRelationship.create({
        data: { orgId, fromEntityId, toEntityId, type, confidence, metadata, observedAt },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await prisma.discoveryRelationship.findFirst({ where: { orgId, fromEntityId, toEntityId, type } });
      if (!winner) throw err;
      return winner;
    }
  }

  // ── Evidência imutável (FR-025/SC-005) ────────────────────────────────────
  async function addEvidence({ orgId, jobId = null, providerRunId = null, entityId = null, relationshipId = null, evidenceType, sourceProvider, sourceUrl = null, sourceRef = null, observedValue, observedAt = null, confidence = 0, metadata = {} }) {
    const rawHash = stableHash({ sourceProvider, evidenceType, observedValue, sourceRef });
    const existing = await prisma.discoveryEvidence.findFirst({ where: { orgId, rawHash } });
    if (existing) return { evidence: existing, duplicated: true };
    try {
      const evidence = await prisma.discoveryEvidence.create({
        data: {
          orgId, jobId, providerRunId, entityId, relationshipId,
          evidenceType, sourceProvider, sourceUrl, sourceRef,
          observedValue, observedAt, confidence, rawHash, metadata,
        },
      });
      return { evidence, duplicated: false };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await prisma.discoveryEvidence.findFirst({ where: { orgId, rawHash } });
      if (!winner) throw err;
      return { evidence: winner, duplicated: true };
    }
  }

  /** Observação de fato mutável: entidade + evidência coexistem (FR-025). */
  async function recordObservation({ orgId, jobId, providerRunId, entityType, canonicalKey, displayName, attributes, evidence }) {
    let entity = null;
    if (canonicalKey) {
      entity = await upsertEntity({
        orgId, type: entityType, canonicalKey, displayName,
        attributes, confidence: evidence.confidence,
      });
    }
    const { evidence: saved } = await addEvidence({
      ...evidence,
      orgId, jobId, providerRunId,
      entityId: entity ? entity.id : null,
      observedValue: evidence.observedValue,
      confidence: evidence.confidence,
    });
    if (entity && evidence.relationships) {
      for (const rel of evidence.relationships) {
        await upsertRelationship({
          orgId,
          fromEntityId: rel.fromEntityId || entity.id,
          toEntityId: rel.toEntityId,
          type: rel.type,
          confidence: rel.confidence != null ? rel.confidence : evidence.confidence,
          metadata: rel.metadata || {},
          observedAt: evidence.observedAt || null,
        });
      }
    }
    return { entity, evidence: saved };
  }

  // ── Candidato (projeção de venda) ─────────────────────────────────────────
  async function upsertCandidate({ orgId, jobId, companyEntityId = null, cnpj = null, name = null, domain = null, location = null, confidence = 0, dedupeKey, evidenceCount = 0 }) {
    if (!dedupeKey) return null;
    const existing = await prisma.discoveryCandidate.findFirst({ where: { orgId, dedupeKey } });
    if (existing) {
      return prisma.discoveryCandidate.update({
        where: { id: existing.id },
        data: {
          jobId: existing.jobId || jobId,
          companyEntityId: existing.companyEntityId || companyEntityId,
          cnpj: existing.cnpj || cnpj,
          name: existing.name || name,
          domain: existing.domain || domain,
          location: existing.location || location,
          confidence: maxConfidence(existing.confidence, confidence),
          evidenceCount: Math.max(existing.evidenceCount, evidenceCount),
        },
      });
    }
    try {
      return await prisma.discoveryCandidate.create({
        data: { orgId, jobId, companyEntityId, cnpj, name, domain, location, confidence, dedupeKey, evidenceCount },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await prisma.discoveryCandidate.findFirst({ where: { orgId, dedupeKey } });
      if (!winner) throw err;
      return winner;
    }
  }

  async function listCandidates({ orgId, jobId = null, page = 1, pageSize = 25, minConfidence = 0, status = null, minIcp = null }) {
    const where = {
      orgId,
      confidence: { gte: Number(minConfidence) || 0 },
      ...(jobId ? { jobId } : {}),
      ...(status ? { status } : {}),
    };
    const size = Math.min(Number(pageSize) || 25, 100);
    // Filtro ICP (T060) é sobre JSON aninhado — aplicado em memória após a
    // leitura; volume por org é limitado pela projeção de candidatos (v1).
    let rows = await prisma.discoveryCandidate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    if (minIcp != null && Number.isFinite(Number(minIcp))) {
      rows = rows.filter((r) => r.location && r.location.icpScore != null && r.location.icpScore >= Number(minIcp));
    }
    const skip = (Math.max(1, Number(page) || 1) - 1) * size;
    return { total: rows.length, items: rows.slice(skip, skip + size) };
  }

  async function importCandidate({ orgId, candidateId, prospectId }) {
    const candidate = await prisma.discoveryCandidate.findFirst({ where: { id: candidateId, orgId } });
    if (!candidate) return null;
    // Idempotente: segundo import NÃO troca o vínculo original (SC-005).
    if (candidate.importedProspectId) return candidate;
    return prisma.discoveryCandidate.update({
      where: { id: candidateId },
      data: { status: 'imported', importedProspectId: prospectId },
    });
  }

  // ── Sinal derivado (T037) ─────────────────────────────────────────────────
  async function upsertSignal({ orgId, companyEntityId, type, value = {}, confidence = 0, evidenceIds = [], observedAt = null, expiresAt = null }) {
    const existing = await prisma.discoverySignal.findFirst({
      where: { orgId, companyEntityId, type },
    });
    if (existing) {
      return prisma.discoverySignal.update({
        where: { id: existing.id },
        data: { value, confidence, evidenceIds, observedAt: observedAt || existing.observedAt, expiresAt: expiresAt || existing.expiresAt },
      });
    }
    try {
      return await prisma.discoverySignal.create({
        data: { orgId, companyEntityId, type, value, confidence, evidenceIds, observedAt, expiresAt },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await prisma.discoverySignal.findFirst({ where: { orgId, companyEntityId, type } });
      if (!winner) throw err;
      return winner;
    }
  }

  // ── Leitura para API (T038/T046) ──────────────────────────────────────────
  async function getJobStatus(jobId, orgId) {
    const job = await getJob(jobId, orgId);
    if (!job) return null;
    const runs = await prisma.discoveryProviderRun.findMany({ where: { jobId, orgId } });
    return { job, providers: runs };
  }

  async function getCompanyIntelligence({ orgId, entityId }) {
    const entity = await prisma.discoveryEntity.findFirst({ where: { id: entityId, orgId } });
    if (!entity) return null;
    const [relationships, evidence, signals] = await Promise.all([
      prisma.discoveryRelationship.findMany({
        where: { orgId, fromEntityId: entityId },
      }),
      prisma.discoveryEvidence.findMany({
        where: { orgId, entityId },
        orderBy: { capturedAt: 'desc' },
      }),
      prisma.discoverySignal.findMany({ where: { orgId, companyEntityId: entityId } }),
    ]);
    return { entity, relationships, evidence, signals };
  }

  async function evidenceSummary({ orgId, entityId = null, jobId = null }) {
    const where = { orgId, ...(entityId ? { entityId } : {}), ...(jobId ? { jobId } : {}) };
    const rows = await prisma.discoveryEvidence.findMany({ where });
    const byType = {};
    for (const row of rows) {
      byType[row.evidenceType] = (byType[row.evidenceType] || 0) + 1;
    }
    return { total: rows.length, byType };
  }

  return {
    createJob, getJob, startJob, updateJob, recomputeJob,
    startRun, finishRun,
    upsertEntity, upsertRelationship, addEvidence, recordObservation,
    upsertCandidate, listCandidates, importCandidate,
    upsertSignal,
    getJobStatus, getCompanyIntelligence, evidenceSummary,
  };
}

module.exports = { createDiscoveryPersistence, stableHash };
