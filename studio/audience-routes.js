'use strict';

/**
 * studio/audience-routes.js — declaração de audiência da campanha (T015/US1;
 * US2 estende com segmentId e importação de lista).
 *
 * A audiência é materializada em snapshot imediatamente (membros + motivos
 * de exclusão); a aprovação revalida e congela (FR-013). Lead protegido
 * (supressão/opt-out) NUNCA pode ser incluído — nem manualmente (FR-012).
 */

const campaignService = require('./campaign-service');
const segmentService = require('./segment-service');
const { httpError } = require('./router');

function registerAudienceRoutes(router, context) {
  const { prisma } = context;

  // POST /api/studio/campaigns/:id/audience — define a audiência.
  router.post('/campaigns/:id/audience', async (req, res, next) => {
    try {
      const { orgId } = req.studio;
      const campaign = await prisma.studioCampaign.findUnique({ where: { id: req.params.id } });
      if (!campaign || campaign.orgId !== orgId) {
        const err = new Error('Campanha não encontrada');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      const body = req.body || {};
      let prospectIds = [];
      let listReport = null;
      if (body.manual && Array.isArray(body.manual.prospectIds)) {
        prospectIds = body.manual.prospectIds.map(String);
      } else if (Array.isArray(body.prospectIds)) {
        // Forma simples aceita para compatibilidade de clientes.
        prospectIds = body.prospectIds.map(String);
      } else if (body.segmentId) {
        // Segmento salvo (US2): critérios resolvidos AGORA — a audiência
        // materializada congela; novos leads não entram sem re-sync (FR-013).
        const segment = await prisma.studioSegment.findUnique({
          where: { id: String(body.segmentId) },
        });
        if (!segment || segment.orgId !== orgId) {
          throw httpError('NOT_FOUND', 404, 'Segmento não encontrado');
        }
        const where = segmentService.buildWhere(orgId, segment.criteria);
        const rows = await prisma.prospect.findMany({ where });
        prospectIds = rows.map((p) => p.id);
      } else if (body.list && Array.isArray(body.list)) {
        // Importação de lista (FR-010): CNPJs/e-mails resolvidos contra a org.
        const resolved = await segmentService.resolveList(prisma, orgId, body.list);
        prospectIds = resolved.matched;
        listReport = { matched: resolved.matched, unmatched: resolved.unmatched };
      } else {
        const err = new Error('Informe manual.prospectIds com os leads da audiência.');
        err.code = 'INVALID_AUDIENCE';
        err.status = 400;
        throw err;
      }

      if (prospectIds.length === 0) {
        const err = new Error('Audiência vazia: informe ao menos um lead.');
        err.code = 'INVALID_AUDIENCE';
        err.status = 400;
        throw err;
      }

      const { snapshot, members } = await campaignService.flow.materializeAudience(prisma, {
        campaign,
        prospectIds,
      });

      const withNames = [];
      for (const member of members) {
        const prospect = await prisma.prospect.findUnique({ where: { id: member.prospectId } });
        withNames.push({
          prospectId: member.prospectId,
          companyName: prospect?.companyName || null,
          included: member.included,
          excludeReason: member.excludeReason || null,
        });
      }

      res.json({
        success: true,
        data: {
          snapshotId: snapshot.id,
          totalCount: snapshot.totalCount,
          includedCount: snapshot.includedCount,
          excludedCount: snapshot.excludedCount,
          members: withNames,
          ...(listReport ? listReport : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerAudienceRoutes };
