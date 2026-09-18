---
tags: [whatsapp, integração, dualhook, evolution, cloud-api]
---

# WhatsApp — Canais e Envio (histórico: Evolution → Cloud API → Dualhook)

## Linha do tempo dos canais
1. **Evolution API self-hosted (Baileys)** — 2026-08-28, canal único até a Meta autenticar. Docker no Render FREE, dormia ~15min. Migrada pra **Render pago** (Starter US$7/mês) em 2026-08-29 — não dorme mais. **Aposentada** quando a Cloud API/Dualhook assumiu.
2. **WhatsApp Cloud API da Meta** — número oficial +55 11 95976-5031, WABA `102067872689175`, Phone Number ID `109293361953640` (defaults antigos, ver abaixo).
3. **Dualhook (Webhook Override)** — 2026-09-05, canal atual pro número em Coexistence. IDs novos da conexão: Phone Number ID `1220273824510260`, WABA `1320667299892030` — **defaults do código foram atualizados pra esses** (2026-09-05; sem as envs, o app apontava pro registro antigo e o recebimento falhava em SILÊNCIO).

## Autenticação do webhook
- **Modo `payload`** (default): valida WABA + phone_number_id do envelope (`isExpectedWebhookPayload`). Como os IDs são públicos, exige também `WHATSAPP_WEBHOOK_URL_SECRET` no `?token=` da URL cadastrada no Dualhook.
- **Modo `hmac`**: `X-Hub-Signature-256` com `META_APP_SECRET` — só funcionaria com app Meta PRÓPRIO; no Dualhook o secret é do app DELES, então HMAC nunca bate.
- `WHATSAPP_WEBHOOK_URL_SECRET` gerado 2026-09-05 (`openssl rand -hex 24`) — **é um PAR**: trocar só de um lado (CF Pages ou URL no Dualhook) derruba o recebimento com 401. Rotacionar = gerar novo, colar nos dois, redeploy. Sem backup se perder.
- Envio: `POST https://api.dualhook.com/v25.0/<phone_number_id>/messages`, `Authorization: Bearer DUALHOOK_API_KEY`. `WHATSAPP_ACCESS_TOKEN`/`graph.facebook.com` saíram do caminho de ENVIO desde 2026-09-05 (número em Coexistence é gerenciado pelo app Meta do Dualhook).

## Regras críticas de número de telefone
**REGRA: usar sempre `normalizeWhatsAppTarget`, NUNCA `normalizeBrPhone`, em qualquer envio.** `normalizeBrPhone` cola '55' em qualquer coisa com 10-11 dígitos — causou o incidente do "502 Bad gateway" (2026-08-28): contato dos EUA `16503154274` virou `5516503154274` inexistente, o Baileys pendurava e o Cloudflare matava a function antes de responder (502 cru). `normalizeWhatsAppTarget`: BR local ganha 55; 11 dígitos só é celular BR se o 3º for 9; 10 dígitos = fixo BR; 11-15 em outro formato = DDI estrangeiro, verbatim. Isso valeu tanto pro `sendWhatsAppText` quanto (corrigido depois, sem teste até então) pro `sendWhatsAppTemplate`.

## Falha de envio nunca responde 502/504
Cloudflare substitui o corpo de 502/504 pela própria página de erro. Regra: 4xx do Dualhook → **400**; 5xx/falha de rede → **500**, sempre com `{ error, upstreamStatus }`. 401/403 sem `code` também vira erro de credencial (Dualhook não tem `code:190` da Meta). 131047 (fora da janela de 24h) → 422. Config ausente → 503. Toda falha loga `dualhook_send_failed { status, body }` (corpo lido como TEXTO antes do parse, cobre resposta não-JSON).

## Janela de 24h da Meta
Texto livre só pra quem escreveu nas últimas 24h; fora dela, template aprovado é obrigatório (131047/132001). Abordagem de lead (quem nunca escreveu) sai **só como template** — o `AbordagemModal` removeu inteiramente a aba "texto livre" (2026-09-05, decisão do usuário): abordagem é sempre 1ª mensagem, então texto livre nunca ia enviar nada.

## Templates
- `GET /api/whatsapp/templates` consulta a Meta via Dualhook (cache 5min no isolate), filtra `APPROVED`, devolve nome/categoria/idioma/corpo/variáveis. Cai pra lista embutida se a consulta falhar.
- `<EnvioDeTemplate>` monta um campo por variável + prévia já substituída.
- Templates conhecidos: `calicolors` (fixo, sem variável), `calicolors_nome` (`{{1}}`=primeiro nome, padrão), `calicolors_abordagem_v2` (`{{1}}` nome completo, `{{2}}` cidade, `{{3}}` ramo — opt-in, só sobe pra ele com prova de que existe).
- **Regra: nunca mandar `{{1}}` vazio.** `escolherTemplate`/`primeiroNome` recusam nome vazio, telefone no lugar do nome, inicial solta — **mesma regra replicada nos DOIS lados** (server `whatsapp.ts` + portal), testada pra não divergir.
- Aviso de MARKETING pra número dos EUA (regra NANP: código de área nunca começa com 0/1) — não bloqueia, exige confirmação.

## Eventos não-mensagem no webhook
`classifyWebhookPayload` devolve 3 desfechos: `processar` (nosso WABA + mensagem + nosso número), `ignorar` (nosso WABA, evento tipo `message_template_status_update`/`account_update` → 200 sem trabalho, antes dava 403 e causava retry-storm da Meta), `rejeitar` (outro WABA/número errado → 403 de verdade).

## Bug crítico corrigido: 500 no webhook por `waitUntil` chamado solto
`const waitUntil = ctx?.waitUntil; waitUntil(seguro)` — ExecutionContext nativo do workerd exige `this` correto, lança `TypeError: Illegal invocation` **sincronamente dentro do handler**. **Regra: método de API nativa se chama NO OBJETO DONO** (`ctx.waitUntil(...)`, nunca extraído). Corrigido e confirmado em produção (2026-09-05) — fechou a corrente inteira do recebimento (webhook → parse → `whatsapp_messages` → tela).

## Status de entrega (Wave 58, 2026-09-05, SQL executado)
Migration `/migrations/2026-09-05-whatsapp-delivery-status.sql`. A Meta manda `statuses` no MESMO webhook das mensagens. `parseStatusUpdates` + `persistStatusEntrega` (PATCH por `message_id`). Bolha mostra ✓/✓✓/✓✓ azul; `failed` mostra motivo por extenso. `statusAvanca` impede status andar pra trás (Meta entrega fora de ordem). Tolera coluna ausente nos dois lados.

## Diagnóstico
`GET /api/whatsapp-evo/ping` (admin-only) mede conectividade — rota antiga da Evolution, hoje só usada manualmente se precisar (botão saiu da tela do portal).

---
## Ver também
[[WhatsApp - IA, Follow-up e Leads]] · [[WhatsApp - Portal e Mídia]] · [[Segurança - Auditorias Externas (Webhooks e Integrações)]]
