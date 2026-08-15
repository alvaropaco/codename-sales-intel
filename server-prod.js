const express = require('express');
const { PrismaClient } = require('@prisma/client');

// Minimal .env loader (no dotenv dependency): loads KEY=VALUE pairs from
// .env and .env.local, never overriding variables already in the environment.
// .env.local holds local secrets and is excluded from version control.
const fsLoadEnv = require('fs');
const pathLoadEnv = require('path');
(function loadEnvFile() {
  const files = ['.env', '.env.local'];
  for (const file of files) {
    try {
      const envPath = pathLoadEnv.join(__dirname, file);
      if (!fsLoadEnv.existsSync(envPath)) continue;
      const lines = fsLoadEnv.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
          process.env[key] = value;
        }
      }
    } catch (_err) {
      // ignore: environment is already configured
    }
  }
})();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

const path = require('path');
const fs = require('fs');
const {
  searchCompanies,
  filterCompanies,
  getCompanyByCnpj,
  getDatasetStats,
} = require('./mcp-cnpj');
const {
  enrichProspectWithCnpj,
  hydrateFirmographics,
  listEnrichedProspects,
  formatEnrichedProspect
} = require('./cnpj-enrichment');
const natsEnrichment = require('./nats-enrichment');
const firebaseAuth = require('./firebase-auth');

// Middleware
// Self-hosted Firebase Auth callback endpoints. Registered before the body
// parsers so raw OAuth POSTs to /__/auth/* can be forwarded untouched.
app.use('/__/auth', firebaseAuth.createFirebaseAuthHandlerProxy());
app.use(express.json());
app.use(firebaseAuth.cookieParserMiddleware);
app.use(express.static(path.join(__dirname, 'apps', 'web', 'dist')));
app.use(express.static('public'));

// ============================================================================
// AUTHENTICATION
// ============================================================================
// /api/auth/* é público (login/logout/resolver sessão); todo o restante de /api
// exige um cookie de sessão válido emitido após a verificação do Firebase ID token.
app.use('/api/auth', firebaseAuth.createAuthRouter(prisma));
app.use('/api', firebaseAuth.createRequireAuth(prisma));

// Dashboard route - serve enterprise React UI when built, fallback to legacy HTML
app.get('/', async (req, res) => {
  const reactDashboardPath = path.join(__dirname, 'apps', 'web', 'dist', 'index.html');
  if (fs.existsSync(reactDashboardPath)) {
    return res.sendFile(reactDashboardPath);
  }

  const dashboardPath = path.join(__dirname, 'public', 'dashboard.html');
  if (fs.existsSync(dashboardPath)) {
    return res.sendFile(dashboardPath);
  }
  
  res.json({ success: true, message: 'SalesIntel Dashboard' });
});

// Validate database connection without creating demo data
async function initDatabase() {
  try {
    await prisma.$connect();
    console.log('✅ Database connection ready');
    return null;
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
}

async function getOrCreateOrganization(orgId) {
  if (orgId) return orgId;

  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Organização principal' }
    });
  }
  return org.id;
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function emptyCommercialProfile() {
  return {
    id: null,
    orgId: null,
    onboardingCompleted: false,
    companyName: '',
    salesTeamSize: '',
    targetSegments: [],
    targetCnaes: [],
    targetLocations: [],
    companyStatuses: ['active'],
    targetSizes: [],
    ageRanges: [],
    averageTicket: null,
    salesCycle: '',
    valueProposition: '',
    createdAt: null,
    updatedAt: null,
  };
}

function formatCommercialProfile(settings, organization) {
  if (!settings) return { ...emptyCommercialProfile(), companyName: organization?.name || '' };

  return {
    id: settings.id,
    orgId: settings.orgId,
    onboardingCompleted: settings.onboardingCompleted,
    companyName: settings.companyName || organization?.name || '',
    salesTeamSize: settings.salesTeamSize || '',
    targetSegments: Array.isArray(settings.targetSegments) ? settings.targetSegments : [],
    targetCnaes: Array.isArray(settings.targetCnaes) ? settings.targetCnaes : [],
    targetLocations: Array.isArray(settings.targetLocations) ? settings.targetLocations : [],
    companyStatuses: Array.isArray(settings.companyStatuses) && settings.companyStatuses.length ? settings.companyStatuses : ['active'],
    targetSizes: Array.isArray(settings.targetSizes) ? settings.targetSizes : [],
    ageRanges: Array.isArray(settings.ageRanges) ? settings.ageRanges : [],
    averageTicket: settings.averageTicket,
    salesCycle: settings.salesCycle || '',
    valueProposition: settings.valueProposition || '',
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

function normalizeCommercialProfilePayload(body = {}) {
  return {
    onboardingCompleted: Boolean(body.onboardingCompleted),
    companyName: String(body.companyName || '').trim() || null,
    salesTeamSize: String(body.salesTeamSize || '').trim() || null,
    targetSegments: asStringArray(body.targetSegments),
    targetCnaes: asStringArray(body.targetCnaes),
    targetLocations: asStringArray(body.targetLocations),
    companyStatuses: asStringArray(body.companyStatuses).length ? asStringArray(body.companyStatuses) : ['active'],
    targetSizes: asStringArray(body.targetSizes),
    ageRanges: asStringArray(body.ageRanges),
    averageTicket: body.averageTicket === '' || body.averageTicket === null || body.averageTicket === undefined ? null : Number(body.averageTicket) || null,
    salesCycle: String(body.salesCycle || '').trim() || null,
    valueProposition: String(body.valueProposition || '').trim() || null,
  };
}

let DEFAULT_ORG_ID;

// ============================================================================
// API ENDPOINTS
// ============================================================================

// GET /api/settings/commercial-profile - Commercial preferences and onboarding state
app.get('/api/settings/commercial-profile', async (req, res) => {
  try {
    const org = await prisma.organization.findFirst();
    if (!org) {
      return res.json({ success: true, data: emptyCommercialProfile(), timestamp: new Date().toISOString() });
    }

    const settings = await prisma.commercialSettings.findUnique({ where: { orgId: org.id } });
    res.json({
      success: true,
      data: formatCommercialProfile(settings, org),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/settings/commercial-profile - Save commercial preferences from onboarding/settings
app.put('/api/settings/commercial-profile', async (req, res) => {
  try {
    const data = normalizeCommercialProfilePayload(req.body || {});
    const orgId = await getOrCreateOrganization(req.body?.orgId);

    if (data.companyName) {
      await prisma.organization.update({
        where: { id: orgId },
        data: { name: data.companyName }
      });
    }

    const settings = await prisma.commercialSettings.upsert({
      where: { orgId },
      create: { ...data, orgId },
      update: data,
    });
    const org = await prisma.organization.findUnique({ where: { id: orgId } });

    res.json({
      success: true,
      data: formatCommercialProfile(settings, org),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/prospects - Get all prospects
app.get('/api/prospects', async (req, res) => {
  try {
    const prospects = await prisma.prospect.findMany({
      select: {
        id: true,
        cnpj: true,
        companyName: true,
        status: true,
        opportunityScore: true,
        revenueEstimate: true,
        employees: true,
        industry: true,
        city: true,
        state: true,
        tradeName: true,
        cnpjEmail: true,
        cnpjPhones: true,
        cnpjPartners: true,
        cnpjOpenedAt: true,
        cnpjLegalNature: true,
        enrichmentStatus: true,
        enrichmentSource: true,
        enrichmentError: true,
        enrichmentVersion: true,
        enrichmentSummary: true,
        enrichedAt: true,
        createdAt: true,
        updatedAt: true,
        orgId: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: prospects,
      count: prospects.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/prospects/:id - Get specific prospect
app.get('/api/prospects/:id', async (req, res) => {
  try {
    const prospect = await prisma.prospect.findUnique({
      where: { id: req.params.id }
    });

    if (!prospect) {
      return res.status(404).json({ success: false, error: 'Prospect not found' });
    }

    res.json({ success: true, data: prospect });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/prospects - Create prospect
app.post('/api/prospects', async (req, res) => {
  try {
    const { cnpj, companyName, status, industry, employees, revenueEstimate, orgId } = req.body;

    if (!cnpj || !companyName) {
      return res.status(400).json({ success: false, error: 'CNPJ and company name required' });
    }

    // Use provided orgId or create an organization only when the user saves real data
    const targetOrgId = await getOrCreateOrganization(orgId);

    const prospect = await prisma.prospect.create({
      data: {
        cnpj,
        companyName,
        status: status || 'prospect',
        industry: industry || '',
        employees: employees || 0,
        revenueEstimate: revenueEstimate || 0,
        opportunityScore: 65,
        orgId: targetOrgId
      }
    });

    // Enriquecimento: quando NATS está habilitado, publicamos o pedido para a
    // esteira de "Em Qualificação" (status prospect) e o consumer persiste o
    // resultado de forma assíncrona e idempotente. Caso contrário, cai no
    // enriquecimento síncrono via BrasilAPI (fallback para dev sem NATS).
    let enrichedProspect;
    if (natsEnrichment.isNatsEnabled()) {
      const eventId = await natsEnrichment.requestEnrichment(prisma, prospect);
      if (eventId) {
        // Pedido publicado no pipeline — aguardamos a persistência do worker.
        enrichedProspect = await prisma.prospect.update({
          where: { id: prospect.id },
          data: {
            enrichmentStatus: 'pending',
            enrichmentSource: 'nats.enrichment',
            enrichmentError: null,
          },
        });
        enrichedProspect._enrichmentEventId = eventId;
        // Complemento: hidrata firmografia (telefones/sócios) via BrasilAPI em
        // paralelo, sem sobrescrever o scoring da esteira NATS.
        hydrateFirmographics(prisma, enrichedProspect).catch((err) => {
          console.error('[firmographics] erro ao hidratar (create):', err.message);
        });
      } else {
        // Pipeline indisponível — cai no enriquecimento síncrono BrasilAPI.
        enrichedProspect = await enrichProspectWithCnpj(prisma, prospect);
      }
    } else {
      enrichedProspect = await enrichProspectWithCnpj(prisma, prospect);
    }

    res.json({
      success: true,
      data: enrichedProspect,
      enrichment: {
        status: enrichedProspect.enrichmentStatus,
        source: enrichedProspect.enrichmentSource,
        error: enrichedProspect.enrichmentError
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, error: 'CNPJ already exists' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/prospects/:id/enrich - Enrich a specific prospect CNPJ
app.post('/api/prospects/:id/enrich', async (req, res) => {
  try {
    // Com NATS habilitado, encaminhamos para o pipeline de enriquecimento.
    if (natsEnrichment.isNatsEnabled()) {
      const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
      if (!prospect) return res.status(404).json({ success: false, error: 'Prospect not found' });
      const eventId = await natsEnrichment.requestEnrichment(prisma, prospect);
      const updated = await prisma.prospect.update({
        where: { id: req.params.id },
        data: { enrichmentStatus: 'pending', enrichmentSource: 'nats.enrichment', enrichmentError: null },
      });
      return res.json({
        success: true,
        data: updated,
        enrichment: { status: 'pending', source: 'nats.enrichment', error: null },
        eventId,
        timestamp: new Date().toISOString(),
      });
    }

    const enriched = await enrichProspectWithCnpj(prisma, req.params.id);
    res.json({
      success: true,
      data: enriched,
      enrichment: {
        status: enriched.enrichmentStatus,
        source: enriched.enrichmentSource,
        error: enriched.enrichmentError
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/prospects/:id - Update prospect
app.put('/api/prospects/:id', async (req, res) => {
  try {
    const previous = await prisma.prospect.findUnique({ where: { id: req.params.id } });

    const prospect = await prisma.prospect.update({
      where: { id: req.params.id },
      data: req.body
    });

    // Dispara enriquecimento quando o lead entra na esteira de "Em Qualificação"
    // (status 'prospect'), inclusive ao trocar de coluna no kanban.
    const enteredQualification =
      prospect.status === 'prospect' && (!previous || previous.status !== 'prospect');

    let responseData = prospect;
    if (enteredQualification) {
      if (natsEnrichment.isNatsEnabled()) {
        const eventId = await natsEnrichment.requestEnrichment(prisma, prospect);
        if (!eventId) {
          // Pipeline indisponível — enriquece de forma síncrona via BrasilAPI.
          responseData = await enrichProspectWithCnpj(prisma, prospect);
        }
      } else {
        // NATS desligado: usa o fallback síncrono BrasilAPI, igual ao fluxo de
        // criação. Sem isso, mover uma empresa para "Em Qualificação" não
        // disparava enriquecimento nenhum (ficava 'pending' para sempre).
        responseData = await enrichProspectWithCnpj(prisma, prospect);
      }
    }

    res.json({ success: true, data: responseData });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Prospect not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/prospects/:id - Delete prospect
app.delete('/api/prospects/:id', async (req, res) => {
  try {
    await prisma.prospect.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Prospect deleted' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Prospect not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/analytics/pipeline - Pipeline metrics
app.get('/api/analytics/pipeline', async (req, res) => {
  try {
    const prospects = await prisma.prospect.findMany({
      select: { status: true }
    });

    const qualified = prospects.filter(p => p.status === 'qualified').length;
    const prospect_count = prospects.filter(p => p.status === 'prospect').length;
    const leads = prospects.filter(p => p.status === 'lead').length;
    const total = prospects.length;

    res.json({
      success: true,
      data: {
        total_prospects: total,
        qualified,
        prospects: prospect_count,
        leads,
        qualification_rate: total > 0 ? (qualified / total).toFixed(2) : '0',
        closure_rate: total > 0 ? (qualified / total * 0.85).toFixed(2) : '0'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/analytics/forecast - Revenue forecast
app.get('/api/analytics/forecast', async (req, res) => {
  try {
    const qualified = await prisma.prospect.count({
      where: { status: 'qualified' }
    });

    const avgDeal = 15000;
    const thisMonth = qualified * avgDeal;

    res.json({
      success: true,
      data: {
        this_month: thisMonth,
        next_month: Math.round(thisMonth * 1.15),
        q3_projection: Math.round(thisMonth * 2.5),
        currency: 'BRL'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/analytics/breakdown - Status breakdown
app.get('/api/analytics/breakdown', async (req, res) => {
  try {
    const breakdown = await prisma.prospect.groupBy({
      by: ['status'],
      _count: true,
      _avg: { opportunityScore: true }
    });

    const formatted = breakdown.map(item => ({
      status: item.status,
      count: item._count,
      avg_score: Math.round(item._avg.opportunityScore || 0)
    }));

    res.json({
      success: true,
      data: { breakdown: formatted },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/enrichment/contacts - List enriched contacts, partners and phones by date range
app.get('/api/enrichment/contacts', async (req, res) => {
  try {
    const contacts = await listEnrichedProspects(prisma, {
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
    });

    res.json({
      success: true,
      data: contacts,
      count: contacts.length,
      filters: {
        from: req.query.from || null,
        to: req.query.to || null,
        status: req.query.status || 'all'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/enrichment/extract - Enrich CNPJs already present in PostgreSQL/MCP by createdAt time range
app.post('/api/enrichment/extract', async (req, res) => {
  try {
    const { from, to, refresh = false, limit = 25 } = req.body || {};
    const where = {};

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    if (!refresh) {
      where.OR = [
        { enrichmentStatus: 'pending' },
        { enrichmentStatus: 'error' },
        { enrichmentStatus: 'unavailable' },
        { enrichedAt: null }
      ];
    }

    const prospects = await prisma.prospect.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 25, 50),
    });

    const enriched = [];
    for (const prospect of prospects) {
      // Sequential by design to avoid hammering the public CNPJ service.
      enriched.push(await enrichProspectWithCnpj(prisma, prospect));
    }

    res.json({
      success: true,
      processed: enriched.length,
      data: enriched.map(formatEnrichedProspect),
      filters: { from: from || null, to: to || null, refresh: Boolean(refresh) },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// DISCOVERY (after onboarding) - fetch real companies by CNAE via MCP-CNPJ
// ============================================================================

function getStateFromLocation(location) {
  const match = String(location || '').match(/\(([A-Za-z]{2})\)/);
  return match ? match[1].toUpperCase() : undefined;
}

// Deterministic helpers so the discovery listing can rotate results per "seed"
// (a new seed on "Buscar novamente" reveals a different order) while keeping a
// page stable within the same seed. The MCP-CNPJ source has no offset support,
// so we fetch a wide pool once, cache it briefly, and page through it locally.
function hashSeed(input) {
  let h = 2166136261 >>> 0;
  const str = String(input || '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed(array, seed) {
  const arr = array.slice();
  const rand = mulberry32(hashSeed(seed));
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// In-memory pool cache: same criteria + seed within TTL reuses the fetched MCP
// window, so paging through results does not hit the external server per page.
const discoveryPoolCache = new Map();
const DISCOVERY_POOL_TTL_MS = 10 * 60 * 1000;

// GET /api/discovery/profile - onboarding criteria that drive discovery
app.get('/api/discovery/profile', async (req, res) => {
  try {
    const org = await prisma.organization.findFirst();
    if (!org) {
      return res.json({
        success: true,
        data: { onboardingCompleted: false, targetCnaes: [], targetSegments: [], targetLocations: [], companyStatuses: ['active'], targetSizes: [] },
        timestamp: new Date().toISOString(),
      });
    }
    const settings = await prisma.commercialSettings.findUnique({ where: { orgId: org.id } });
    const profile = settings
      ? {
          onboardingCompleted: settings.onboardingCompleted,
          targetCnaes: Array.isArray(settings.targetCnaes) ? settings.targetCnaes : [],
          targetSegments: Array.isArray(settings.targetSegments) ? settings.targetSegments : [],
          targetLocations: Array.isArray(settings.targetLocations) ? settings.targetLocations : [],
          companyStatuses: Array.isArray(settings.companyStatuses) && settings.companyStatuses.length ? settings.companyStatuses : ['active'],
          targetSizes: Array.isArray(settings.targetSizes) ? settings.targetSizes : [],
        }
      : { onboardingCompleted: false, targetCnaes: [], targetSegments: [], targetLocations: [], companyStatuses: ['active'], targetSizes: [] };

    res.json({ success: true, data: profile, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/discovery/candidates - search real companies by CNAE/segment/location
// Supports pagination (?page=&pageSize=) and seeded rotation (?seed=) so the
// listing can browse through the full pool of discovered leads. Companies that
// were already added to the lead list are always excluded from the results.
app.get('/api/discovery/candidates', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(parseInt(req.query.pageSize, 10) || Number(req.query.limit) || 12, 25));
    const seed = req.query.seed ? String(req.query.seed).slice(0, 64) : 'default';
    const explicitCnae = req.query.cnae ? String(req.query.cnae) : null;
    const explicitSegment = req.query.segment ? String(req.query.segment) : null;
    const explicitLocation = req.query.location ? String(req.query.location) : null;

    let segments = [];
    let locations = [];
    let activeOnly = false;
    let usedProfile = false;

    if (!explicitCnae && !explicitSegment && !explicitLocation) {
      // Fall back to the onboarding profile as the discovery criteria.
      const org = await prisma.organization.findFirst();
      if (org) {
        const settings = await prisma.commercialSettings.findUnique({ where: { orgId: org.id } });
        if (settings) {
          segments = Array.isArray(settings.targetCnaes) ? settings.targetCnaes : [];
          if (!segments.length) segments = Array.isArray(settings.targetSegments) ? settings.targetSegments : [];
          locations = Array.isArray(settings.targetLocations) ? settings.targetLocations : [];
          activeOnly = !Array.isArray(settings.companyStatuses) || settings.companyStatuses.includes('active');
          usedProfile = true;
        }
      }
    } else {
      if (explicitCnae) segments.push(explicitCnae);
      if (explicitSegment) segments.push(explicitSegment);
      if (explicitLocation) locations.push(explicitLocation);
    }

    const state = locations.length ? getStateFromLocation(locations[0]) : undefined;
    const orgId = await getOrCreateOrganization();

    if (!segments.length && !state) {
      return res.json({
        success: true,
        data: [],
        page,
        pageSize,
        total: 0,
        totalPages: 0,
        hasMore: false,
        source: [],
        criteria: { segments, locations, activeOnly, usedProfile },
        message: 'Configure segmentos ou CNAEs no onboarding para descobrir leads.',
        timestamp: new Date().toISOString(),
      });
    }

    // Cache key: same criteria + seed reuses the fetched MCP window (10 min TTL),
    // so paging between pages does not call the external server again.
    const cacheKey = [orgId, segments.join('|'), locations.join('|'), activeOnly ? '1' : '0', seed].join('::');
    let unique = null;
    const cached = discoveryPoolCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      unique = cached.unique;
    } else {
      const candidates = [];

      // 1) Structured CNAE filter when we have codes. Fetch a wide pool (up to the
      //    MCP ceiling of 100) so pagination can show different leads per page.
      for (const code of segments.slice(0, 6)) {
        if (!/^\d+$/.test(code)) continue;
        const filtered = await filterCompanies({
          cnae: code,
          state,
          isActive: activeOnly || undefined,
          limit: 100,
        });
        filtered.forEach((company) => candidates.push(company));
      }

      // 2) Semantic search for segment/natural-language criteria (MCP caps at 40).
      const query = explicitSegment || segments[0] || '';
      if (query && !/^\d+$/.test(query)) {
        const found = await searchCompanies({
          query,
          state,
          limit: 50,
        });
        found.forEach((company) => candidates.push(company));
      }

      const seen = new Set();
      unique = [];
      for (const c of candidates.slice(0, 400)) {
        if (!c || seen.has(c.cnpj)) continue;
        seen.add(c.cnpj);
        unique.push(c);
      }

      discoveryPoolCache.set(cacheKey, { unique, expiresAt: Date.now() + DISCOVERY_POOL_TTL_MS });
      if (discoveryPoolCache.size > 60) {
        const oldestKey = discoveryPoolCache.keys().next().value;
        if (oldestKey) discoveryPoolCache.delete(oldestKey);
      }
    }

    // Always exclude CNPJs already registered as leads (fresh check per request,
    // so an import disappears from the listing immediately).
    const existing = await prisma.prospect.findMany({ select: { cnpj: true } });
    const existingCnpjs = new Set(existing.map((p) => String(p.cnpj).replace(/\D/g, '')));
    const available = unique.filter((c) => !existingCnpjs.has(String(c.cnpj).replace(/\D/g, '')));

    // Rotate deterministically by seed: stable within a seed, different order
    // when the user asks for a fresh batch ("Buscar novamente").
    const pool = shuffleWithSeed(available, seed);

    const total = pool.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const data = pool.slice(start, start + pageSize);

    res.json({
      success: true,
      data,
      page,
      pageSize,
      total,
      totalPages,
      hasMore: page < totalPages,
      source: ['mcp.cnpj'],
      criteria: { segments, locations, activeOnly, usedProfile },
      message: !total
        ? 'Nenhum lead novo encontrado para os critérios atuais. Ajuste o nicho ou a localização.'
        : undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/discovery/import - persist a discovered company as a Prospect
app.post('/api/discovery/import', async (req, res) => {
  try {
    const { cnpj, legalName, tradeName, industry, status, email, city, state, openingDate, legalNature } = req.body || {};
    if (!cnpj || !legalName) {
      return res.status(400).json({ success: false, error: 'CNPJ and company name required' });
    }

    const orgId = await getOrCreateOrganization(req.body?.orgId);
    const normalizedCnpj = String(cnpj).replace(/\D/g, '');

    let prospect = await prisma.prospect.findUnique({ where: { cnpj: normalizedCnpj } });
    if (prospect) {
      return res.json({
        success: true,
        data: formatEnrichedProspect(prospect),
        alreadyExists: true,
        timestamp: new Date().toISOString(),
      });
    }

    prospect = await prisma.prospect.create({
      data: {
        cnpj: normalizedCnpj,
        companyName: legalName || tradeName || normalizedCnpj,
        tradeName: tradeName || null,
        industry: industry || null,
        city: city || null,
        state: state || null,
        cnpjEmail: email || null,
        cnpjOpenedAt: openingDate ? new Date(openingDate) : null,
        cnpjLegalNature: legalNature || null,
        status: status === 'active' ? 'prospect' : 'lead',
        opportunityScore: 60,
        // Não marcamos como 'enriched': a esteira de enriquecimento (NATS) ou o
        // fallback síncrono BrasilAPI é quem completa firmografia + scoring.
        enrichmentStatus: 'pending',
        orgId,
      },
    });

    // Empresas descobertas também entram na esteira de enriquecimento.
    let enriched = prospect;
    if (natsEnrichment.isNatsEnabled()) {
      const eventId = await natsEnrichment.requestEnrichment(prisma, prospect);
      if (eventId) {
        enriched = await prisma.prospect.update({
          where: { id: prospect.id },
          data: { enrichmentStatus: 'pending', enrichmentSource: 'nats.enrichment', enrichmentError: null },
        });
        // Complemento: hidrata firmografia (telefones/sócios) via BrasilAPI em
        // paralelo, sem sobrescrever o scoring da esteira NATS.
        hydrateFirmographics(prisma, enriched).catch((err) => {
          console.error('[firmographics] erro ao hidratar (import):', err.message);
        });
      } else {
        enriched = await enrichProspectWithCnpj(prisma, prospect);
      }
    } else {
      enriched = await enrichProspectWithCnpj(prisma, prospect);
    }

    res.json({
      success: true,
      data: formatEnrichedProspect(enriched),
      alreadyExists: false,
      enrichment: { status: enriched.enrichmentStatus, source: enriched.enrichmentSource },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/prospects/:id/enrich-mcp - enrich an existing prospect via MCP-CNPJ
app.post('/api/prospects/:id/enrich-mcp', async (req, res) => {
  try {
    const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
    if (!prospect) return res.status(404).json({ success: false, error: 'Prospect not found' });

    const company = await getCompanyByCnpj(prospect.cnpj);
    if (!company) {
      return res.json({
        success: true,
        data: prospect,
        enrichment: { status: 'unavailable', source: 'mcp.cnpj', error: 'Company not found in MCP-CNPJ' },
        timestamp: new Date().toISOString(),
      });
    }

    const updated = await prisma.prospect.update({
      where: { id: prospect.id },
      data: {
        companyName: company.legalName || prospect.companyName,
        tradeName: company.tradeName || prospect.tradeName,
        industry: company.industry || prospect.industry,
        cnpjEmail: company.email || prospect.cnpjEmail,
        cnpjOpenedAt: company.openingDate ? new Date(company.openingDate) : prospect.cnpjOpenedAt,
        cnpjLegalNature: company.legalNature || prospect.cnpjLegalNature,
        enrichmentStatus: 'enriched',
        enrichmentSource: 'mcp.cnpj',
        enrichmentError: null,
        enrichedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: formatEnrichedProspect(updated),
      enrichment: { status: 'enriched', source: 'mcp.cnpj' },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/discovery/stats - quick dataset stats from MCP-CNPJ
app.get('/api/discovery/stats', async (req, res) => {
  try {
    const stats = await getDatasetStats();
    res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/enrichment/status/:id - Status do enriquecimento (resultados NATS)
app.get('/api/enrichment/status/:id', async (req, res) => {
  try {
    const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
    if (!prospect) return res.status(404).json({ success: false, error: 'Prospect not found' });

    const results = await prisma.cnpjEnrichment.findMany({
      where: { companyId: prospect.id },
      orderBy: { enrichmentVersion: 'desc' },
    });

    res.json({
      success: true,
      data: {
        prospect: {
          id: prospect.id,
          cnpj: prospect.cnpj,
          enrichmentStatus: prospect.enrichmentStatus,
          enrichmentSource: prospect.enrichmentSource,
          enrichmentError: prospect.enrichmentError,
          enrichmentVersion: prospect.enrichmentVersion,
          enrichedAt: prospect.enrichedAt,
        },
        results,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// SPA fallback: serve index.html for extensionless GET requests that accept
// HTML (e.g. the Firebase OAuth redirect landing page /auth/callback and any
// future client-side routes). API and asset requests keep a 404 JSON response.
app.use((req, res) => {
  if (
    req.method === 'GET' &&
    !req.path.startsWith('/api/') &&
    !req.path.startsWith('/__/') &&
    !path.extname(req.path) &&
    req.accepts('html')
  ) {
    const reactIndexPath = path.join(__dirname, 'apps', 'web', 'dist', 'index.html');
    if (fs.existsSync(reactIndexPath)) {
      return res.sendFile(reactIndexPath);
    }
  }

  res.status(404).json({ success: false, error: 'Route not found' });
});

// Start server
async function start() {
  try {
    DEFAULT_ORG_ID = await initDatabase();

    // Inicia o pipeline NATS (consumer de resultados + monitor de DLQ) quando
    // habilitado. Não bloqueia o boot caso o NATS esteja indisponível.
    if (natsEnrichment.isNatsEnabled()) {
      natsEnrichment.startEnrichmentConsumer(prisma);
      natsEnrichment.startDlqMonitor();
    } else {
      console.log('[nats] NATS desabilitado - usando enriquecimento síncrono BrasilAPI.');
    }

    app.listen(PORT, () => {
      console.log('');
      console.log('╔════════════════════════════════════════════╗');
      console.log('║  SalesIntel Platform - PRODUCTION MODE 🚀  ║');
      console.log('╠════════════════════════════════════════════╣');
      console.log('║                                            ║');
      console.log('║  📊 Database: PostgreSQL (localhost:5432) ║');
      console.log(`║  🌐 Dashboard: http://localhost:${PORT}          ║`);
      console.log('║                                            ║');
      console.log(`║  📡 NATS enrichment: ${natsEnrichment.isNatsEnabled() ? 'ON' : 'OFF'}        ║`);
      console.log('║  🔐 Firebase auth: Google + GitHub (corporate only)     ║');
      console.log('║  ✅ Real data from database (no mock!)     ║');
      console.log('║  ✅ All CRUD operations supported          ║');
      console.log('║  ✅ Error handling & validation            ║');
      console.log('║  ✅ Production-ready code                  ║');
      console.log('║                                            ║');
      console.log('║  Press Ctrl+C to stop                      ║');
      console.log('║                                            ║');
      console.log('╚════════════════════════════════════════════╝');
      console.log('');
    });
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await natsEnrichment.shutdown();
  await prisma.$disconnect();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('\nShutting down (SIGTERM)...');
  await natsEnrichment.shutdown();
  await prisma.$disconnect();
  process.exit(0);
});

start();
