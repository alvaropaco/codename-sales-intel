/**
 * TransactionalEmail — envio de emails transacionais da plataforma
 * (ex.: boas-vindas a novos usuários).
 *
 * Diferente do outreach (email-provider.js), que envia pela conta do
 * próprio usuário, o transacional usa uma caixa dedicada de sistema
 * (SMTP no Mailcow), configurada via variáveis de ambiente:
 *
 *   SMTP_HOST      — host SMTP (ex.: mail.0xcloud.net)
 *   SMTP_PORT      — porta (587 STARTTLS | 465 TLS)
 *   SMTP_USER      — usuário (ex.: no-reply@b2base.net)
 *   SMTP_PASS      — senha da caixa
 *   SMTP_FROM      — endereço From (default: SMTP_USER)
 *   SMTP_FROM_NAME — nome amigável do remetente (default: "B2Base")
 *   SMTP_SECURE    — "true" para TLS implícito (465), senão STARTTLS
 *   WELCOME_EMAIL_ENABLED — "false" desliga o envio (default: true)
 *
 * Nenhum secret é logado. Falhas de envio NUNCA quebram o fluxo de
 * cadastro/login: o disparo roda em background e erros são só registrados.
 */
const nodemailer = require('nodemailer');

const WELCOME_SUBJECT = 'Bem-vindo ao B2Base! 🚀';

function _fromEnv() {
  return {
    host: process.env.SMTP_HOST || 'mail.0xcloud.net',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    fromName: process.env.SMTP_FROM_NAME || 'B2Base',
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(process.env.SMTP_PORT) === 465,
  };
}

function _configured(cfg) {
  return Boolean(cfg.user && cfg.pass && cfg.from);
}

/**
 * Cria (lazy) o transporter SMTP a partir do ambiente. Não falha se
 * ainda não configurado — apenas retorna null.
 */
function _transporter(cfg) {
  if (!_configured(cfg)) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

function _htmlWelcome(name) {
  const displayName = name || 'lá';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#0b1220;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111827;border:1px solid #1f2937;border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:32px 32px 8px 32px;">
            <div style="font-size:20px;font-weight:700;color:#ffffff;">B2Base</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <div style="font-size:26px;font-weight:700;color:#ffffff;margin-bottom:12px;">Bem-vindo, ${displayName}! 👋</div>
            <div style="font-size:15px;line-height:1.6;color:#cbd5e1;">
              Sua conta foi criada com sucesso. O <strong style="color:#ffffff;">B2Base</strong> é a sua
              plataforma de inteligência comercial para descobrir, enriquecer e acompanhar oportunidades
              B2B a partir de dados públicos.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 24px 32px;" align="center">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://b2base.net" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="12%" stroke="f" fillcolor="#22d3ee">
              <w:anchorlock/>
              <center style="color:#0b1220;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Acessar o B2Base →</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="https://b2base.net" target="_blank" style="display:inline-block;background:#22d3ee;color:#0b1220;text-decoration:none;padding:15px 36px;border-radius:8px;font-size:16px;font-weight:700;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;box-shadow:0 4px 14px rgba(34,211,238,.35);">
              🚀 Acessar o B2Base
            </a>
            <!--<![endif]-->
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <div style="background:#1f2937;border-radius:10px;padding:16px 20px;">
              <div style="font-size:13px;color:#94a3b8;margin-bottom:8px;">PRIMEIROS PASSOS</div>
              <div style="font-size:14px;color:#e2e8f0;line-height:1.7;">
                🔎 <strong>Descobrir leads</strong> — busque por CNAE ou importe sua lista<br/>
                ✨ <strong>Enriquecer</strong> — dados, contatos e oportunidades para cada empresa<br/>
                📊 <strong>Acompanhar</strong> — pipeline e métricas da sua operação
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 32px 32px;">
            <div style="font-size:14px;line-height:1.6;color:#94a3b8;">
              Qualquer dúvida, responda a este e-mail ou fale com a nossa equipe.<br/><br/>
              <span style="color:#64748b;">— Equipe B2Base</span>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function _textWelcome(name) {
  const displayName = name || 'lá';
  return [
    `Olá, ${displayName}! 👋`,
    '',
    'Sua conta no B2Base foi criada com sucesso.',
    '',
    'O B2Base é a sua plataforma de inteligência comercial para descobrir,',
    'enriquecer e acompanhar oportunidades B2B a partir de dados públicos.',
    '',
    'Acesse agora: https://b2base.net',
    '',
    'Primeiros passos:',
    '  - Descobrir leads: busque por CNAE ou importe sua lista',
    '  - Enriquecer: dados, contatos e oportunidades para cada empresa',
    '  - Acompanhar: pipeline e métricas da sua operação',
    '',
    'Qualquer dúvida, é só responder a este e-mail.',
    '',
    '— Equipe B2Base',
  ].join('\n');
}

/**
 * Envia o e-mail de boas-vindas a um usuário recém-cadastrado.
 * Fire-and-forget seguro: nunca lança para o caller. Se o SMTP não
 * estiver configurado, desiste silenciosamente.
 *
 * @param {{email:string, name?:string}} user
 */
async function sendWelcomeEmail(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn('[transactional] welcome: destinatário inválido, pulando');
    return;
  }
  if (String(process.env.WELCOME_EMAIL_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[transactional] welcome: desabilitado via WELCOME_EMAIL_ENABLED=false');
    return;
  }

  const cfg = _fromEnv();
  if (!_configured(cfg)) {
    console.warn('[transactional] welcome: SMTP não configurado (SMTP_USER/SMTP_PASS/SMTP_FROM), pulando');
    return;
  }

  const transporter = _transporter(cfg);
  if (!transporter) return;

  const displayName = user.name || email.split('@')[0];
  try {
    await transporter.sendMail({
      from: cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from,
      to: email,
      subject: WELCOME_SUBJECT,
      text: _textWelcome(displayName),
      html: _htmlWelcome(displayName),
    });
    console.log(`[transactional] welcome enviado para ${email}`);
  } catch (err) {
    // Nunca propaga: welcome não pode quebrar o cadastro/login.
    console.error(`[transactional] welcome falhou para ${email}:`, err.message);
  }
}

/**
 * E-mail de OPERAÇÕES (feature 006): alertas de falha de enriquecimento e
 * digest diário. Best-effort — falha de envio é só logada (FR-017).
 */
async function sendOpsEmail({ to, subject, text, html }) {
  const cfg = _fromEnv();
  const transporter = _transporter(cfg);
  if (!transporter || !to) return { sent: false, reason: 'not_configured' };
  try {
    const info = await transporter.sendMail({
      from: `"${cfg.fromName}" <${cfg.from}>`,
      to,
      subject,
      text,
      html: html || undefined,
    });
    return { sent: true, messageId: info && info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendWelcomeEmail, sendOpsEmail, WELCOME_SUBJECT };
