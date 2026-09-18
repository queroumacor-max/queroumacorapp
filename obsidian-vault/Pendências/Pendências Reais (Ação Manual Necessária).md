---
tags: [pendências, ação-manual, checklist]
---

# Pendências Reais — Ação Manual Necessária

> Esta nota consolida as pendências que **ainda estavam abertas** na última atualização do `CLAUDE.md` (2026-09-18). Antes de tratar qualquer item aqui como resolvido ou como ainda pendente, reconferir — a lição repetida no projeto é que listas de pendência escritas à mão envelhecem rápido e a maioria delas historicamente já tinha sido resolvida sem atualização da nota. Ver [[Convenções Gerais de Desenvolvimento]].

## SQL com execução não confirmada
- **RPC `claim_wa_followup_nudge`** (`/migrations/2026-09-17-whatsapp-followup-claim.sql`) — código já é fail-safe (reengajamento pausa em silêncio até confirmar). Ver [[WhatsApp - IA, Follow-up e Leads]].

## DNS / domínio (só o usuário pode mexer)
- **DNSSEC**: ligado no Cloudflare, falta o **DS record no registrador Registro.br** (`queroumacor.com.br`, domínio `.com.br`).
- **DMARC de `calicolors.com.br`**: confirmado ausente via DNS (NXDOMAIN) — falta TXT `_dmarc` no GoDaddy.

## Decisões de produto em aberto (não é bug, é escolha pendente)
- **Cloudflare Access na frente de `*.pages.dev`**: não configurado, decisão do usuário.
- **Captcha/Turnstile em `/login` e `/signup`**: desligado nos dois lados (Cloudflare WAF e Supabase Auth "Enable Captcha protection").
- **Cloudflare CSAM Scanning Tool**: não é toggle self-service — exige contato manual (`cloudflare-csam@cloudflare.com`) e assinatura do NCMEC Reporting Agreement.
- **Ampliar fail-closed de moderação pra além do 429**: decisão de produto em aberto, não feita.
- **Gap: insert direto em `posts` via PostgREST pula `/api/moderate`** — fechar de verdade exige mover a criação do post pro servidor (mudança arquitetural maior).

## Verificação não possível deste ambiente
- Login social PKCE no mobile: só testável instalando o AAB/IPA num aparelho real.
- Build nativo real (AAB/APK/IPA): sem Android SDK/Xcode neste ambiente — precisa Codemagic ou build local.

## Backlog de produto
Ver `BACKLOG.md` na raiz do repo (não migrado neste vault — é uma lista de features categorizada, não decisões já tomadas). Consultar antes de propor features novas.

---
## Ver também
[[Segurança - Cloudflare]] · [[WhatsApp - IA, Follow-up e Leads]] · [[Moderação de Conteúdo (Gemini e CSAM)]]
