# Justificativa de Escopos do Gmail API (gmail.send e gmail.metadata)

**Plataforma:** B2Base
**Documento:** Justificativa técnica para a solicitação de aprovação dos escopos
**Data:** 2026-08-20

---

## Resumo executivo

A B2Base permite que um vendedor (usuário autenticado da plataforma) se comunique
**individualmente** com um lead/prospect que ele mesmo qualificou dentro do
funil B2B da plataforma. Para isso, solicitamos apenas dois escopos **restritos**
do Gmail:

- **`gmail.send`** — para enviar mensagens **ponto-a-ponto** (uma pessoa vendedora
  → uma pessoa compradora) diretamente da conta do próprio usuário.
- **`gmail.metadata`** — para **detectar respostas** dos prospects, lendo apenas
  cabeçalhos e metadados das mensagens (nunca o corpo das mensagens).

Este documento explica, de forma concreta e vinculada ao código-fonte da
plataforma, **exatamente** como cada escopo é utilizado e por que ele é o mínimo
necessário para a operação — sem leitura de conteúdo, sem acesso a mensagens
não relacionadas ao fluxo e sem envio em massa.

---

## Contexto: o fluxo do produto

O vendedor usa a B2Base para:

1. **Descobrir** empresas e leads reais por CNAE/segmento (dados abertos da
   Receita Federal via MCP) — ver `DISCOVERY.md`.
2. **Qualificar** cada lead e movê-lo pelo funil (prospect → qualificado →
   negociação...).
3. **Enviar um primeiro contato** individual e personalizado para esse lead.
4. **Acompanhar as respostas** desse mesmo contato diretamente na plataforma.

Os escopos do Gmail aparecem apenas nos passos **3 e 4**, e apenas dentro do
contexto de uma relação comercial já iniciada por um humano. Não há nenhum fluxo
de mala direta, blaster ou envio não solicitado.

---

## Escopo 1 — `gmail.send`

### Para que serve

Permitir que a plataforma envie uma **mensagem individual e rastreável** em nome
do vendedor, **da própria conta Gmail do vendedor** (o remetente é a conta que
ele conectou, jamais uma conta genérica da plataforma).

### Como é utilizado (implementação real)

A função `sendEmail()` em `gmail-api.js` (linhas 181–245) monta uma mensagem
RFC 2822 única e chama `users.messages.send` com o único destinatário
informado pelo vendedor para aquele lead:

```js
const response = await gmail.users.messages.send({
  userId: 'me',
  requestBody: { raw: encoded },
});
```

No worker de envio (`outreach-workers.js`, `processSend`) a mensagem é montada a
partir do perfil comercial do próprio vendedor, com:

- **um único destinatário** (`to: recipientEmail`), o e-mail do lead;
- **assunto e corpo personalizados** gerados a partir do contexto daquele lead;
- **uma marcação de controle** (`Message-ID`) que permite a rastreabilidade da
  conversa — essencial para o escopo 2.

O envio é **ponto-a-ponto** por natureza:

- **1 mensagem → 1 destinatário**, sempre o lead qualificado por aquele vendedor.
- O **remetente é a conta do próprio vendedor**, conectada via OAuth com o
  consentimento explícito dele. A reputação e o remetente são dele — incentivo
  natural a enviar apenas o que é relevante e esperado.
- **Sem listas de destinatários, sem envio em massa, sem templates cegos.**
  O escopo `gmail.send` não concede nenhuma capacidade além de enviar; ele **não**
  permite ler nada da caixa de entrada.

### Por que é o mínimo necessário

- É a única forma de enviar um e-mail real da conta do usuário programaticamente.
- Não requer leitura da caixa de entrada, histórico ou contatos.
- A plataforma **não** solicita `gmail.readonly` nem `gmail.modify` — ou seja,
  **não** há capacidade de abrir, ler ou alterar mensagens existentes.

---

## Escopo 2 — `gmail.metadata`

### Para que serve

Detectar, de forma **não intrusiva e minimalista**, quando um prospect responde
a um e-mail enviado pela plataforma, para que o vendedor seja avisado, os
follow-ups automáticos sejam interrompidos e a conversa seja tratada por um
humano, sem nunca ler o conteúdo da resposta.

### Por que `gmail.metadata` (e não um escopo mais amplo)

`gmail.metadata` é o escopo **menos permissivo** que permite ler cabeçalhos das
mensagens. Ele concede acesso **apenas a metadados** (remetente, destinatário,
assunto e campos de referenciamento) e **explicitamente não concede acesso ao
corpo das mensagens**. É a alternativa mínima ao muito mais invasivo
`gmail.readonly`.

### Como é utilizado (implementação real)

**a) Varredura de mudanças via History API** — `listHistory()` em `gmail-api.js`
(linhas 267–285) chama `users.history.list` para ver apenas o **histórico de
alterações** desde o último ponto de sincronização. Isso não baixa a caixa de
entrada nem mensagens completas; apenas identifica *o que mudou*.

**b) Leitura de metadados, não de conteúdo** — `getMessage()` (linhas 291–303)
busca cada mensagem com `format: 'metadata'`, solicitando **somente estes
cabeçalhos**:

```js
metadataHeaders: ['From', 'To', 'Subject', 'Message-ID', 'In-Reply-To', 'References']
```

Nenhum desses campos contém o conteúdo da mensagem. São meramente os metadados
de roteamento e identidade da conversa.

**c) Detecção de resposta** — a função `_isReply()` em `outreach-workers.js`
(linha 425) decide se uma alteração é uma **resposta** do prospect analisando
estritamente os cabeçalhos `In-Reply-To` e `References` (o mesmo mecanismo que
o padrão de e-mail usa para agrupar conversas em threads). Ou seja: só
reconhecemos que *responderam* — **nunca** lemos *o que* responderam:

```js
// Strong signal: In-Reply-To or References headers
headers.forEach((h) => { /* comparação de Ids de thread */ });
```

**d) Ação sobre a resposta** — `_handleReply()` (linha 446) marca o lead como
"respondeu", interrompe os follow-ups automáticos e cria um evento de
`reply_received`, para que **um humano** assuma a conversa. Novamente, o corpo
da resposta não é lido nem armazenado; ele permanece integralmente no Gmail do
vendedor, que acessa o e-mail original lá mesmo.

### Por que é o mínimo necessário

- Sem `gmail.metadata` não é possível saber se um prospect respondeu, e o sistema
  ficaria cego: continuaria disparando follow-ups para alguém que já respondeu
  (ruim para o usuário e para a experiência do comprador) ou simplesmente não
  avisaria o vendedor.
- A detecção de resposta **exige** ler os cabeçalhos `In-Reply-To`/`References`;
  não há como fazê-lo por outro escopo sem também conceder acesso ao conteúdo.
- O escopo permanece **somente-leitura de metadados**: não permite modificar,
  mover, arquivar ou excluir nenhuma mensagem.

---

## Tabela de capacidades (o que pedimos vs. o que não pedimos)

| Capacidade | `gmail.send` | `gmail.metadata` | **Não pedimos** |
|---|---|---|---|
| Enviar e-mail da conta do usuário | ✅ (ponto-a-ponto) | — | `gmail.modify`, `gmail.settings.basic` |
| Detectar resposta (respostas a um e-mail enviado) | — | ✅ (via cabeçalhos) | — |
| Ler corpo/conteúdo da mensagem | ❌ | ❌ | `gmail.readonly` |
| Ler caixa de entrada completa | ❌ | ❌ (apenas `history` de mudanças) | `gmail.readonly` |
| Alterar/excluir/arquivar mensagens | ❌ | ❌ | `gmail.modify` |
| Gerenciar configurações da conta | ❌ | ❌ | `gmail.settings.*` |

Ambos os escopos são classes [sensíveis](https://developers.google.com/gmail/api/auth/scopes),
mas combinam exatamente com o propósito declarado: **enviar o contato inicial e
reconhecer respostas**, sem jamais ler conteúdo, sem acesso à caixa de entrada
integral e sem nenhuma capacidade de alteração.

---

## Mitigações de privacidade e segurança implementadas

1. **Consentimento explícito do usuário** — o vendedor é o dono da conta. Ele
   passa pelo fluxo OAuth do Google (`getAuthUrl` em `gmail-api.js`, linha 27)
   com tela de consentimento, e pode revogar o acesso a qualquer momento.
2. **Mínimo privilégio** — apenas os dois escopos descritos; nenhum escopo de
   leitura de conteúdo, nem de modificação.
3. **Rotação de escopo transparente** — os escopos concedidos são salvos e
   auditáveis em `gmail-auth.js` (linha 104) e na tabela `EmailAccount`.
4. **Armazenamento seguro de credenciais** — o `refresh_token` é cifrado em
   repouso com AES-256-GCM (`gmail-auth.js`, `encrypt`/`decrypt`), nunca em
   texto puro.
5. **Sem persistência de conteúdo** — nada do corpo das mensagens é baixado,
   armazenado ou processado; as respostas vivem apenas no Gmail do vendedor.
6. **Remetente real do vendedor** — toda mensagem sai da conta do próprio humano
   responsável, com a reputação dele em jogo, o que alinha os incentivos com
   comunicação relevante e consentida.

---

## Conclusão

Os escopos **`gmail.send`** e **`gmail.metadata`** são exatamente o que a B2Base
precisa para permitir que um vendedor **envie um contato individual e reconheça
respostas** — e **nada além disso**.

- `gmail.send` faz o envio **ponto-a-ponto** da conta do próprio usuário, sem
  acesso a leitura.
- `gmail.metadata` detecta respostas **apenas via cabeçalhos**, sem ler conteúdo.

Juntos, viabilizam a comunicação B2B individual **sem** oferecer qualquer
capacidade de leitura de conteúdo, de acesso à caixa de entrada completa ou de
alteração de mensagens. Eles representam o conjunto mínimo e menos intrusivo
possível para cumprir o propósito do produto.
