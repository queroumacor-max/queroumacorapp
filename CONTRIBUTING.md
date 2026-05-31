# Contributing — QueroUmaCor

Guia operacional para contribuir com o QueroUmaCor. Lê os docs irmãos
antes (`ARCHITECTURE.md`, `LAYERS.md`, `CONVENTIONS.md`, `DEPLOYMENT.md`,
`STAGING.md`) — este arquivo cobre o **workflow** de contribuição; os
outros cobrem o **conteúdo** (arquitetura, camadas, convenções).

---

## 1. Setup local

```bash
git clone git@github.com:<owner>/queroumacorapp.git
cd queroumacorapp
npm ci
```

**Não há dev server local.** O projeto é HTML/JS estático + Cloudflare
Pages Functions (V8 isolates). Não existe `npm run dev` que sobe a SPA.
Para validar mudanças no browser, use **preview deploys do Cloudflare
Pages** (ver §3). Para iterar em lógica pura (validators, policies, db,
schemas, errors), os testes Vitest cobrem 100% do feedback loop.

### Env vars (apenas se for mexer em endpoint backend)

Endpoints em `functions/api/*.js` leem env vars de
`platform.env.<NOME>` (Cloudflare Pages Functions). Lista completa em
`DEPLOYMENT.md §6`. Para reproduzir comportamento local de um endpoint,
o caminho hoje é colar o handler num projeto Wrangler isolado — não há
infra local pronta no repo. Na prática, edita-se o endpoint, faz commit
numa branch e testa-se no preview deploy.

### Scripts disponíveis

```bash
npm test                      # vitest run (sem watch)
npm run test:watch            # vitest watch
npm run test:e2e              # Playwright (smoke pós-Fase 4)
npm run lint                  # ESLint em .js/.cjs
npm run lint:strict           # ESLint com --max-warnings 0
npm run lint:conventions      # check-conventions.js (IIFE, ?v=, console.log, TODO)
npm run check:deps            # check-deps.js (deps em package.json vs uso real)
npm run build:portal          # pré-compila JSX do portal admin
```

Não há `npm run typecheck` (vanilla JS, sem TS — tipos opcionais via
`db.types.d.ts` consumidos por editor através de `jsconfig.json`).

---

## 2. Branch strategy

| Branch                | Papel                          | Deploy                                    |
| --------------------- | ------------------------------ | ----------------------------------------- |
| `main`                | Produção                       | Cloudflare Pages auto (~90s pós-push)     |
| `claude/*`            | Trabalho do Claude Code agent  | Preview `<slug>.queroumacorapp.pages.dev` |
| `feature/*`           | Trabalho humano                | Idem                                      |
| `staging`             | Integração opcional            | Idem                                      |

Regras:
- **Nunca push direto em `main`** sem passar por preview (exceção:
  hotfix bem isolado, ver `STAGING.md §Quando NÃO usar preview`).
- Branch de trabalho atual default do Claude: `claude/new-session-V0v78`.
- PRs vão **sempre** pra `main`. Não há GitFlow nem `develop`.
- Após merge em `main`, o deploy é automático. Janela típica ~90s.

---

## 3. Workflow recomendado

```
1. abrir branch (claude/<x> ou feature/<x>)
2. mexer + commit local
3. push → CI roda (~2 min) + preview deploy (~90s)
4. abrir <slug>.queroumacorapp.pages.dev → testar
5. abrir PR pra main
6. revisar checklist (§7) + diff
7. merge → deploy automático prod
8. aguardar ~90s + pedir confirmação humana ("subiu em prod?")
9. monitorar /admin/errors e Sentry por ~10min
```

Para mudanças visuais, fluxos críticos (signup, login, checkout, follow,
post) e refactors, **sempre** testar no preview antes do merge.

---

## 4. Commits

### Convenção

- **Imperativo no presente**, primeira linha ≤72 chars.
- Prefixo opcional: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:` — escopo opcional entre parênteses: `feat(arquitetura):`,
  `fix(feed):`, etc.
- **Body explica WHY**, não WHAT. O diff já mostra o "o quê".
- Footer com link da sessão Claude Code quando aplicável
  (`https://claude.ai/code/session_X`).

### Exemplos do histórico real do repo

```
fix: TDZ em currentMode/storyGroups (e prevenção pra 105 outros lets)
fix: pagehide+visibilitychange listeners movidos pra modules/chat.js
feat(arquitetura): Fase 4 wave 6 (FINAL) — nav + screen-hooks
feat(observabilidade): Sentry no app principal (loader script) + CSP
arch wave 3: 3 entregas paralelas (agentes) — event bus + lints
```

Body bom (do `c23c686`):

> Fase 4 etapa 2 cleanup — encapsula 112 state vars em modules/*
>
> Sobravam state vars top-level em app.js mesmo depois da migração de
> 338 funções. Cada `let` ficava como global implícito (window.*) e
> aparecia em colisões de TDZ quando módulos rodavam fora de ordem.
> Esta passada move cada state pra dentro do IIFE do módulo dono.

---

## 5. Code style

Convenções completas em `CONVENTIONS.md`. Resumo do que mais machuca em
PR review:

### JS

- **Vanilla JS, sem TS, sem build step.** Não introduzir nenhum dos
  três sem decisão arquitetural explícita.
- **IIFE pattern em `modules/*.js`** (`(function(){ 'use strict'; ...;
  window.Modules.X = { ... }; })();`). Cada módulo declara seu
  namespace; `shims.js` republica como bare globals.
- **ESM em `functions/api/*.js`** e em `tests/*.js`.
- **HTML inline handlers (`onclick="loadFeed()"`) são pattern do
  projeto.** Não refatorar pra `addEventListener` sem necessidade — o
  contrato de globals (`window.X`) é deliberado pra preservar esses
  handlers. Detalhes em `ARCHITECTURE.md §Por que IIFE + shim`.
- **Sem dependências runtime novas** (SaaS, lib pesada) sem aprovação
  explícita do mantenedor. Domínio inteiro é PWA leve self-hostada.

### Cache-busting

- `index.html` carrega assets versionados com `?v=YYYYMMDD<letra>` (ex.:
  `?v=20260531c`).
- **Bumpar SEMPRE** ao mudar `app.js`, `head.js`, `db.js`, `shims.js`,
  qualquer `schemas/*.js`, ou qualquer `modules/*.js` — lista completa em
  `DEPLOYMENT.md §10`.
- Esquecer = navegador serve do cache `max-age=31536000, immutable` e a
  correção não chega no usuário por até 1 ano.
- CI checa que o caminho referenciado existe, **não** checa que a versão
  foi bumpada — responsabilidade humana.

### HTML/CSS

- Single-page em `index.html` (~2300 linhas). Telas como `div.screen`.
- Modais via `.sheet` pattern (overlay clicável → painel).
- CSS único em `styles.css` + inline em element-level quando hot.

### Strings de UI

- PT-BR sempre. Toast, labels, modais, mensagens de erro.
- Tom: direto, sem culpar o usuário.

### Console

- `console.log` **proibido** em `modules/*` e `app.js` (lint pega).
- `console.warn/error/info` permitidos.
- Erros do client: `reportError({ type, ctx, msg })` →
  `/api/log-error` → tabela `errors` + Sentry.

---

## 6. Testes

| Tipo            | Local              | Como rodar                |
| --------------- | ------------------ | ------------------------- |
| Unit            | `tests/*.test.js`  | `npm test`                |
| Integration     | `tests/integration/` | `npm test`              |
| E2E (Playwright) | `e2e/*.spec.js`   | `npm run test:e2e`        |

### Cobertura mínima exigida

Toda função pública nova em **foundation libs** (`db.js`, `schemas/`,
`policies.js`, `errors.js`) DEVE ter teste. Sem exceção — essas são as
camadas auditáveis (ver `LAYERS.md §4`).

Para `modules/*.js`, teste unit é **bem-vindo** mas não obrigatório (a
maioria mistura UI + use case e cobrir dá pouco ROI). Smoke manual no
preview deploy cobre o que importa.

E2E (Playwright) cobre fluxo de boot + shims + modules — não substitui
smoke manual em features visuais.

---

## 7. Pull Request checklist

Esta lista também aparece no `.github/PULL_REQUEST_TEMPLATE.md` —
mantenha as duas em sincronia.

- [ ] Testes locais passam (`npm test`).
- [ ] Convenções OK (`npm run lint:conventions`).
- [ ] Lint OK (`npm run lint`).
- [ ] Cache-bump nos assets versionados aplicado se mudei
      `app.js`/`head.js`/`db.js`/`shims.js`/`schemas/*`/`modules/*`.
- [ ] Preview deploy testado (`<slug>.queroumacorapp.pages.dev`).
- [ ] Docs atualizadas se mudei arquitetura/API/contrato público
      (`ARCHITECTURE.md`, `API.md`, `DATABASE.md`, `EVENTS.md`, ADRs).
- [ ] Sem secrets nem env vars hardcoded no diff.
- [ ] Sem deps runtime novas (SaaS, lib pesada) sem aprovação prévia.
- [ ] Body do commit/PR explica **WHY**, não só WHAT.
- [ ] Se tocou RLS/policy/trigger no Supabase: SQL colado no chat/PR
      pra rodar manualmente (ver §8).

---

## 8. Como rodar SQL no Supabase

**Claude não tem acesso direto ao banco de produção.** O MCP Supabase
disponível na sessão aponta pra OUTRO projeto — qualquer
`execute_sql`/`apply_migration` via MCP vai pro lugar errado.

Workflow obrigatório pra mudanças de schema:

1. Escrever a migration idempotente (`CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes do
   `CREATE POLICY`, etc.).
2. **Colar o SQL completo no chat/PR em bloco de código**, não só
   commitar arquivo no repo.
3. O usuário copia, abre o SQL Editor do Supabase (projeto
   `uwqebaqweehiljsqkifm.supabase.co`) e roda.
4. Confirmar no chat que rodou + atualizar `CLAUDE.md` com bullet
   "**SQL X JÁ FOI EXECUTADO no Supabase**" pra próxima sessão não pedir
   de novo.

RLS é obrigatória em qualquer tabela mutável pelo client. `service_role`
bypassa — só usar server-side com auth validada.

---

## 9. Observabilidade

- **Sentry** está conectado ao GitHub do projeto (releases/commits/
  issues sincronizados via integração). Erros JS no client e exceptions
  em endpoints sobem automático.
- **Tabela `errors`** caseira no Supabase + dashboard em `/admin/errors`
  (gate `_isAdmin`). Convive com o Sentry — decisão se vira fonte
  primária ou só complemento ainda está em aberto (ver
  `docs/adr/0005-observability-defense-em-camada.md`).
- Após merge em `main`: monitorar `/admin/errors` e Sentry por ~10 min
  pra pegar regressão imediata.

---

## 10. Como adicionar nova feature

Referência operacional em `LAYERS.md §6`. Resumo:

| Tipo de mudança                                  | Onde                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Regra pura (RBAC, validação, formatação)         | `policies.js`, `schemas/`, ou parte pura de `utils.js`. Sem deps. Teste obrigatório. |
| Acesso a tabela nova (≥2 call sites)             | Método em `db.js` com `try/catch` retornando valor seguro. Atualizar `tests/db.test.js`. |
| Acesso pontual (1 call site)                     | `sb.from('X')` direto no módulo. Promover a `db.js` só quando duplicar. |
| Feature inteira nova no client                   | Novo `modules/X.js` no padrão IIFE + bump em `shims.js` pras fns que viram inline handlers. |
| Endpoint backend novo                            | Novo `functions/api/X.js` exportando `onRequestPost`/`onRequestGet`. Controller thin; lógica em `_services/` se reusável. Usar helpers de `_security.js` pra auth/rate-limit. |
| Erro novo padronizado                            | Nova subclasse em `errors.js` ou `AppError` direto com `{ code, status }`. |
| Constante de config                              | `config.js` (cross-cutting) ou local ao módulo (específica).         |
| Inline handler novo em HTML                      | Função no módulo + expor via `shims.js` como `window.X`.             |

---

## 11. Code review — o que olhar

Foco em cima → ordem de importância:

1. **Segurança**:
   - RLS no Supabase pra tabelas tocadas. Defense in depth: política no
     banco + filtro `WHERE` no client + policy pura em `policies.js`.
   - `service_role` só server-side com auth validada (`requireAuth`).
   - Sem secrets/env vars hardcoded.
   - Sem `innerHTML` com dado de usuário sem `escapeHtml`.
2. **Correção**:
   - Try/catch obrigatório em handler que toca rede/DOM.
   - `withTimeout()` em chamadas externas (head.js helper).
   - Sem `await` dentro de loop quando dá pra `Promise.all`.
3. **Convenções**:
   - Cache-bump aplicado.
   - Sem `console.log` em `modules/*`/`app.js`.
   - Sem `TODO`/`FIXME` sem owner+data ou `#issue`.
   - IIFE + `'use strict'` em novo módulo.
   - Função pública nova em foundation lib tem teste.
4. **Arquitetura**:
   - Não introduziu global `window.X` novo sem documentar.
   - Respeita regras de dependência (`LAYERS.md §3`): Domain não chama
     Infra/UI; Infra não chama Application.
   - Se mudou contrato público (API HTTP, schema DB, evento), atualizou
     o doc correspondente (`API.md`, `DATABASE.md`, `EVENTS.md`).
5. **Limpeza**:
   - Modal aberto sem `closeModals()` no fluxo de retorno.
   - Comentário explica WHY, não WHAT.

---

## 12. Onde ir agora

- Arquitetura concreta: `ARCHITECTURE.md`.
- Camadas conceituais: `LAYERS.md`.
- Decisões arquiteturais: `docs/adr/`.
- Convenções de código: `CONVENTIONS.md`.
- Pipeline de deploy: `DEPLOYMENT.md`.
- Preview/staging: `STAGING.md`.
- Backlog: `BACKLOG.md`.
- Estado/regras já decididas: `CLAUDE.md` (instruções permanentes
  pra Claude Code — lê esse aqui se for trabalhar no projeto via agent).
