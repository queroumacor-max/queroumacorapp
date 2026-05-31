# API — /functions/api/

> Cloudflare Pages Functions. Cada `<name>.js` vira rota `POST /api/<name>` (ou GET, dependendo do export).
> Files prefixed com `_` (ex: `_security.js`, `_ai.js`) NÃO viram rotas — só módulos compartilhados.

## Autenticação
- Token JWT do Supabase em `Authorization: Bearer <jwt>` (preferido)
- OU `body.accessToken` (fallback; multipart usa `formData.get('accessToken')`)
- `_security.js getToken()` / `getTokenFromForm()` leem os dois — header tem prioridade
- `requireAuth` é **fail-open** quando token ausente/inválido (retorna `{user:null, anon:true}`); chamadores diretos têm que validar `auth.user`
- `gateProAI` / `gateProAIForm` = requireAuth + requirePro + checkRateLimit (fail-CLOSED se faltar service-role key — retorna 503)

## Rate limiting
- Backed por `rate_limits` table + RPC `check_rate_limit` no Supabase
- Helper `_security.js checkRateLimit(env, key, endpoint, limit)`
- Fail-open quando `SUPABASE_SERVICE_ROLE` não está configurada

## Endpoints

### POST /api/admin-errors-list
- Auth: ADMIN (email em `ADMIN_EMAILS`) + JWT
- Rate limit: 60/min por admin
- Input: `{ accessToken?, ... filtros }`
- Output: lista de rows da tabela `errors`; `503` sem config, `401` sem token, `403` não admin
- Env: `SUPABASE_SERVICE_ROLE*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`
- Também exporta `onRequestOptions` (CORS preflight)

### POST /api/admin-moderate
- Auth: ADMIN
- Rate limit: 60/min
- Input: `{ accessToken, action, postId }` (aprovar/rejeitar posts da fila)
- Env: `SUPABASE_SERVICE_ROLE*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`

### POST /api/admin-users
- Auth: usuário com `portal_access=true` (verificado via service role)
- Rate limit: 30/min
- Input: `{ accessToken, action, userId, value? }` — `action ∈ {promote, revoke, verify, set_pro, ...}`; aplica patch em `profiles`
- Env: `SUPABASE_SERVICE_ROLE*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

### POST /api/agenda-order
- Auth: PRO (`gateProAI`)
- Rate limit: 5/min
- Input: `{ date, jobs:[{id, client_name, address, scheduled_time}] }` (mín. 2, máx. 40)
- Output: `{ ordered_ids:[...], notes:"..." }` (heurística de IA com base no texto dos endereços)
- Env: `OPENAI_API_KEY` ou `GEMINI_API_KEY`

### POST /api/area-from-photo
- Auth: PRO (`gateProAIForm`)
- Rate limit: 5/min
- Input: multipart com `image` (≤ 8 MB) + `accessToken`
- Output: `{ area_m2, justification }` via OpenAI gpt-4o-mini vision
- Env: `OPENAI_API_KEY`

### POST /api/auth-rate-check
- Auth: nenhuma (advisory por IP)
- Rate limit: login=10/min, signup=5/min, reset=5/min — chave por IP+action
- Input: `{ action?: 'login'|'signup'|'reset' }`
- Output: `{ allowed:true, action, limit, skipped }` ou 429
- Também exporta `onRequestOptions`

### POST /api/caption
- Auth: PRO (`gateProAIForm`)
- Rate limit: 10/min
- Input: multipart `image` (≤ 8 MB) + `accessToken`
- Output: `{ caption, hashtags[] }` (4–6 hashtags PT-BR) via OpenAI gpt-4o-mini
- Env: `OPENAI_API_KEY`

### POST /api/chat-ai
- Auth: PRO (`gateProAI`)
- Rate limit: 20/min
- Input: `{ message, history?:[{role,content}], accessToken? }` (Seu Zé persona)
- Output: `{ reply }` com fallback OpenAI→Gemini via `_ai.callAIText`
- Env: `OPENAI_API_KEY` ou `GEMINI_API_KEY`

### POST /api/checkout
- Auth: JWT obrigatório (verifica no Supabase; userId/email vêm SÓ do token)
- Input: `{ accessToken }`
- Output: `{ init_point }` (preapproval recorrente do Mercado Pago)
- Env: `MP_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

### GET /api/cidades?uf=SP
- Auth: nenhuma
- Cache: edge 30 dias, browser 1 dia
- Input: query `uf` ∈ whitelist das 27 UFs
- Output: `{ uf, cidades:[{nome}] }` (proxy do IBGE)

### POST /api/crm-draft
- Auth: PRO (`gateProAI`)
- Rate limit: 10/min
- Input: `{ clientName, lastService, monthsSince, painterName }`
- Output: `{ message }` — texto de WhatsApp pronto pra reativar cliente
- Env: `OPENAI_API_KEY` ou `GEMINI_API_KEY`

### POST /api/fin-analysis
- Auth: PRO (`gateProAI`)
- Rate limit: 5/min
- Input: `{ thisMonth, lastMonth, recentJobs[] }` (agregados financeiros)
- Output: análise em 3–4 frases PT-BR
- Env: `OPENAI_API_KEY`

### POST /api/generate-logo
- Auth: PRO (`gateProAI`)
- Rate limit: 3/min
- Input: `{ name, style? }`
- Output: 3 URLs de logo via OpenAI `images/generations` (badge, monograma, lockup horizontal)
- Env: `OPENAI_API_KEY`

### GET/POST/etc /api/health
- Auth: nenhuma (export é `onRequest` — qualquer método)
- Output: `{ status, time, app, region, version, supabase }` sempre 200
- Env: opcionalmente `CF_PAGES_COMMIT_SHA`, `SUPABASE_URL`

### GET /api/ig-art-diag
- Auth: PRO (`gateProAI`)
- Rate limit: 10/min
- Input: query `?openai=1` opcional
- Output: lista de modelos Gemini disponíveis + teste opcional OpenAI
- Env: `GEMINI_API_KEY` (e `OPENAI_API_KEY` se `openai=1`)

### POST /api/ig-art
- Auth: PRO (`gateProAI`)
- Input: `{ photoDataUrl, photoDataUrl2?, style?, aspect?, captionHint?, businessName?, accessToken? }`
- Output: `{ imageDataUrl, caption, ... }` — gpt-image-1 primário, Gemini image fallback, legenda paralela
- Limites: 8 MB foto; outer hard-timeout 28s
- Env: `OPENAI_API_KEY` (+ `GEMINI_API_KEY` opcional para fallback), `SUPABASE_URL` (style-refs)

### POST /api/log-error
- Auth: opcional
- Rate limit: 60/min por IP
- Input: `{ type, msg, stack, url, ua, metric, value, ctx }` (campos truncados)
- Output: `{ ok:true }` — loga no console.log e persiste em `errors` (fail-open se sem service-role)
- Também exporta `onRequestOptions`
- Env: `SUPABASE_SERVICE_ROLE*` (opcional), `SUPABASE_URL`

### POST /api/me-export
- Auth: JWT (`getToken`) obrigatório
- Rate limit: 3/min
- Input: `{ accessToken? }`
- Output: JSON com todos os dados pessoais do usuário (LGPD Art. 18 V)
- Env: `SUPABASE_SERVICE_ROLE*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

### POST /api/moderate
- Auth: JWT obrigatório (`requireAuth` + guard explícito `!auth.user → 401`)
- Rate limit: 20/min
- Input: `{ text, imageUrl? }` (imageUrl restrita a Supabase Storage do projeto — anti-SSRF)
- Output: `{ flagged, severity:'none|soft|hard', reasons[], engine:'gemini' }`
- Env: `GEMINI_API_KEY`

### POST /api/moderate-video
- Auth: JWT (token validado + `user_id` owner do post)
- Rate limit: 3/min
- Input: `{ accessToken, postId, caption? }` — vídeo já no storage como `pending`
- Output: `{ status:'approved'|'rejected'|'pending', reasons[] }` (Gemini frames + áudio nativo); >25 MB → pending p/ revisão humana
- Env: `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

### POST /api/mp-checkout-loja
- Auth: JWT obrigatório (verifica posse + status `pending` do pedido)
- Input: `{ orderId, accessToken }`
- Output: `{ init_point, orderId }` (preference one-shot do MP)
- Env: `MP_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, opcionalmente `SUPABASE_SERVICE_ROLE*`

### POST/GET /api/mp-webhook
- Auth: HMAC-SHA256 via header `x-signature` quando `MP_WEBHOOK_SECRET` setado (fail-open se sem secret)
- Input: payload nativo do Mercado Pago (assinatura/pagamento)
- Output: `{ received:true }` (sempre 200 quando válido, para o MP não reenviar)
- Também responde `onRequestGet` (healthcheck do MP)
- Env: `MP_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE*`, `SUPABASE_URL`, opcionalmente `MP_WEBHOOK_SECRET`, `MP_WEBHOOK_ENFORCE`

### POST /api/pricing-suggest
- Auth: PRO (`gateProAI`)
- Rate limit: 15/min
- Input: `{ service_type, description, area_m2 }`
- Output: `{ price, justification }` via OpenAI gpt-4o-mini com `json_object`
- Env: `OPENAI_API_KEY`

### POST /api/resolve-color
- Auth: PRO (`gateProAI`)
- Rate limit: 30/min
- Input: `{ items:[{id, name, code}] }` (máx 60)
- Output: `{ colors: { id: '#rrggbb' | null } }`
- Env: `OPENAI_API_KEY` ou `GEMINI_API_KEY`

### POST /api/transcribe
- Auth: PRO (`gateProAIForm`)
- Rate limit: 10/min
- Input: multipart `audio` (≤ 25 MB) + `accessToken`
- Output: `{ text }` via OpenAI Whisper (`whisper-1`, language pt)
- Env: `OPENAI_API_KEY`

### POST /api/tts
- Auth: PRO (`gateProAI`)
- Rate limit: 10/min
- Input: `{ text }` (≤ 2000 chars)
- Output: `audio/mpeg` (OpenAI `tts-1` voz `onyx`)
- Env: `OPENAI_API_KEY`

### POST /api/upload-style-ref
- Auth: ADMIN (email em `ADMIN_EMAILS`) + JWT via header Authorization
- Input: `{ styleKey, photoDataUrl }` — `styleKey ∈ {portrait, antesdepois, profissional, trabalho, grafite}`; ≤ 4 MB
- Output: `{ ok:true, url, styleKey, path }` (upload no bucket `style-refs` via service_role)
- Env: `SUPABASE_SERVICE_ROLE*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`

## Env vars necessárias
Consolidado via grep `env.<NAME>` nos arquivos:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE` / `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (3 nomes aceitos por compat)
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_IMG_MODEL` (opcional — override do modelo de imagem padrão)
- `ADMIN_EMAILS` (comma-separated)
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET` (opcional)
- `MP_WEBHOOK_ENFORCE` (opcional — força rejeição quando assinatura inválida)
- `CF_PAGES_COMMIT_SHA` (auto-injetada pelo Pages, usada em `/api/health`)
- `ASSETS` (binding nativo do Pages — usado por `health.js` indiretamente)

## Convenções de resposta
- Sucesso: `{ ok:true, ... }` ou objeto com dados específicos do endpoint
- Erro: `{ error: '<mensagem em PT-BR>' }`
- Status codes:
  - `400` JSON inválido / payload faltando
  - `401` sem token / token inválido
  - `403` não autorizado (não-admin, não-PRO)
  - `404` recurso não encontrado
  - `413` arquivo grande demais
  - `429` rate limit (header `retry-after`)
  - `500` erro interno
  - `502` upstream (OpenAI/Gemini/IBGE/MP/Supabase) falhou
  - `503` config faltando (env var ausente)
  - `504` upstream timeout
