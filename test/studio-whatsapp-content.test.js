'use strict';

/**
 * test/studio-whatsapp-content.test.js — lógica do WhatsApp Studio (US6):
 * validações de conteúdo/template Meta (T066), fallbacks comportamentais
 * (T068) e sequências compiladas do Studio para o motor (T067).
 */

const test = require('node:test');
const assert = require('node:assert');
const { createFakePrisma } = require('./helpers/fake-prisma');
const {
  validateWhatsAppContent,
  matchesFallback,
} = require('../studio/whatsapp-content');
const { ensureWhatsAppExecution } = require('../studio/channel-bridge');

// ── Validações (T066, FR-041/042) ───────────────────────────────────────────

test('validação: mensagem com variável do catálogo e 1 botão URL passa', () => {
  const result = validateWhatsAppContent({
    whatsappText: 'Olá {{firstName}}, quer ver o ERP?',
    whatsappMeta: { buttons: [{ type: 'url', label: 'Ver demo', url: 'https://exemplo.com' }] },
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('validação: template Meta exige categoria válida e variáveis posicionais (FR-042)', () => {
  const bad = validateWhatsAppContent({
    whatsappMeta: { template: { category: 'PROMO', variables: ['{{nome}}'] } },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('PROMO')));
  assert.ok(bad.errors.some((e) => e.includes('{{nome}}')));

  const good = validateWhatsAppContent({
    whatsappMeta: { template: { category: 'MARKETING', variables: ['{{1}}', '{{2}}'] } },
  });
  assert.equal(good.ok, true);
});

test('validação: texto gigante, variável desconhecida e >3 botões falham', () => {
  const result = validateWhatsAppContent({
    whatsappText: 'x'.repeat(5000) + ' {{apelido}}',
    whatsappMeta: {
      buttons: [
        { type: 'url', url: 'https://a.com' },
        { type: 'url', url: 'https://b.com' },
        { type: 'url', url: 'https://c.com' },
        { type: 'quick_reply', label: 'x' },
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 3);
});

// ── Fallbacks comportamentais (T068, FR-044) ────────────────────────────────

const NOW = new Date('2026-09-23T13:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

test('fallback opened_no_click: dispara só após o delay e sem clique', () => {
  const rule = { condition: 'opened_no_click', delayDays: 2 };
  assert.equal(
    matchesFallback({ sent: daysAgo(5), opened: daysAgo(4) }, rule, NOW),
    true,
    'abriu há 4 dias sem clicar → dispara'
  );
  assert.equal(
    matchesFallback({ sent: daysAgo(1), opened: daysAgo(0.5) }, rule, NOW),
    false,
    'delay de 2 dias ainda não passou'
  );
  assert.equal(
    matchesFallback({ sent: daysAgo(5), opened: daysAgo(4), clicked: daysAgo(3) }, rule, NOW),
    false,
    'clicou → não é opened_no_click'
  );
  assert.equal(
    matchesFallback({ sent: daysAgo(5), opened: daysAgo(4), replied: daysAgo(1) }, rule, NOW),
    false,
    'respondeu → nenhuma automação continua (FR-053)'
  );
});

test('fallback email_failed dispara imediatamente; clicked_no_reply exige clique sem resposta', () => {
  assert.equal(matchesFallback({ failed: daysAgo(0.1) }, { condition: 'email_failed' }, NOW), true);
  assert.equal(
    matchesFallback({ sent: daysAgo(5), clicked: daysAgo(3) }, { condition: 'clicked_no_reply', delayDays: 2 }, NOW),
    true
  );
});

// ── Sequências: StudioContent followup → steps do motor (T067) ──────────────

test('execução WhatsApp compila toque 1 + followups como steps ordenados (FR-043)', async () => {
  const prisma = createFakePrisma();
  const campaign = {
    id: 'camp-w', orgId: 'org-1', name: '[Studio] Sequência', objective: null, offer: null,
    channels: ['whatsapp'], whatsappExecutionId: null, studioCampaignId: null, status: 'DRAFT',
  };
  const content = { whatsappText: 'Oi {{firstName}}!', ctaUrl: 'https://exemplo.com', origin: 'manual' };
  const execution = await ensureWhatsAppExecution(prisma, campaign, content);
  assert.ok(execution.id);

  // Followups configurados como StudioContent kind=followup (FR-079).
  const followups = [
    { channel: 'whatsapp', kind: 'followup', stepIndex: 2, delayDays: 2, whatsappText: 'Toque 2', variantLabel: 'A', origin: 'manual' },
    { channel: 'whatsapp', kind: 'followup', stepIndex: 3, whatsappText: 'Toque 3', variantLabel: 'A', origin: 'manual' },
  ];
  // compileSteps é a função pura testável do bridge (ordem + delays).
  const { compileSteps } = require('../studio/channel-bridge');
  const steps = compileSteps(content, followups);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].orderIndex, 1);
  assert.equal(steps[1].orderIndex, 2);
  assert.equal(steps[1].delayMinutes, 2 * 1440, 'delay do follow-up 2 em minutos');
  assert.equal(steps[2].messageTemplate, 'Toque 3', 'step usa o campo do motor (messageTemplate)');
});
