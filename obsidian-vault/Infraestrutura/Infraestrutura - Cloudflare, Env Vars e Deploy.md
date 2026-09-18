---
tags: [infraestrutura, cloudflare, deploy, env-vars]
---

# Infraestrutura — Cloudflare Pages, Env Vars e Deploy

## Fluxo de deploy
`main` → deploy automático no Cloudflare Pages. Branch que não é `main` ganha preview em `<branch-slug>.queroumacorapp.pages.dev` — testar features arriscadas lá antes do merge (banner amarelo "🧪 STAGING" quando fora do domínio de produção). Após merge, aguardar ~90s e avisar o usuário que **provavelmente** está no ar (sem confirmação real — egress do container bloqueia o domínio de produção).

## Regra de ouro do runtime
**Ler env sempre por `getRuntimeEnv()` (`lib/api/env.ts`), nunca `process.env` direto.** No edge do Cloudflare, secrets só existem no request context (`Symbol.for('__cloudflare-request-context__')`), não em `process.env`. 57 leituras cruas foram corrigidas em 2026-09-01 (toda a camada de IA + pagamentos + `/api/health`). Teste de arquitetura (`__tests__/lib/env-runtime-rule.test.ts`) varre `lib/api`/`app/api` e falha se reaparecer.
Corolário: **nada que dependa de env pode rodar no MODULE-LOAD** — não existe request no boot.

## Planos pagos
- **Supabase PRO** ($25/mês): 8GB DB, 50GB bandwidth, 7 dias PITR, 100GB storage, sem pause por inatividade.
- **Cloudflare PRO**: WAF managed rules, Image Resizing/Polish, mobile redirect, web analytics RUM.

## Regras de SQL e memória do projeto
- **Toda migration nova: colar o SQL completo no chat, em texto**, pro usuário rodar no SQL Editor — Claude não tem acesso ao banco.
- **A lista de "SQL pendente" do CLAUDE.md NÃO é evidência.** Regra criada depois de 7 de 9 pendências listadas estarem erradas (6 já feitas, 1 sem sentido). Antes de dizer que falta rodar algo — e antes de pedir pra rodar de novo — reconferir com `/migrations/2026-09-05-conferencia-pendencias.sql` (checagem read-only, ok true/false).
- MCP Supabase deste ambiente aponta pra OUTRO projeto — **nunca usar** pra queroumacor sem pedido explícito.

## Env vars conhecidas (não pedir de novo)
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `ADMIN_EMAILS`, VAPID (4 vars), FCM (3 vars), `DUALHOOK_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_URL_SECRET`, `WHATSAPP_FOLLOWUP_URL_SECRET` — já configuradas no Cloudflare Pages.

## HSTS Preload — submetido
`_headers` com `max-age=31536000; includeSubDomains; preload`. Domínio submetido em hstspreload.org, validado. Pegadinha resolvida: Edge HSTS do painel Cloudflare sobrescrevia com Preload OFF.

## `route.ts` do Next só aceita exports fechados
Exportar helper de arquivo de rota quebra o build com "not a valid Route export field" — **nem `tsc` nem vitest pegam**, só `next build`. **Regra: rodar `next build` antes de subir mudança estrutural de rota.**

---
## Ver também
[[Segurança - Auditoria CI-CD]] · [[Segurança - Cloudflare]] · [[Auth - OAuth, Cadastro e RLS de Sessão]]
