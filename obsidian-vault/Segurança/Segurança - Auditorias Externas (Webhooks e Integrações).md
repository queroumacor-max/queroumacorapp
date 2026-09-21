---
tags: [segurança, auditoria, webhooks, whatsapp, mercado-pago, firebase]
---

# Auditoria de Segurança — Webhooks, Callbacks e Integrações Externas

**Data:** 2026-09-17/18 · PRs #328/#332/#333/#334/#335, todas mergeadas.
**Status:** código **CONFIRMADO EM PRODUÇÃO** (commit `7c4f24f`, verificado no painel Cloudflare Pages).

Modelo de ameaça: *"um atacante consegue falsificar, repetir, atrasar, reordenar ou manipular um evento externo pra causar uma ação que o sistema deveria aceitar só de um provider confiável?"* — cobriu Meta/WhatsApp Cloud API, Mercado Pago, Dualhook, Evolution legada, Firebase/FCM, push notifications.

## ⚠️ Ressalva importante (achado do Codex, PR #336)
"Código mergeado" e "SQL rodado" são coisas **diferentes**. A migration `/migrations/2026-09-17-whatsapp-followup-claim.sql` (RPC `claim_wa_followup_nudge`) **NÃO tem confirmação de execução no Supabase**. Enquanto não rodar, o código é fail-safe: `reservarReengajamento` trata RPC ausente (42883/PGRST202/erro de rede) como reserva NEGADA — a fase de **REENGAJAMENTO** do follow-up fica pausada em silêncio até alguém confirmar a execução. A fase de COBRANÇA não depende dessa RPC (usa PATCH condicional em `portal_alerts`, que já existe sempre).

## PR #328 — dois achados reais corrigidos
- **SSRF crítico em `/api/push-notify`**: `push_subscriptions.endpoint` é gravado pelo CLIENTE (RLS só garante `user_id=auth.uid()`) e o handler fazia `fetch(sub.endpoint,…)` sem checar host — qualquer usuário podia apontar pra URL arbitrária (metadado de nuvem, rede interna). **Fix**: allowlist de hostname em `lib/api/_services/push-endpoint-guard.ts` — só `fcm.googleapis.com`, `android.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`/`*.wns.windows.com`, sempre `https://`.
- **Bug de corretude** achado escrevendo o teste acima: DER/PKCS8 manual do `VAPID_PRIVATE_KEY` tinha dois comprimentos ASN.1 errados — Web Push nativo podia estar silenciosamente morto em produção. Corrigido junto.
- **Duplicidade de efeito colateral no WhatsApp**: atendimento automático (IA) rodava pra toda mensagem sem checar wamid duplicado — reentrega da Meta/Dualhook ou replay mandava 2ª resposta de verdade. **Fix**: `persistInboundMessage` usa `INSERT … ON CONFLICT DO NOTHING` + `return=representation` (atômico), só deixa `maybeAutoReply` rodar em wamid **realmente novo**. Gap achado pelo Codex (PR #336) corrigido na mesma PR: a checagem original só pulava a IA em `'duplicate'`, não em `'error'` — agora fail-closed, só roda quando o resultado é exatamente `'inserted'`.
- **Mesma classe de corrida no follow-up horário**: reserva atômica no banco antes do envio — PATCH condicional `followed_up_at=is.null` (cobrança) e RPC `claim_wa_followup_nudge` (reengajamento, ver ressalva acima).

## PR #332 — limpeza de código morto (Evolution API)
`whatsapp-evo.ts` só com `normalizeWhatsAppTarget`; `whatsapp-media.ts` perdeu caminho de mídia base64-no-webhook; rota morta `/api/whatsapp-evo/ping` removida.

## Achado L3 — raio de vazamento do segredo do follow-up (rollout em 3 PRs)
- **#333**: registra `UPDATE` de `app_settings.whatsapp_followup_url` pro segredo dedicado `WHATSAPP_FOLLOWUP_URL_SECRET`.
- **#334**: só depois de confirmação em produção, remove fallbacks pro `WHATSAPP_WEBHOOK_URL_SECRET` e `EVOLUTION_WEBHOOK_TOKEN` — reduz raio de vazamento.
- **#335**: `.env.example` estava listando Evolution API inteira (código morto) e faltavam as 6 envs reais do WhatsApp Cloud API/Dualhook (`DUALHOOK_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_URL_SECRET`, `WHATSAPP_FOLLOWUP_URL_SECRET`) — corrigido.

## Verificado sem achado
`MP_WEBHOOK_SECRET` (Mercado Pago): HMAC timing-safe, janela anti-replay 600s, sempre busca estado LIVE na API do MP. `/api/quote-pdf-upload`, `/api/reverse-geocode`, `moderate-video.ts`, `/api/upload-style-ref`: sem SSRF explorável.

## Achado L2 — corrigido no PR #328
`brand-logos.ts` baixava URL que a resposta da OpenAI devolve sem checar host. `lib/api/ssrf-guard.ts` (blocklist de IPv4/IPv6 privado/reservado/CGNAT) bloqueia antes do fetch.

## Lição de processo
Sessão anterior já tinha reclamado no CLAUDE.md de auditoria não documentada. Esta sessão quase repetiu — documentou tudo só ao final, depois de o usuário perguntar. **Registrar imediatamente após confirmação de produção, não deixar pra sessão futura notar a lacuna.**

---
## Ver também
[[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]] · [[Segurança - Firebase FCM e Push]] · [[Segurança - Auditoria Final (Bloco 21, OWASP ASVS, Release Gate)]] · [[Segurança - Disaster Recovery e Business Continuity]] · [[Pendências Reais (Ação Manual Necessária)]]
