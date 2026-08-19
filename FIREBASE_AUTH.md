# Firebase Authentication

Autenticação com **Google**, **GitHub**, **e-mail/senha** e **telefone**. E-mail é
restrito a domínios corporativos; telefone é confirmado via código SMS. Sessão
persistente por cookie httpOnly.

## Métodos de login

| Método | Regra |
|--------|-------|
| Google / GitHub | E-mail corporativo obrigatório (e-mail verificado pelo provedor) |
| E-mail e senha | E-mail corporativo obrigatório + e-mail verificado (enviamos link de verificação) |
| Telefone | Código SMS; sem e-mail, armazenamos o telefone como identificador |

## O que foi implementado

| Camada | Arquivo | Papel |
|--------|---------|-------|
| Backend | `firebase-auth.js` | Verifica ID tokens (Admin SDK), bloqueia e-mails gratuitos, emite cookie de sessão assinado (JWT) e protege as rotas |
| Backend | `server-prod.js` | Registra `POST/GET /api/auth/session`, `POST /api/auth/logout` e o middleware `requireAuth` em `/api/*` |
| Frontend | `apps/web/src/services/firebase.ts` | SDK web do Firebase (redirect Google/GitHub com fallback para popup) |
| Frontend | `apps/web/src/services/auth.ts` | Troca o ID token por sessão, resolve a sessão atual e faz logout |
| Frontend | `apps/web/src/services/authErrors.ts` | Traduz códigos de erro técnicos do Firebase/backend em mensagens amigáveis |
| Frontend | `apps/web/src/components/auth/LoginView.tsx` | Tela de login (Google/GitHub) |
| Frontend | `apps/web/src/App.tsx` | Gate de autenticação e processamento do callback de redirect do Firebase |
| Frontend | `apps/web/src/services/authGuard.ts` | Detecta 401 em chamadas protegidas e volta ao login |

## Endpoints de callback

O fluxo OAuth do Firebase precisa de dois pontos de retorno, ambos implementados:

| Endpoint | Tipo | Papel |
|----------|------|-------|
| `/__/auth/*` (`/__/auth/handler`, `/__/auth/iframe`, `/__/auth/experiments`) | Backend (proxy) | Endpoints que o SDK web chama no `authDomain`. São repassados para `<project>.firebaseapp.com`, permitindo usar domínio customizado como `authDomain`. |
| `/auth/callback` (qualquer rota SPA) | Backend (SPA fallback) | O navegador volta do provedor OAuth para esta rota; o servidor devolve o `index.html` do React, que processa o resultado via `getRedirectResult`. |

## Fluxo

1. O usuário clica em **Continuar com Google/GitHub**.
2. O SDK web redireciona a página para o provedor (fallback para popup quando o
   navegador não suporta redirect).
3. Ao voltar, o `App` processa o callback (`getRedirectResult`) e envia o Firebase
   ID token para `POST /api/auth/session`.
4. O backend valida o token com o Admin SDK e aplica a política de e-mail corporativo.
5. Se aprovado, o usuário é gravado (upsert) no banco e o backend assina um JWT
   salvo em cookie `httpOnly` (`b2base_session`, 14 dias por padrão).
6. Nas próximas visitas o cookie é enviado automaticamente e `GET /api/auth/session`
   resolve o usuário sem exigir novo login.

## Tratamento de erros

Erros do Firebase (`auth/popup-blocked`, `auth/invalid-credential`, etc.) e os
códigos do backend (`EMAIL_NOT_VERIFIED`, `NON_CORPORATE_EMAIL`,
`SESSION_EXPIRED`, ...) **nunca são exibidos ao usuário**. O mapeamento central
em `apps/web/src/services/authErrors.ts` converte cada código em mensagem
amigável em português; códigos desconhecidos caem em uma mensagem genérica.

O JWT inclui um `sessionVersion` do usuário. No logout esse valor é incrementado no
banco, então cookies capturados anteriormente passam a responder `401` — a sessão é
revogada no servidor, não apenas apagada do navegador.

## Política de e-mail corporativo

Atualmente **desabilitada** (temporariamente): qualquer e-mail pode se cadastrar.
Para reativar a restrição a domínios corporativos, defina no backend:

```env
AUTH_REQUIRE_CORPORATE_EMAIL=true
```

Com a flag ativa, qualquer domínio que não seja um provedor gratuito é aceito. A
lista de provedores bloqueados inclui Gmail, Outlook/Hotmail, Yahoo, iCloud,
Proton, Tutanota, Zoho, GMX, Mail.com, Yandex, UOL, Bol, Terra, IG, entre outros
(ver `FREE_EMAIL_DOMAINS` em `firebase-auth.js`).

Para restringir ainda mais, defina uma allowlist explícita no backend:

```env
AUTH_ALLOWED_DOMAINS=minhaempresa.com.br,parceiro.com
```

Com essa variável definida, **somente** esses domínios são aceitos.

## Configuração no Firebase Console

Status já verificado no projeto `shadowtrace-7199f`:

- Providers **Google** e **GitHub** estão **habilitados** (Identity Toolkit).
- O Web app **"B2Base Web"** foi criado e o config real está em
  `apps/web/.env.local` (ignorado pelo git). O `apps/web/.env.example` documenta
  as mesmas chaves.

A service account (`firebase-adminsdk`) só permite ao backend **verificar** tokens.
O `apiKey`/`appId` do Web app são públicos (vão no bundle) e foram obtidos via
Firebase Management API a partir da própria service account.

Se precisar recriar em outro projeto:

1. Acesse <https://console.firebase.google.com/project/shadowtrace-7199f>.
2. **Authentication → Sign-in method** e habilite **Google** e **GitHub**.
   - GitHub exige registrar um OAuth App e informar Client ID/Secret na página do provedor.
3. **Authentication → Settings → Authorized domains**: adicione os domínios que
   servirão o app (ex.: `localhost`, `seudominio.com`).
4. **Project settings → General → Your apps** → crie/abra um **Web app** e copie:
   - `apiKey` → `VITE_FIREBASE_API_KEY`
   - `appId` → `VITE_FIREBASE_APP_ID`
   - (opcional) `messagingSenderId` → `VITE_FIREBASE_MESSAGING_SENDER_ID`

   Preencha `apps/web/.env.local` (copie de `apps/web/.env.example`).

> `projectId` (`shadowtrace-7199f`), `authDomain` e `storageBucket` já têm padrões
> derivados e normalmente não precisam ser alterados.

## Variáveis de ambiente

### Backend (`.env.local`)

```env
FIREBASE_SERVICE_ACCOUNT_PATH=/caminho/para/shadowtrace-....json
# ou FIREBASE_SERVICE_ACCOUNT_JSON='{...}' (para Coolify/Render/containers)

SESSION_SECRET=valor_aleatorio_de_no_minimo_32_caracteres
SESSION_TTL_HOURS=336
SESSION_COOKIE_SECURE=false   # true quando servir via HTTPS
# (opcional) origem para onde o proxy de /__/auth/* repassa os callbacks.
# Padrão: <FIREBASE_PROJECT_ID>.firebaseapp.com. Só mude se o handler estiver
# em um domínio customizado conectado ao Firebase Hosting.
FIREBASE_AUTH_HANDLER_ORIGIN=shadowtrace-7199f.firebaseapp.com
# AUTH_ALLOWED_DOMAINS=meudominio.com.br
```

### Frontend (`apps/web/.env.local`)

```env
VITE_FIREBASE_PROJECT_ID=shadowtrace-7199f
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_APP_ID=1:123456789:web:abc...
# authDomain PÚBLICO: quando usar domínio próprio, aponte para ele
# (ex.: b2base.net) e cadastre a redirect URI
# https://SEU_DOMINIO/__/auth/handler no provedor OAuth.
VITE_FIREBASE_AUTH_DOMAIN=b2base.net
VITE_FIREBASE_STORAGE_BUCKET=shadowtrace-7199f.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=
```

> `VITE_FIREBASE_AUTH_DOMAIN` NÃO afeta o proxy do backend. Ele é embutido no
> build (build arg) e diz ao SDK web onde ele deve chamar `/__/auth/*`.

## Rodando

```bash
# dev (frontend 5173 proxia /api para 3001)
pnpm dev

# produção (serve o build do React + API no mesmo processo)
pnpm --filter web build
node server-prod.js
```

Com o build do frontend presente, `GET /` serve o SPA (que exibe a tela de login
quando não há sessão) e todas as rotas `/api/*` — exceto `/api/auth/*` — respondem
`401` sem cookie válido.

## Validação (integração real)

Teste end-to-end executado contra o servidor com **ID tokens reais** (mintados via
Admin SDK e trocados pela API real do Identity Toolkit):

| Cenário | Resultado |
|---------|-----------|
| Login corporativo (`@acme-example.com`) → 200 + cookie | ✅ |
| `/api/prospects` com cookie válido → 200 | ✅ |
| `GET /api/auth/session` com cookie → usuário persistente | ✅ |
| Login com `@gmail.com` → 403 `NON_CORPORATE_EMAIL` | ✅ |
| Logout → 200 | ✅ |
| Cookie antigo após logout → 401 (revogado) | ✅ |
| `GET /api/auth/session` pós-logout → 401 `SESSION_REVOKED` | ✅ |
| `POST /api/auth/session` sem `idToken` → 400 | ✅ |
| `POST /api/auth/session` com token inválido → 401 | ✅ |
| `/api/prospects` sem cookie → 401 | ✅ |

Os usuários de teste do Firebase e do banco são removidos ao final do teste.
