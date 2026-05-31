<!--
Antes de abrir, confira:
- CONTRIBUTING.md §7 (checklist)
- CONVENTIONS.md (estilo/naming)
- LAYERS.md (onde colocar coisa nova)
- docs/adr/ (decisoes arquiteturais)
-->

## Sumário

<!-- 1–2 linhas. "O que muda" em uma frase de pessoa, não de commit. -->

## Por quê (WHY)

<!-- Contexto. Bug observado, regra de produto, dívida endereçada, métrica
     que move. O diff já conta o "o quê" — aqui é o porquê. -->

## O que mudou (WHAT)

<!-- Lista curta dos pontos do diff que merecem atenção. Não copiar o
     changelog inteiro — só o que ajuda a revisar. -->

-
-
-

## Como testou

<!-- Marcar tudo que se aplica e descrever passos. -->

- [ ] `npm test` local
- [ ] `npm run lint`
- [ ] `npm run lint:conventions`
- [ ] `npm run check:deps`
- [ ] Smoke manual no preview deploy (`<slug>.queroumacorapp.pages.dev`)
- [ ] E2E (Playwright) se aplicável (`npm run test:e2e`)
- [ ] Caso de erro / borda exercitado (descrever):

Passos pra reproduzir o teste manual:

1.
2.
3.

## Screenshots / vídeo (se UI)

<!-- Antes / depois. Mobile primeiro (PWA). -->

## Cache-busting

<!-- Bumpou `?v=YYYYMMDD<letra>` no index.html se mexeu em algum destes:
     app.js, head.js, db.js, shims.js, schemas/*.js, modules/*.js,
     ou qualquer outro asset listado em DEPLOYMENT.md §10? -->

- [ ] Não tocou em asset versionado
- [ ] Tocou e bumpou `?v=` no `index.html` — versão: `?v=____________`

## SQL / Supabase

<!-- Claude/PR autor não roda SQL direto no banco do queroumacor.
     Schema change = colar o SQL completo aqui pro mantenedor rodar
     manualmente no SQL Editor. -->

- [ ] Não mexe em schema/policy/trigger
- [ ] Mexe — SQL idempotente colado abaixo:

```sql
-- SQL aqui (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS,
-- DROP POLICY IF EXISTS antes de CREATE POLICY, etc.)
```

## Checklist

<!-- Mesma lista do CONTRIBUTING.md §7. Mantenha as duas em sincronia. -->

- [ ] Testes locais passam (`npm test`)
- [ ] Convenções OK (`npm run lint:conventions`)
- [ ] Lint OK (`npm run lint`)
- [ ] Cache-bump aplicado se aplicável
- [ ] Preview deploy testado
- [ ] Docs atualizadas se mudei arquitetura/API/contrato público
      (`ARCHITECTURE.md`, `API.md`, `DATABASE.md`, `EVENTS.md`, ADRs)
- [ ] Sem secrets nem env vars hardcoded no diff
- [ ] Sem deps runtime novas (SaaS, lib pesada) sem aprovação prévia
- [ ] Body do PR explica **WHY**, não só WHAT
- [ ] Se tocou RLS/policy/trigger: SQL colado acima pra rodar manualmente
- [ ] Função pública nova em foundation lib (db/validators/policies/schemas/errors) tem teste

## Risco / rollback

<!-- Curto: o que pode quebrar e qual é o plano B. "Rollback workflow"
     em DEPLOYMENT.md §4 sempre é fallback. -->

- Risco principal:
- Plano B:

## Issues / contexto relacionados

<!-- #123, link de Sentry, sessão Claude Code, conversa no chat. -->

-

---

<!--
Lembretes finais:
- main = produção, deploy automático em ~90s pós-merge.
- Preview deploy roda em <branch-slug>.queroumacorapp.pages.dev.
- Banner amarelo "STAGING" confirma ambiente de preview.
- Monitorar /admin/errors e Sentry por ~10min após merge.
-->
