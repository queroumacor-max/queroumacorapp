# AUTH — Autenticação e Autorização

Documentação do sistema de auth do QueroUmaCor. Fonte de verdade no código:
`head.js` (sessão/login/logout/signup wrapper), `modules/signup-flow.js`
(steps de cadastro), `modules/auth-pw.js` (reset/troca de senha),
`policies.js` (RBAC puro) e `functions/api/_security.js` (gates backend).

---

## 1. Stack

- **Supabase Auth** como provider único. Métodos habilitados:
  - Email + senha (`signInWithPassword`, `signUp`).
  - Magic link / OTP de recovery (usado só pelo fluxo de reset de senha
    via `resetPasswordForEmail`).
- **Tokens**: JWT de acesso (curto) + refresh token, ambos gerenciados pelo
  `@supabase/supabase-js` v2 (carregado via CDN no `index.html`, com
  fallback unpkg → jsdelivr).
- **Persistência de sessão**: `localStorage` (default do SDK). O SDK
  re-hidrata a sessão no boot via `sb.auth.getSession()` e mantém o token
  renovado automaticamente.
- **Backend**: Cloudflare Pages Functions em `functions/api/*.js`. Não há
  servidor próprio de auth — os endpoints só validam o JWT do Supabase.

---

## 2. Fluxo frontend

### Boot / hidratação

`head.js initAuth()` (linha ~544) roda no `DOMContentLoaded`:

1. Aguarda o SDK do Supabase (polling 200 ms, até 6 s — tolerância a CDN
   instável; se falhar, mostra modal "Conexão instável").
2. Detecta `#type=recovery` no hash da URL (link de e-mail de reset) e
   roteia para `screen-update-password` em vez do feed.
3. Chama `sb.auth.getSession()`. Se houver sessão, popula
   `currentUser = session.user`, chama `loadUserState()`,
   `autoDetectRole()`, `refreshProStatus()`, `checkAdminEntry()` e
   `showScreen('feed')`. Realtime subscriptions (mensagens, notificações,
   pipeline) são deferidas pra idle time pra não competir com o render
   do feed.
4. Registra `sb.auth.onAuthStateChange` pra reagir a SIGNED_IN /
   SIGNED_OUT / PASSWORD_RECOVERY: re-popula `currentUser`,
   invalida caches (`invalidateMyProfile()`) e reseta `_isPro`/`_isAdmin`
   no logout.

### Login

`head.js doLogin()` lê `#login-email` e `#login-pw`, desabilita o botão
pra evitar duplo-submit, e chama `doLoginSupabase(email, pw)`:

1. `_authRateCheck('login')` — pinga `/api/auth-rate-check` (advisory, IP-based)
   antes de bater no Supabase. Fail-open se o endpoint estiver fora.
2. `sb.auth.signInWithPassword({ email, password })`.
3. Sucesso: `currentUser = data.user`, `autoDetectRole()`,
   `showScreen('feed')`.

### Signup

`modules/signup-flow.js doSignup()` é o entry-point do botão "Criar conta"
no step 3 do wizard. Estados anteriores (role, invite code, especialidades)
ficam dentro do módulo. O fluxo:

1. Valida nome/email/senha e (pra roles profissionais) ao menos uma
   especialidade selecionada.
2. Marca invite como usado em `invites` (se aplicável).
3. Chama `doRegisterSupabase(name, email, pw, role, tag)` em `head.js`
   (linha ~971).

`doRegisterSupabase` por sua vez:

1. `_authRateCheck('signup')` (IP rate limit).
2. `sb.auth.signUp({ email, password, options: { data: { name, user_type, tag } } })`.
   Se o e-mail já existir, tenta `signInWithPassword` com a mesma senha —
   se bater, loga sem erro; senão manda pra tela de login com mensagem.
3. Faz upload do avatar (se houver) pro bucket `posts/{user.id}/avatar.{ext}`.
4. `upsert` na tabela `profiles` (id, name, tag, user_type, role, city,
   state, phone, avatar_url, birth_date, profession, specialties,
   invite_code_used, invited_by).
5. Insere linha em `referrals` quando veio por convite — pontos são
   creditados por trigger no banco (`award_referral_points`).
6. `currentUser = data.user`; vai pro feed (ou pro perfil de quem
   convidou, quando aplicável).

### Logout

`head.js doLogoutSupabase()`:

1. Flush de writes debounced de chat (`_flushConvs`, `_flushMsgs`) ANTES
   de zerar `currentUser`, senão writes pendentes ficam órfãos sem
   conseguir montar a chave de storage.
2. `currentUser = null`, `invalidateMyProfile()`, `showScreen('login')`.
3. `sb.auth.signOut()` em background — não aguarda a rede pra UI não
   ficar pendurada em "Saindo…". `_isPro`/`_isAdmin` viram `false` no
   handler `onAuthStateChange`.

### Globais expostas

- `currentUser` (objeto do Supabase user, em `head.js`).
- `_isPro`, `_isAdmin` — caches sincronizados de `profiles.is_pro` e
  `profiles.is_admin`, populados por `refreshProStatus()` /
  `checkAdminEntry()` (consultados em fast-paths).

---

## 3. Reset de senha

Em `modules/auth-pw.js` (window.Modules.authPw):

- `sendPasswordReset()` — lê o email do `#login-email`, chama
  `sb.auth.resetPasswordForEmail(email, { redirectTo: origin + '/update-password' })`.
  Passa por `_authRateCheck('reset')` (IP, 5/min).
- `doSetNewPassword()` — valida senha (≥8 chars, igual à confirmação) e
  chama `sb.auth.updateUser({ password })`.
- `_initUpdatePasswordScreen()` — invocada quando o usuário cai em
  `/update-password` via link de email. Verifica `getSession()` (o SDK já
  processou o hash `#access_token=...&type=recovery`) e abre o modal
  `reset-pw-modal`. Se a sessão de recovery não existe, mostra "link
  expirado" e volta pro login.

---

## 4. Backend auth — `functions/api/_security.js`

Helpers usados por todos os endpoints de IA / admin / dados sensíveis.

### Extração de token

- `getToken(request, body)` — header `Authorization: Bearer <jwt>` tem
  prioridade, com fallback pra `body.accessToken` (JSON).
- `getTokenFromForm(request, formData)` — variante pra multipart/form-data
  (uploads); pega `accessToken` do FormData.

### `requireAuth(env, request, body)`

Valida o JWT chamando `${SUPABASE_URL}/auth/v1/user` com o token. Retorna:

- `{ user, token }` — token válido.
- `{ user: null, anon: true }` — sem token (**fail-open por design** —
  cliente legado ainda não envia em todos os endpoints).
- `{ user: null, anon: true, warn }` — token inválido/expirado/rede.

**FAIL-OPEN é deliberado**: o helper NÃO bloqueia. Cabe ao chamador
checar `auth.user` ou usar os bundles `gateProAI` / `gateProAIForm`. O
único caller direto hoje é `moderate.js`, e ele tem o guard explícito.

### `requirePro(env, userId)`

Consulta `profiles.is_pro` e `profiles.pro_expires_at` via service-role.
Fail-open só quando faltam `userId` ou `SUPABASE_SERVICE_ROLE` (config
incompleta). **Fail-CLOSED** quando a service key existe mas o Supabase
está indisponível — evita bypass de PRO via DoS.

### `checkRateLimit(env, userId, endpoint, limit=30)`

RPC para `check_rate_limit(p_user_id, p_endpoint, p_limit)` no Postgres
(janela de 1 minuto). Fail-open se faltar service-role ou se a RPC falhar
— não bloqueia usuário legítimo por problema de infra.

### `gateProAI` / `gateProAIForm`

Bundle de `requireAuth + requirePro + checkRateLimit`. Padrão de uso em
todos os endpoints de IA:

```js
const g = await gateProAI(env, request, body, { endpoint: 'chat-ai', limit: 20 });
if (g instanceof Response) return g;  // já é a resposta de erro (401/403/429/503)
const userId = g.userId;
```

**Fail-CLOSED quando `SUPABASE_SERVICE_ROLE` não está configurada** —
retorna 503 antes mesmo de validar o token, pra garantir que nenhum
endpoint PRO vire freebie por config faltando.

### Endpoints admin

`functions/api/admin-*.js` e `upload-style-ref.js` validam contra
`env.ADMIN_EMAILS` (CSV de e-mails). Padrão:

1. Verifica `serviceKey` e `ADMIN_EMAILS` presentes — se não, 503.
2. Resolve o user via JWT (mesmo `auth/v1/user` do `requireAuth`).
3. Compara `user.email.toLowerCase()` contra a lista.

Service role só é usada nesses endpoints + `log-error.js` + `me-export.js`,
e sempre depois de validar a autorização do chamador.

---

## 5. RBAC — roles e flags

Colunas relevantes em `profiles`:

| Coluna           | Tipo    | Significado                                                              |
| ---------------- | ------- | ------------------------------------------------------------------------ |
| `role`           | text    | `'cliente' | 'pintor' | 'grafiteiro' | 'automotivo' | 'admin'`           |
| `user_type`      | text    | Sinônimo legado de `role` (escrito no signup pra compat).                |
| `is_admin`       | boolean | Cache booleano da role admin (lido em hot paths).                        |
| `is_pro`         | boolean | Assinante PRO (cobra-se via Mercado Pago).                               |
| `pro_expires_at` | tstz    | Vencimento do PRO. `null` = sem expiração.                               |
| `portal_access`  | boolean | Acesso ao `/portal` (admin da loja Cali Colors). Independente de `role`. |

Roles profissionais (`pintor`, `grafiteiro`, `automotivo`) habilitam o
modo profissional na UI (`setMode()` em `signup-flow.js`); `cliente` é o
fallback. `admin` é puramente uma flag de moderação — qualquer role pode
ter `is_admin=true`.

A coluna `profiles.role='admin'` e `profiles.is_admin=true` são dois
sinais aceitos como admin (ver `Policies.isAdmin`) — o banco grava em
colunas diferentes dependendo do path de promoção, e o código aceita os
dois pra não quebrar.

---

## 6. Policies — camada pura (`policies.js`)

Predicados puros (sem rede, sem DOM) expostos em `window.Policies`.
Recebem `currentUser` + recurso e devolvem boolean. Centraliza a lógica
de autorização do frontend, mantendo a testabilidade alta. Cobertos por
14 testes em `tests/policies.test.js`.

| Predicado                          | Permite                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `isAdmin(user)`                    | `user.is_admin === true` ou `user.role === 'admin'`.                                                           |
| `canEditProfile(user, target)`     | Dono OU admin.                                                                                                 |
| `canDeletePost(user, post)`        | Dono do post OU admin.                                                                                         |
| `canEditQuote(user, quote)`        | Apenas o pintor dono, e somente enquanto `status` não estiver em `['aceito','recusado','concluido']`.          |
| `canReplyToReview(user, r, pid)`   | Apenas o pintor avaliado. Admin NÃO responde no nome do pintor (seria forjar fala alheia).                     |
| `canModerateContent(user)`         | Admin.                                                                                                         |
| `canSeeProFeature(user)`           | `is_pro=true` OU admin (admin testa/dá suporte sem precisar de PRO próprio).                                   |
| `canFollowUser(user, targetId)`    | Logado, target existe, e não é o próprio usuário.                                                              |
| `canCreatePost(user)`              | Qualquer logado (moderação posterior decide visibilidade).                                                     |
| `canSendMessage(user)`             | Logado COM nome preenchido (sem nome, destinatário não identifica quem fala).                                  |
| `canViewAdminPanel(user)`          | Admin.                                                                                                         |
| `requireOrThrow(allowed, message)` | Helper utilitário — lança `Error(message)` se `allowed` for falsy.                                             |

Call sites legados em `app.js` ainda usam `_isAdmin`/`_isPro` direto — migração pra `Policies` é gradual.

---

## 7. Defense in depth

Camadas redundantes — qualquer uma deve barrar um atacante:

1. **RLS no Supabase** — todas as tabelas de usuário (`profiles`,
   `posts`, `comments`, `likes`, `follows`, `quotes`, `messages`,
   `notifications`, `notes`, `reviews`, `referrals`, `reports`,
   `feature_interest`, `checklists`, ...) têm policies.
2. **Filtros SQL nos endpoints** — mesmo confiando em RLS, queries
   sensíveis usam `.eq('user_id', currentUser.id)` no client e/ou no
   server. Belt-and-suspenders.
3. **Trigger `protect_profile_columns`** (BEFORE INSERT OR UPDATE em
   `profiles`) — impede escalada de `is_pro`, `portal_access` e
   `role='admin'` via insert/update direto, mesmo com a sessão do dono
   do perfil. Só rotas admin com service-role conseguem mover esses
   campos.
4. **Policies frontend** (`policies.js`) — não substitui RLS, mas evita
   render de UI inválida e bloqueia chamadas antes de chegar ao banco.

---

## 8. Rate limiting

Duas camadas:

### Edge / pre-Supabase

`functions/api/auth-rate-check.js` (chamado por `_authRateCheck` em
`head.js` antes de cada login/signup/reset):

- **IP-based** (lê `CF-Connecting-IP`).
- Limites: 10 login/min, 5 signup/min, 5 reset/min.
- Resposta 429 inclui `retry_after`. Frontend mostra toast e bloqueia o
  submit. Fail-open se o endpoint estiver fora.

### Por usuário (endpoints de IA)

`checkRateLimit(env, userId, endpoint, limit)` em `_security.js` —
RPC `check_rate_limit` no Postgres, janela de 1 minuto, contagem por
`(user_id, endpoint)`. Default 30/min, cada endpoint customiza
(ex.: `chat-ai` limit 20, `generate-logo` mais restritivo).

---

## 9. Turnstile (CAPTCHA)

Widget do Cloudflare Turnstile **está carregado no `index.html`** mas
**nenhum endpoint server-side valida o token** (`siteverify` não
implementado). O usuário pediu pra deixar assim por enquanto.

A CSP já permite `challenges.cloudflare.com` em `frame-src`/`script-src`/
`connect-src`. Pra ativar: reincluir o widget no formulário de
login/signup e implementar o POST a `siteverify` no
`functions/api/auth-rate-check.js`.

---

## 10. Admin

- Lista de admins via env var `ADMIN_EMAILS` (CSV) no Cloudflare Pages.
  Lida case-insensitive: `env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase())`.
- Endpoints admin: `admin-errors-list.js`, `admin-moderate.js`,
  `admin-users.js`, `upload-style-ref.js`. Todos:
  1. Exigem service-role configurada (senão 503).
  2. Validam o JWT contra `auth/v1/user`.
  3. Comparam `user.email` com `ADMIN_EMAILS`.
- A flag `profiles.is_admin` é cache local pra UI e policies — a
  autoridade final pra ações destrutivas é `ADMIN_EMAILS` no edge.

---

## 11. LGPD

Em `modules/info.js`:

- **`requestAccountDeletion()`** — abre WhatsApp do DPO da Cali Colors
  (`(11) 95976-5031`, `wa.me/5511959765031`) com mensagem
  pré-formatada. Não há endpoint de auto-delete — exclusão é processada
  manualmente pela equipe.
- **`baixarMeusDados()`** — chama `GET /api/me-export` com o JWT do
  usuário no header. O endpoint usa service-role pra ler todas as
  tabelas onde o usuário aparece (profiles, posts, comments, likes,
  follows, quotes, messages, notifications, notes, reviews, referrals,
  checklists, points) e devolve um JSON único pra download.
- Canal de suporte LGPD: e-mail `loja@calicolors.com.br` (configurado em
  `SUPPORT` em `app.js`).
