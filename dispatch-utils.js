/**
 * dispatch-utils.js — mapeadores puros do histórico unificado de disparos
 * (GET /api/outreach/dispatches). Extraídos de server-prod.js (007) para serem
 * testáveis sem subir o app: cada item expõe o conteúdo e a ORIGEM DA
 * COMPOSIÇÃO (WhatsAppMessage/OutreachMessage.compositionOrigin — FR-010).
 */

const bucketForEmail = (msg) => {
  if (msg.status === 'SENT') return 'sent';
  if (msg.error || ['FAILED', 'BOUNCED'].includes(msg.status)) return 'failed';
  return 'pending'; // GENERATING, SCHEDULED, SENDING
};

const bucketForWhatsApp = (msg) => {
  if (['SENT', 'DELIVERED', 'READ'].includes(msg.status)) return 'sent';
  if (msg.status === 'FAILED' || msg.error) return 'failed';
  return 'pending'; // PENDING
};

/**
 * Item de histórico para uma OutreachMessage (email de campanha/suíte).
 * compositionOrigin null = registro anterior à migração 007 (auditoria
 * histórica sem origem registrada).
 */
function toEmailDispatchItem(m, { prospectById }) {
  const prospect = prospectById.get(m.contact?.prospectId);
  return {
    id: `email:${m.id}`,
    channel: 'email',
    prospectId: m.contact?.prospectId || null,
    companyName: prospect?.companyName || null,
    cnpj: prospect?.cnpj || null,
    destination: prospect?.cnpjEmail || null,
    campaignId: m.contact?.campaignId || null,
    campaignName: m.contact?.campaign?.name || null,
    origin: m.contact?.campaign?.trigger === 'on_enrichment' ? 'auto' : 'manual',
    compositionOrigin: m.compositionOrigin || null,
    preview: m.subject,
    status: m.status,
    bucket: bucketForEmail(m),
    error: m.error || null,
    sentAt: m.sentAt?.toISOString() || null,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Item de histórico para uma WhatsAppMessage OUTBOUND de campanha.
 */
function toWhatsAppDispatchItem(m, { prospectById, waContactById }) {
  const prospect = prospectById.get(m.conversation?.prospectId);
  const contact = m.campaignContactId ? waContactById.get(m.campaignContactId) : null;
  return {
    id: `wa:${m.id}`,
    channel: 'whatsapp',
    prospectId: m.conversation?.prospectId || null,
    companyName: prospect?.companyName || null,
    cnpj: prospect?.cnpj || null,
    destination: m.conversation?.phoneNumber || null,
    campaignId: contact?.campaignId || null,
    campaignName: contact?.campaign?.name || null,
    origin: contact ? 'manual' : 'conversation',
    compositionOrigin: m.compositionOrigin || null,
    preview: (m.content || '').replace(/\s+/g, ' ').slice(0, 120) || null,
    status: m.status,
    bucket: bucketForWhatsApp(m),
    error: m.error || null,
    sentAt: m.sentAt?.toISOString() || null,
    createdAt: m.createdAt.toISOString(),
  };
}

module.exports = {
  bucketForEmail,
  bucketForWhatsApp,
  toEmailDispatchItem,
  toWhatsAppDispatchItem,
};
