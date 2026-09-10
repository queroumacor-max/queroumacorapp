# WhatsApp Cloud API — integração backend

Integração do número oficial da Cali Colors (**+55 11 95976-5031**) com o
WhatsApp Cloud API da Meta, pra enviar mensagens programaticamente e receber
mensagens/status via webhook.

## IDs da conta (não são secrets)

| Item | Valor |
| --- | --- |
| WABA ID (WhatsApp Business Account) | `102067872689175` |
| Phone Number ID | `109293361953640` |
| Número | +55 11 95976-5031 (CaliColors Tintas) |
| App Meta | CaliColors Integracao API (App ID `1752105782712789`) |
| Versão do Graph | `v21.0` |

Esses IDs estão como default em `next-app/lib/api/_services/whatsapp.ts` —
aparecem na URL da API e no painel da Meta, então não há problema em
versioná-los. **O token de acesso NUNCA entra no repo.**

## Variáveis de ambiente (Cloudflare Pages → Production)

| Env | Obrigatória | O que é |
| --- | --- | --- |
| `DUALHOOK_API_KEY` | Sim (pra enviar) | Outbound API key do Dualhook (`dh_live_…`). **Secret.** Substituiu o `WHATSAPP_ACCESS_TOKEN` em 2026-09-05: com o número em Coexistence gerenciado pelo app Meta do Dualhook, o token do NOSSO app não tem permissão nesse `phone_number_id`. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Sim (pro webhook) | Com **Dualhook**: o Verify Token gerado no painel deles (conexão → Webhook Override). Sem Dualhook: string qualquer escolhida por nós, colada no painel da Meta ao cadastrar o webhook. |
| `WHATSAPP_WEBHOOK_URL_SECRET` | Sim com Dualhook | String alta-entropia (`openssl rand -hex 24`) que vai na query da URL cadastrada no Dualhook: `…/api/whatsapp/webhook?token=<secret>`. Sem ela o modo `payload` responde 503 (fail-closed). **Secret.** |
| `WHATSAPP_WEBHOOK_AUTH_MODE` | Não | `payload` (default) = modo Dualhook, valida WABA + phone_number_id do envelope. `hmac` = app Meta próprio, valida `X-Hub-Signature-256` com `META_APP_SECRET`. |
| `META_APP_SECRET` | Só no modo `hmac` | App Secret do app "CaliColors Integracao API" (Meta → Configurações do app → Básico). **Secret.** Inútil com Dualhook (a assinatura é do app deles). |
| `WHATSAPP_PHONE_NUMBER_ID` | Sim com Dualhook | Phone Number ID do número conectado. Default no código = número antigo (`109293361953640`); a conexão Dualhook (Coexistence) é **`1220273824510260`**. |
| `WHATSAPP_WABA_ID` | Sim com Dualhook | WABA ID. Default no código = WABA antiga (`102067872689175`); a do Dualhook é **`1320667299892030`**. |

Depois de setar as envs, **refazer o deploy** (envs só valem em build novo).

## Endpoints

### `POST /api/whatsapp/send` — envio (só admin)

Auth igual ao `/api/admin/users`: token Supabase (header `Authorization:
Bearer …` ou `accessToken` no body) de uma conta admin — e-mail em
`ADMIN_EMAILS` OU perfil promovido no portal (`profiles.portal_access`),
ver `ensurePortalAdmin` (2026-09-10).
Rate limit 30/min. Grava trilha em `audit_log` (`action='whatsapp.send'`,
só preview do corpo — LGPD data minimization).

```jsonc
// texto livre (só funciona dentro da janela de 24h)
{ "to": "(11) 98888-7777", "body": "Seu pedido está pronto!" }

// template aprovado (funciona sempre)
{
  "to": "5511988887777",
  "type": "template",
  "template": "pedido_pronto",
  "languageCode": "pt_BR",
  "components": [{ "type": "body", "parameters": [{ "type": "text", "text": "Zé" }] }]
}
```

Resposta: `{ ok: true, messageId: "wamid.…", waId: "5511988887777" }`.

O telefone aceita máscara BR com ou sem DDI (`normalizeBrPhone`).

**Janela de 24h da Meta**: mensagem de TEXTO livre só chega pra quem mandou
mensagem pro número nas últimas 24h. Fora da janela o Graph devolve o erro
131047 e a rota responde **422** com "use um template aprovado". Templates
são criados/aprovados no painel da Meta (WhatsApp Manager → Message
Templates).

### `GET/POST /api/whatsapp/webhook` — recebimento

- **GET** = verificação (painel da Meta ou "Test verification GET" do
  Dualhook): confere `hub.verify_token` contra
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, devolve `hub.challenge` em texto puro.
- **POST** = eventos. Autenticação por `WHATSAPP_WEBHOOK_AUTH_MODE`:
  - `payload` (default, **Dualhook**): primeiro o `?token=` da URL tem que
    bater com `WHATSAPP_WEBHOOK_URL_SECRET` (GET e POST; ausente → 503,
    errado → 403/401) — é isso que autentica o remetente, porque WABA e
    phone_number_id são públicos e forjáveis. Depois o envelope tem que ser
    `whatsapp_business_account`, com `entry[].id` = `WHATSAPP_WABA_ID` e
    `changes[].value.metadata.phone_number_id` = `WHATSAPP_PHONE_NUMBER_ID`
    (`isExpectedWebhookPayload`). Qualquer desvio → 401. Motivo: no fluxo
    de Embedded Signup do Dualhook o `X-Hub-Signature-256` é assinado pelo
    app Meta **do Dualhook**, cujo secret não é exposto — HMAC nosso nunca
    bate (doc deles: "No META_APP_SECRET? … validate inbound webhook
    payload shape instead").
  - `hmac` (app Meta próprio): `X-Hub-Signature-256` = HMAC-SHA256 do
    `META_APP_SECRET` sobre o raw body, validado ANTES do parse; inválida →
    401, secret ausente → 503.
  Depois de autenticado, **sempre 200** (anti-retry-storm, mesma filosofia
  do mp-webhook).
- Mensagens recebidas são logadas (preview 60 chars → CF logs) **e
  gravadas em `whatsapp_messages`** (SQL Wave 38) via service_role,
  best-effort: falha de gravação não muda o 200. O `message_id` (wamid)
  é UNIQUE — retry de webhook da Meta não duplica linha. Tabela separada
  da `messages` do chat interno (aqui o interlocutor é telefone externo).

## Tela admin `/admin/whatsapp`

Guard `requireAdminServer()` (CRIT-4) + RLS (SELECT só `is_portal_admin()`).
Lista as mensagens em estilo conversa (recebidas à esquerda, enviadas à
direita), com filtros Todas/Recebidas/Enviadas, poll de 15s e botão
"Responder" que preenche o número no formulário de envio (texto livre via
`/api/whatsapp/send`). É a forma prática de testar envio/recebimento ponta
a ponta sem curl nem logs do Cloudflare.

## SQL Wave 38 — `whatsapp_messages`

Migration em `/migrations/2026-08-25-whatsapp-messages.sql`. Sem a tabela,
webhook e envio seguem funcionando (persistência é best-effort) — mas a
tela `/admin/whatsapp` fica vazia e mostra erro de tabela inexistente na
listagem.

### Cadastro do webhook via Dualhook (atual — Coexistence)

1. dualhook.com → Connections → conexão "Cali Colors" → **Webhook
   Override**.
2. Webhook URL: `https://queroumacor.com.br/api/whatsapp/webhook?token=<WHATSAPP_WEBHOOK_URL_SECRET>`
   (gerar o segredo com `openssl rand -hex 24`, salvar na env do CF Pages
   ANTES de cadastrar a URL).
3. Verify Token: copiar o gerado pelo Dualhook e colar na env
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` do CF Pages → redeploy → "Test
   verification GET" no Dualhook (ele re-registra na Meta sozinho).
4. Setar `WHATSAPP_PHONE_NUMBER_ID` e `WHATSAPP_WABA_ID` com os IDs da
   conexão (Account Details no Dualhook). Sem isso o POST devolve 401
   "payload inesperado" porque os defaults são do número antigo.
5. Envio: `DUALHOOK_API_KEY` (Outbound API key, `dh_live_…`) no CF Pages.
   O service já fala com `https://api.dualhook.com` — ver abaixo.

### Envio de mensagens (`sendWhatsAppMessage`)

`POST https://api.dualhook.com/v25.0/<WHATSAPP_PHONE_NUMBER_ID>/messages`,
com `Authorization: Bearer <DUALHOOK_API_KEY>`.

O Dualhook **espelha o contrato da Cloud API**: mesmo path, mesmo corpo
(`messaging_product`, `to`, `type`, `text`/`template`…) e mesma forma de
resposta e de erro. Por isso os builders de payload não mudaram — trocaram
só a base e o header de auth.

**Nenhuma falha responde 502 ou 504.** O Cloudflare substitui o corpo dessas
duas pela página de erro dele, e a mensagem que explica a falha nunca chega
na tela — o operador via só "502 Bad gateway" e não sabia se era credencial,
janela de 24h ou número errado. Mapeamento:

| Situação | HTTP nosso | Corpo |
| --- | --- | --- |
| 4xx do Dualhook (credencial, número inválido…) | **400** | `{ error, upstreamStatus }` |
| 5xx do Dualhook, ou falha de rede | **500** | idem (`upstreamStatus: 0` na rede) |
| `131047` (fora da janela de 24h) | **422** | mensagem acionável |
| Sem `DUALHOOK_API_KEY` | **503** | config ausente |

Toda falha loga `dualhook_send_failed { status, body }` (corpo cru, → CF
logs). O corpo é lido como TEXTO antes do parse: resposta não-JSON (HTML de
proxy, corpo vazio) é justamente o caso que mais precisa aparecer no log, e
`res.json()` a engoliria.

`190` **ou qualquer 401/403** vira "credencial do Dualhook inválida" — o 401
deles não carrega o `code` da Meta, e sem essa ramificação a mensagem
mandaria olhar o painel errado.

O portal exibe o `error` na faixa "Falha no envio" sem precisar de mudança:
ele já lê `res.error` do JSON.

### Cadastro do webhook no painel da Meta (legado — app próprio)

1. developers.facebook.com → app "CaliColors Integracao API" → WhatsApp →
   Configuration → Webhook.
2. Callback URL: `https://www.queroumacor.com.br/api/whatsapp/webhook`
3. Verify token: o mesmo valor da env `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
4. Subscribe no campo **messages**.
5. Setar `WHATSAPP_WEBHOOK_AUTH_MODE=hmac` + `META_APP_SECRET`.

## Segurança

- Token só em env do CF Pages (lido via `getRuntimeEnv()` — no edge os
  secrets NÃO chegam em `process.env`; ver `lib/api/env.ts`).
- Se o token vazar (colado em lugar público, commitado por engano):
  regenerar na hora em Meta Business Settings → System Users → token do
  app. O código não muda — só trocar a env e redeploy.
- Envio é admin-only + rate limit + audit log. Sem endpoint público de
  envio: usuário comum continua usando links `wa.me` (client-side, sem
  token).

## Testes

`next-app/__tests__/services/whatsapp.test.ts` (22): normalização de
telefone BR, shape dos payloads do Graph, config/503, envio com fetch
stubado (happy path, 131047→422, 190→502, rede→502), assinatura HMAC do
webhook e parse do envelope de mensagens da Meta.
