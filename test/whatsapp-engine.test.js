'use strict';
const test = require('node:test');
const assert = require('node:assert');
const engine = require('../whatsapp-engine');

// ---------------------------------------------------------------------------
// Fake Prisma in-memory (apenas os métodos usados pelo engine nos testes).
// ---------------------------------------------------------------------------
function makeFakePrisma() {
  const db = {
    whatsAppAccount: [],
    whatsAppConversation: [],
    whatsAppMessage: [],
    leadChannelState: [],
    whatsAppCampaignContact: [],
    prospect: [],
  };
  let seq = 0;
  const id = (p) => `${p}_${++seq}`;

  function matches(rec, where) {
    for (const [k, v] of Object.entries(where || {})) {
      const actual = rec[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && v.constructor === Object) {
        if ('in' in v) { if (!v.in.includes(actual)) return false; continue; }
        if ('notIn' in v) { if (v.notIn.includes(actual)) return false; continue; }
        if ('not' in v) { if (actual === v.not) return false; continue; }
        // compound key (orgId_phoneNumber, prospectId_channel, ...)
        for (const [sk, sv] of Object.entries(v)) {
          if (rec[sk] !== sv) return false;
        }
        continue;
      }
      if (actual !== v) return false;
    }
    return true;
  }
  const findOne = (arr, where) => arr.find((r) => matches(r, where)) || null;
  const findAll = (arr, where) => arr.filter((r) => matches(r, where));

  return {
    db,
    whatsAppAccount: {
      findUnique: async ({ where }) => findOne(db.whatsAppAccount, where),
      findMany: async ({ where }) => findAll(db.whatsAppAccount, where),
      update: async ({ where, data }) => { const r = findOne(db.whatsAppAccount, where); if (r) Object.assign(r, data); return r; },
    },
    whatsAppConversation: {
      findUnique: async ({ where }) => findOne(db.whatsAppConversation, where),
      findFirst: async ({ where }) => findOne(db.whatsAppConversation, where),
      create: async ({ data }) => { const r = { id: id('conv'), ...data }; db.whatsAppConversation.push(r); return r; },
      update: async ({ where, data }) => { const r = findOne(db.whatsAppConversation, where); if (r) Object.assign(r, data); return r; },
    },
    whatsAppMessage: {
      findFirst: async ({ where }) => findOne(db.whatsAppMessage, where),
      findUnique: async ({ where }) => findOne(db.whatsAppMessage, where),
      create: async ({ data }) => { const r = { id: id('msg'), ...data }; db.whatsAppMessage.push(r); return r; },
      update: async ({ where, data }) => { const r = findOne(db.whatsAppMessage, where); if (r) Object.assign(r, data); return r; },
    },
    leadChannelState: {
      findUnique: async ({ where }) => findOne(db.leadChannelState, where),
      upsert: async ({ where, create, update }) => {
        const existing = findOne(db.leadChannelState, where);
        if (existing) { Object.assign(existing, update); return existing; }
        const r = { id: id('lcs'), ...create }; db.leadChannelState.push(r); return r;
      },
    },
    whatsAppCampaignContact: {
      findFirst: async ({ where }) => findOne(db.whatsAppCampaignContact, where),
      findUnique: async ({ where }) => findOne(db.whatsAppCampaignContact, where),
      updateMany: async ({ where, data }) => {
        const rows = findAll(db.whatsAppCampaignContact, where);
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    prospect: {
      findMany: async ({ where }) => findAll(db.prospect, where),
      findUnique: async ({ where }) => findOne(db.prospect, where),
    },
  };
}

const baseEvent = (session, body, id, fromMe = false) => ({
  event: 'message',
  session,
  payload: {
    id,
    from: '5511987654321@c.us',
    fromMe,
    body,
    type: 'chat',
  },
});

// ---------------------------------------------------------------------------
test('isContactable: bloqueado por do_not_contact', async () => {
  const prisma = makeFakePrisma();
  prisma.db.leadChannelState.push({ id: 'x', orgId: 'org1', prospectId: 'p1', channel: 'whatsapp', status: 'do_not_contact' });
  const ok = await engine.isContactable(prisma, { orgId: 'org1', prospectId: 'p1' });
  assert.strictEqual(ok, false);
});

test('isContactable: sem estado = pode contatar', async () => {
  const prisma = makeFakePrisma();
  assert.strictEqual(await engine.isContactable(prisma, { orgId: 'org1', prospectId: 'p1' }), true);
});

test('applyOptOut: marca opted_out e cancela contatos de campanha', async () => {
  const prisma = makeFakePrisma();
  prisma.db.prospect.push({ id: 'p1', orgId: 'org1', cnpjPhones: ['5511987654321'] });
  prisma.db.whatsAppCampaignContact.push({ id: 'c1', prospectId: 'p1', campaignId: 'camp1', phoneNumber: '5511987654321', status: 'SENT' });

  await engine.applyOptOut(prisma, { orgId: 'org1', phoneNumber: '5511987654321', reason: 'keyword' });

  const lcs = prisma.db.leadChannelState.find((s) => s.prospectId === 'p1');
  assert.ok(lcs, 'estado de canal criado');
  assert.strictEqual(lcs.status, 'opted_out');

  const contact = prisma.db.whatsAppCampaignContact.find((c) => c.id === 'c1');
  assert.strictEqual(contact.status, 'OPTED_OUT');
});

test('handleMessageEvent: inbound cria conversa e mensagem (sem handoff sem outbound)', async () => {
  const prisma = makeFakePrisma();
  prisma.db.whatsAppAccount.push({ id: 'a1', orgId: 'org1', sessionName: 'b2base_abc', status: 'CONNECTED' });

  const result = await engine.handleMessageEvent(prisma, null, baseEvent('b2base_abc', 'Olá, tenho interesse', 'msg_1'));

  assert.ok(result && result.conversationId);
  assert.strictEqual(prisma.db.whatsAppConversation.length, 1);
  assert.strictEqual(prisma.db.whatsAppMessage.length, 1);
  assert.strictEqual(prisma.db.whatsAppConversation[0].status, 'ACTIVE');
});

test('handleMessageEvent: inbound após outbound → handoff + interrompe automação', async () => {
  const prisma = makeFakePrisma();
  prisma.db.whatsAppAccount.push({ id: 'a1', orgId: 'org1', sessionName: 'b2base_abc', status: 'CONNECTED' });
  prisma.db.whatsAppConversation.push({ id: 'conv1', orgId: 'org1', whatsappAccountId: 'a1', prospectId: 'p1', phoneNumber: '5511987654321', status: 'ACTIVE' });
  prisma.db.whatsAppMessage.push({ id: 'm_out', conversationId: 'conv1', orgId: 'org1', direction: 'OUTBOUND', status: 'SENT' });
  prisma.db.whatsAppCampaignContact.push({ id: 'c1', campaignId: 'camp1', prospectId: 'p1', phoneNumber: '5511987654321', status: 'SENT' });

  await engine.handleMessageEvent(prisma, null, baseEvent('b2base_abc', 'Gostei, quero saber mais', 'msg_2'));

  const conv = prisma.db.whatsAppConversation.find((c) => c.id === 'conv1');
  assert.strictEqual(conv.status, 'HUMAN_HANDOFF');
  const contact = prisma.db.whatsAppCampaignContact.find((c) => c.id === 'c1');
  assert.strictEqual(contact.status, 'REPLIED');
});

test('handleMessageEvent: palavra de opt-out → OPTED_OUT', async () => {
  const prisma = makeFakePrisma();
  prisma.db.whatsAppAccount.push({ id: 'a1', orgId: 'org1', sessionName: 'b2base_abc', status: 'CONNECTED' });
  prisma.db.prospect.push({ id: 'p1', orgId: 'org1', cnpjPhones: ['5511987654321'] });

  await engine.handleMessageEvent(prisma, null, baseEvent('b2base_abc', 'SAIR', 'msg_stop'));

  const conv = prisma.db.whatsAppConversation.find((c) => c.phoneNumber === '5511987654321');
  assert.strictEqual(conv.status, 'OPTED_OUT');
  const lcs = prisma.db.leadChannelState.find((s) => s.prospectId === 'p1');
  assert.strictEqual(lcs.status, 'opted_out');
});

test('handleMessageEvent: evento duplicado NÃO cria mensagem duplicada', async () => {
  const prisma = makeFakePrisma();
  prisma.db.whatsAppAccount.push({ id: 'a1', orgId: 'org1', sessionName: 'b2base_abc', status: 'CONNECTED' });

  await engine.handleMessageEvent(prisma, null, baseEvent('b2base_abc', 'Olá', 'msg_dup'));
  await engine.handleMessageEvent(prisma, null, baseEvent('b2base_abc', 'Olá', 'msg_dup'));

  assert.strictEqual(prisma.db.whatsAppMessage.length, 1);
});

test('multi-tenant: sessão de outro workspace é ignorada', async () => {
  const prisma = makeFakePrisma();
  prisma.db.whatsAppAccount.push({ id: 'a1', orgId: 'orgA', sessionName: 'b2base_a', status: 'CONNECTED' });

  // Sessão desconhecida (workspace B) → null, nada criado.
  const result = await engine.handleMessageEvent(prisma, null, baseEvent('b2base_b', 'Olá', 'msg_x'));
  assert.strictEqual(result, null);
  assert.strictEqual(prisma.db.whatsAppConversation.length, 0);
  assert.strictEqual(prisma.db.whatsAppMessage.length, 0);
});

test('multi-tenant: mensagens/conversas escopadas por orgId', async () => {
  const prisma = makeFakePrisma();
  prisma.db.whatsAppAccount.push({ id: 'a1', orgId: 'orgA', sessionName: 'b2base_a', status: 'CONNECTED' });
  prisma.db.whatsAppAccount.push({ id: 'a2', orgId: 'orgB', sessionName: 'b2base_b', status: 'CONNECTED' });

  await engine.handleMessageEvent(prisma, null, baseEvent('b2base_a', 'Olá', 'msg_a'));

  // orgB nunca deve enxergar a mensagem da orgA.
  const orgBMessages = prisma.db.whatsAppMessage.filter((m) => m.orgId === 'orgB');
  assert.strictEqual(orgBMessages.length, 0);
  assert.strictEqual(prisma.db.whatsAppMessage[0].orgId, 'orgA');
});
