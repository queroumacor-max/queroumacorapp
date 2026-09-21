---
tags: [segurança, auditoria, rate-limiting, abuse, dos]
---

# Auditoria de Rate Limiting / Abuse

**Data:** 2026-09-13. SQL `/migrations/2026-09-13-security-audit-hardening.sql` **JÁ EXECUTADO** (confirmado).

## Achado crítico: `check_rate_limit(p_user_id uuid, ...)` nunca funcionou pra chaves não-UUID
Coluna e parâmetro sempre foram UUID, mas toda chave que não é id de usuário puro é STRING (`"ip:1.2.3.4"`, `"log-error:1.2.3.4"` etc). PostgREST recusa o cast (22P02 → HTTP 400), e `checkRateLimit` trata qualquer `!res.ok` como "indisponível" → **FAIL-OPEN**. Não é "raro estourar": **nunca rodou**. Afetava: `checkAuthRateLimit` (brute force login/signup/reset), `/api/log-error` por IP, `/api/push-notify` por IP, e os 7 endpoints com `enforceRateLimit` (checkout, delete-account, upload-style-ref, apple-iap-verify, play-billing-verify, cidades, reverse-geocode, auth/set-session-cookie).
**Não afetado**: chamadas com UUID de usuário puro (me-export, moderate, moderate-video, quote-pdf-upload, wa-suggest, admin-*, whatsapp/send, rate-limit por minuto de `gateProAI`/`gateAiUsage`, cota mensal de IA).
**Por que o teste antigo não pegava**: os testes só mockavam 200, nunca o 400 real do Postgres pra UUID inválido.
**Fix**: `ALTER COLUMN user_id TYPE text` + `check_rate_limit(p_user_id text, ...)`.

## Achado alto: `search_all` sem GRANT restrito nem teto no LIMIT
Sem REVOKE, `anon` podia chamar `POST /rest/v1/rpc/search_all` direto, sem rate limit nosso, e `p_limit=2000000000` era aceito. **Fix**: `LIMIT LEAST(coalesce(p_limit,20), 100)` + REVOKE PUBLIC/anon + GRANT só `authenticated`.

## Falsos positivos descartados (verificados)
Tokens de IA já têm teto; `moderate-video` já tem SSRF guard + timeout 20s + teto 25MB; `tts`/`moderate` já truncam input; webhooks (WhatsApp, MP) já idempotentes; `whatsapp/send`/`followup` já usam `safeEqual` (só o handshake GET do webhook usa `===`, risco residual baixo).

## Corrigido: 9 rotas de IA sem teto de tamanho de corpo
Corpo cru lido sem `Content-Length` check antes do parse. `rejectOversizedBody(request, maxBytes)` (`lib/api/security.ts`) como primeira linha do handler: chat-ai, alice, senna, fe (256KB), generate-logo (64KB), ig-art (24MB), transcribe (27MB), area-from-photo/receipt-ocr (9MB). **Limitação declarada**: só pega corpo com `Content-Length` presente; chunked sem header passa até o teto do Cloudflare Workers (~100MB, fora do nosso controle).

## Não coberto nesta rodada (reportado, não corrigido)
Janela FIXA de 1 minuto no `check_rate_limit` (não sliding window — uma migration posterior, `/migrations/2026-09-17-rate-limit-sliding-window.sql`, substitui por sliding window, mas **sem confirmação registrada de execução em produção** — ver [[Segurança - Pentest Integrado Final]]); comparação `===` no handshake GET do webhook WhatsApp; rotas `whatsapp-evo/*` (aposentadas, ver [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]]).

## Rate limit em mensagens de chat + push de mensagem sem texto

**Data:** 2026-09-15, pedido do usuário, fechando 2 pendências desta auditoria de FCM/push (ver [[Segurança - Firebase FCM e Push]]). SQL `/migrations/2026-09-15-chat-safety-hardening.sql` — **JÁ EXECUTADO** no Supabase (2026-09-15, confirmado pelo usuário: "feito"). **Não pedir pra rodar de novo.**

- **`messages` ganhou rate limit PRÓPRIO** (antes só existia no dispatch do push, 20/min por destinatário — continha o SINTOMA, não a causa). Trigger `BEFORE INSERT` chama `check_rate_limit` com chave por PAR remetente→destinatário (`sender>receiver`, não o remetente sozinho — pra não travar a loja respondendo muita gente rápido), **30 msgs/min**. Estourou → INSERT recusado com mensagem que contém "rate limit" (já bate no pattern existente de `lib/errors-friendly.ts` → "Muitas tentativas", nenhuma mudança de client necessária). `type='system'` (marcadores internos) não conta. Falha na checagem não bloqueia o envio.
- **`dispatch_push_on_notification` para de mandar o texto da mensagem no push.** Antes copiava `notifications.body`, que pra `type='message'` inclui até 80 chars do texto real (ex. "Fulano: manda o endereço que..."), direto pro corpo da notificação — aparecia na tela de bloqueio. Agora, só pra `type='message'`, o push manda "`<nome de quem mandou>` enviou uma mensagem" (nome vem do `actor_id`, já gravado na notificação). **`notifications.body` NÃO muda** — a tela `/notificacoes` dentro do app continua mostrando o preview completo; só o que SAI pelo push foi redigido.
- Testes: `__tests__/chatSafetyHardening.test.ts` (lê o SQL e trava os dois invariantes) + caso novo em `__tests__/lib/errors-friendly.test.ts`.
- Essa redação de push foi estendida a comentários (`type='comment'`) só depois, na auditoria Bloco 21 — ver [[Segurança - Auditoria Final (Bloco 21, OWASP ASVS, Release Gate)]].

---
## Ver também
[[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Segurança - Firebase FCM e Push]] · [[Segurança - Auditoria Final (Bloco 21, OWASP ASVS, Release Gate)]] · [[Segurança - Pentest Integrado Final]]
