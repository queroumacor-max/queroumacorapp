---
tags: [segurança, auditoria, cloudflare, tls, dns]
---

# Auditoria de Segurança Cloudflare

**Data:** 2026-09-13, branch `claude/cloudflare-security-audit-gurtsy`.

## Achados principais
- **Next.js 15.5.2 com 3 CVEs CRITICAL** → `next` pra `15.5.25` (mesma minor) + `next-app/.npmrc` com `legacy-peer-deps=true`. Build real testado ponta a ponta (`npm run build:cf` + `wrangler pages dev`). **Regra nova**: essa trava de peer dep é conhecida — não é motivo pra reverter bump de PATCH; só minor/major exige rever o adapter primeiro.
- **Source maps do bundle client-side vazavam publicamente**: 157 arquivos `.js.map` no artefato final, baixáveis. `next-app/scripts/strip-source-maps.mjs` apaga todo `.map` pós-build, plugado no `build:cf`. `deploy.yml` corrigido pra chamar `build:cf` + step que FALHA o job se sobrar `.map`/`.env*`.
- **Chamadas ao Gemini paravam API key na query string** (`?key=...`) em 8 pontos — movido pro header `x-goog-api-key`.
- `deploy.yml` (workflow_dispatch) podia publicar produção de QUALQUER branch → `if: github.ref == 'refs/heads/main'`.
- Comparação de token do webhook Evolution trocada de `!==` pra `safeEqual`.
- `_headers`/`_redirects` da RAIZ são INERTES (Cloudflare Pages publica de `next-app/.vercel/output/static`) — confirmado por inspeção real do artefato. Fonte única de CSP é `headers()` do `next.config.mjs`, confirmada por curl real.
- KV/R2/D1/Durable Objects/Queues/Workers AI/Service Bindings/Zero Trust: **nenhum em uso real**.

## Chave Gemini vazada no histórico do Git — RESOLVIDO (2026-09-16)
Chave `...sZN_IE` recuperável via `git show a735531:queroumacorportal.html`, mas confirmado que já não existe mais na conta Google AI Studio (só existem `...iVmQ` e `...LsIU` hoje, nenhuma bate). **Não pedir pra rotacionar de novo.**

## MANUAL ACTION REQUIRED — resolvido depois
Preview env vars do Cloudflare Pages: **reconciliado em 2026-09-17** — painel real tem só 5 vars públicas, nenhum secret de produção. `STAGING.md` (que dizia o contrário) foi corrigido.

## Segunda rodada de verificação por console (2026-09-16)
- `exec_sql`/`executar_sql`: **confirmado removido em produção** (0 rows).
- Config Auth Supabase: "Confirm email" e "Allow anonymous sign-ins" desligados (esperado); **"Enable Captcha protection" DESLIGADO** — mesma lacuna do "Bot Fight Mode/Turnstile ausente em `/login`/`/signup`", vista pelo lado do Supabase Auth; "Prevent use of leaked passwords" LIGADO (bom).
- 5 custom rules do WAF ativas (bloqueou 794 tentativas reais) + 2 allowlists.
- `CLOUDFLARE_API_TOKEN`: escopo mínimo confirmado. `SENTRY_AUTH_TOKEN`: confirmado ausente do build (sem impacto de segurança, só operacional).
- Rotas `whatsapp-evo/*`: testadas ao vivo, fechadas (405/401), caminho morto mas não vulnerável.
- Cloudflare Access na frente de `*.pages.dev`: NÃO configurado — decisão do usuário em aberto.
- DMARC de `calicolors.com.br`: CONFIRMADO ausente via lookup DNS (NXDOMAIN) — ação só do usuário.

## SSL/TLS — parcialmente fechado (2026-09-16)
- ✅ Mode Full → **Full (Strict)** — feito.
- 🟡 **DNSSEC ligado no Cloudflare** (3ª sessão) — falta só o **DS record no registrador Registro.br** (`.com.br`). Pendência real é só essa.
- ✅ Registro CAA criado e publicado (6 registros, 3 CAs: letsencrypt.org, pki.goog, ssl.com).
- TLS mínimo 1.2 mantido de propósito (decisão do usuário); TLS 1.3 já habilitado no edge.
- Always Use HTTPS + HSTS (12 meses, includeSubDomains, preload) OK.

**Regra registrada**: "verificar que X está desligado" ≠ "ligar X" — um relato que confirma o estado sem executar a ação não fecha a pendência.

## Ainda aberto
Login social PKCE no mobile — só testável em aparelho real. Cloudflare CSAM Scanning Tool — não é toggle self-service, exige contato manual (ver [[Moderação de Conteúdo (Gemini e CSAM)]]).

---
## Ver também
[[Infraestrutura - Cloudflare, Env Vars e Deploy]] · [[Segurança - Auditoria CI-CD]] · [[Pendências Reais (Ação Manual Necessária)]]
