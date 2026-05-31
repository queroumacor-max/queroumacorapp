# UI / Presentation — HTML, CSS, eventos DOM

> **Esta pasta é um índice nominal.** Os arquivos reais NÃO vivem aqui —
> vivem em `/index.html`, `/styles.css`, partes de `/modules/*.js` que
> tocam DOM, `/portal/*` e o boot residual de `/app.js`. Ver
> [`_layers/README.md`](../README.md) pra contexto.

## O que é UI neste projeto

**Apresentação**: o que o usuário vê e com o que interage. Renderiza
estado (DOM updates, modais, listas), captura input (clicks, submits,
form changes) e dispara use cases da camada Application. Não toma
decisão de negócio sozinha — chama policies/schemas pra isso.

## Arquivos reais que cumprem UI

### SPA principal — HTML + CSS estáticos

| Arquivo | Responsabilidade |
|---|---|
| [`/index.html`](../../index.html) | SPA principal (~2300 linhas). Cada tela em `<div class="screen" data-screen="...">`. Modais via padrão `.sheet` (overlay clicável → painel). **HTML inline handlers** (`onclick="loadFeed()"`, `onsubmit="signup(event)"`) — exigem que a função esteja em `window.X` via `shims.js`. |
| [`/styles.css`](../../styles.css) | Único arquivo de CSS do projeto. Variáveis CSS pra tema, utilitários, componentes de tela e modal. |
| [`/manifest.json`](../../manifest.json) | PWA manifest (ícone, nome, theme). |
| [`/offline.html`](../../offline.html) | Página servida pelo SW quando sem rede. |

### Bits de DOM em `/modules/*.js`

Cada `modules/X.js` é uma feature isolada que MISTURA Application + UI
(violação consciente — ver `LAYERS.md §5`). A parte UI segue convenção
de nomes:

- `render*` — monta DOM a partir de estado (`renderConvList`, `renderFeed`).
- `build*HTML` — devolve string de HTML pra ser injetada via `innerHTML`
  (`buildFeedPostHTML`, `buildConvItemHTML`).
- `setXxxFilter`, `openSheet`, `closeSheet` — manipulam classes/atributos
  e visibilidade.
- `appendMsg`, `prependPost` — DOM updates incrementais.

Convenção paralela: funções `load*`, `submit*`, `sync*` são Application
(use case) no mesmo arquivo. Separar daria 88 arquivos (44 features × 2)
sem ganho proporcional — custo cognitivo > benefício.

### Portal admin — React UMD

| Arquivo | Responsabilidade |
|---|---|
| [`/portal/index.html`](../../portal/index.html) | Shell HTML do portal admin. |
| [`/portal/app.jsx`](../../portal/app.jsx) | React 18 (UMD) + Babel standalone — JSX inline no navegador, **sem build**. Telas de gestão admin (usuários, erros, moderação). |
| [`/portal/app.js`](../../portal/app.js) | Versão pré-compilada via `scripts/build-portal.js` (única exceção de build no projeto). |
| [`/portal/react.production.min.js`](../../portal/react.production.min.js) | React UMD self-hosted. |

### Boot one-shots — `/app.js`

| Arquivo | Responsabilidade |
|---|---|
| [`/app.js`](../../app.js) | Resíduo da SPA (~1300 linhas após Fase 4 etapa 2 da modularização). State vars residuais (`chatData`, `currentChat`, `_lastOrcData`), boot one-shots (`_injectSheetCloseButtons`, `_bootstrapFromUrl`, `_consumeInviteFromUrl`, `updateCartBadge`), `showScreen()`, helpers exclusivos. Conta como UI por ser o orchestrator do shell visual. |
| [`/shims.js`](../../shims.js) | Bridge `window.Modules.X.fn → window.fn` (+ `Utils.X → window.X`). Republica módulos IIFE como bare globals pra HTML inline handlers continuarem funcionando. Carrega ANTES de `app.js`. |

## Convenção crítica — HTML inline handlers

`index.html` tem ~200 atributos `onclick="..."`, `onsubmit="..."`,
`onchange="..."`. **Esses handlers exigem que a função esteja em
`window.X`** — `addEventListener` quebraria todos.

- Padrão de adição: definir a função dentro de `modules/X.js` IIFE,
  expor via `window.Modules.X = { fn }`, bumpar `shims.js` pra republicar
  como `window.fn` global.
- **NÃO refatorar** inline handlers existentes pra `addEventListener` sem
  motivo concreto. O padrão IIFE+shim é deliberado pra preservar o
  contrato `window.*` — ver `ARCHITECTURE.md §Frontend` e `LAYERS.md §1`.

## Regras

- UI **pode chamar** Application (use cases em `modules/*` e endpoints
  via `apiPost`).
- UI **pode chamar** Domain (validar com `Schemas.email.parse(v)`,
  autorizar com `Policies.canEditProfile(u, p)` antes de abrir o modal).
- UI **evita** falar direto com Supabase quando há método em `db.js`
  cobrindo. Esta é a regra mais violada hoje (ver `LAYERS.md §5`).
- UI **não** deve ter regra de negócio inline (`if (user.cpf.length...)`
  no render é cheiro — promover pra `Schemas` em Domain).

## Cache-busting (UI específico)

`index.html` carrega `head.js`, `db.js`, `schemas/*` e `app.js` com
`?v=AAAAMMDD<letra>` (ex.: `?v=20260531d`). **DEVE ser bumpado** sempre
que o arquivo muda — senão Cloudflare serve a versão antiga do cache e
correção não chega no usuário. Ver `CLAUDE.md` pra regra completa.

## Migração futura

- `index.html` + `modules/*.js render/build` → componentes React/Next:
  cada `renderConvList` vira `<ConvList />`, cada `buildFeedPostHTML`
  vira `<FeedPost />`. Hooks `useFeed`, `useChat` consomem o que hoje
  está em `load*` / `submit*`.
- `styles.css` → CSS modules, Tailwind ou styled-components conforme stack.
- `shims.js` desaparece — sem `window.*` necessário em SPA com router.
- `app.js` desaparece — boot vira `_app.tsx` / layout.
- `portal/` migra junto pro mesmo framework (ou continua isolado).
- Inline handlers viram `onClick={fn}` em JSX — refator natural na migração.
