# ADR 0004 — Arquitetura modular com IIFE + shims (Fase 4 da modularização)

- **Status**: Accepted
- **Date**: 2026-05-31
- **Deciders**: mantenedor único
- **Tags**: frontend, modularization, refactor, shims, globals

## Context

`app.js` cresceu organicamente até **9176 linhas** com **350 funções
top-level**. Cada função era declarada como `function fooBar(...) {}` no
escopo do módulo (mas como o arquivo não era ES module, viravam globais
implícitas no `window`). HTML inline handlers (`onclick="loadFeed()"`,
`onsubmit="signup(event)"`) dependiam dessas globais — centenas de
referências espalhadas em `index.html` (~2300 linhas).

ADR 0001 já fixou que o stack continua vanilla JS sem build step e que
os inline handlers continuam vivos. Este ADR endereça o **"como
modularizar sem quebrar o contrato"**.

Auditoria estática (registrada em `ARCHITECTURE_PLAN.md`) mapeou:

- 76 marcadores de seção `// ══` separando features.
- 27 candidatos a módulos por feature.
- ~21 utilitários compartilhados candidatos a `utils.js`.
- Dependências cruzadas problemáticas: `showScreen` reescrito em runtime
  na linha 8459 (`screen-hooks`), `feed ↔ stories ↔ profiles-fetch`,
  `chat ↔ autoresp ↔ notif`, duas funções com nome `openChat`, etc.

Opções de modularização avaliadas:

1. **ES modules (`import`/`export`)**: limpíssimo, mas mata inline
   handlers. Toda função usada por `onclick=` precisaria virar
   `addEventListener` no JS — refactor enorme em paralelo ao da
   modularização. Risco alto.
2. **Bundler (Vite/esbuild) com exports virando globais**: adiciona
   build step (proibido por ADR 0001) e ainda exige decisão de quais
   exports viram globais.
3. **IIFE registrando `window.X` direto**: zero ferramenta nova; cada
   função vira `window.fn` no fim do arquivo, igual estava antes.
4. **IIFE registrando `window.Modules.X = { fn1, fn2 }` + camada de
   shims**: encapsula por módulo, expõe namespace organizado, **e**
   republica como bare globals via `shims.js` pra preservar inline
   handlers.

## Decision

**Adotamos opção 4: IIFE + namespace `window.Modules.X` + `shims.js`.**

Cada módulo segue o padrão:

```js
// modules/feed.js
(function () {
  'use strict';

  function loadFeed() { /* ... */ }
  function buildFeedPostHTML(post) { /* ... */ }

  window.Modules = window.Modules || {};
  window.Modules.feed = { loadFeed, buildFeedPostHTML };
})();
```

E `shims.js` republica:

```js
// shims.js (carregado ANTES de app.js)
for (const fn of Object.keys(window.Modules.feed || {})) {
  if (!window[fn]) window[fn] = window.Modules.feed[fn];
}
// + Utils.X também vira window.X
```

Ordem em `index.html`:

1. `supabase.js` (UMD)
2. `head.js` (auth + helpers)
3. `config.js` / `utils.js` / `errors.js` / `logger.js` / `policies.js` /
   `db.js` / `validators.js` (camadas fundacionais)
4. `modules/*.js` (44 arquivos)
5. `shims.js` (republicação)
6. `app.js` (boot residual)

A Fase 4 etapa 2 (completa em 2026-05-31) extraiu **338 funções** em
**44 módulos**. `app.js` caiu de **9176 → 1299 linhas (-86%)**.

## Consequences

### Positive

- **Inline handlers continuam funcionando 1:1.** Zero HTML tocado.
  `onclick="loadFeed()"` ainda resolve porque shims republica
  `Modules.feed.loadFeed` como `window.loadFeed`.
- **Encapsulamento de verdade por módulo.** State local fica no IIFE
  (`let _feedOffset = 0` no fechamento). Não polui `window`.
- **`window.Modules` vira um índice navegável.** Pra debug:
  `Object.keys(window.Modules)` lista as 44 features. Útil em DevTools.
- **`app.js` virou trivial.** ~1300 linhas de state vars residuais + boot
  one-shots. Diff de feature toca módulo dela, não monolito.
- **Caminho de migração futura intacto.** Quando/se mudar pra ESM ou TS,
  cada IIFE vira `export const`/`class`; shims morre; HTML migra pra
  `addEventListener` em paralelo. Um módulo de cada vez, sem big-bang.
- **Lints caseiros validam padrão.** `check-conventions.js` checa: IIFE,
  `'use strict'`, exatamente 1 `window.Modules.<name> = { ... }` por
  arquivo, `?v=` em scripts de `index.html`, `console.log` proibido em
  modules e app.js.
- **Testes unit cobrem foundation.** 85 testes passam pós-extração
  (shims + policies + db + validators + security + events + schemas +
  conventions).

### Negative

- **Ordem dos `<script defer>` é load-bearing.** `shims.js` DEVE rodar
  ANTES de `app.js` (pra boot calls em `app.js` já terem globals
  wireadas). `screen-hooks` (que reescreve `showScreen` em runtime)
  DEVE vir depois de todos os módulos que ele despacha. Inverter
  ordem quebra silenciosamente. Documentado em comentário no topo de
  `index.html`.
- **Cache-busting é manual.** Cada um dos 44 arquivos `modules/*` tem
  `?v=YYYYMMDD<letra>` em `index.html`. Esquecer = código velho cacheado
  por 1 ano. CI checa que o caminho existe; **não** checa que a versão
  foi bumpada — vigilância humana é necessária.
- **Padrão é não-idiomático.** Devs Next/Vite/Webpack estranham. Mitigação:
  ARCHITECTURE.md + este ADR explicam o porquê.
- **`shims.js` é gambiarra explícita.** É uma camada extra que existe só
  pra reconciliar IIFE com inline handlers. Cresce com cada módulo novo
  (warn-only check em `check-conventions.js`).
- **Risco de colisão de nomes entre módulos.** Duas `openChat`
  diferentes no monolito (modal orçamento vs. conversa) era pegadinha
  já existente. IIFE+shim não inventa o problema, mas também não
  resolve — precisa convenção de naming explícita.
- **Modules ainda misturam Application + UI.** `feed.js` tem
  `loadFeed()` (use case) e `buildFeedPostHTML()` (UI) juntos.
  Separar daria 88 arquivos. Aceito como trade-off (`LAYERS.md §5`).
- **Estado compartilhado entre módulos** (`currentUser`, `currentChat`,
  `chatData`, `_isPro`, `_isAdmin`, etc.) continua em `window`. Não foi
  encapsulado nesta fase — `app.js` ainda guarda state vars residuais.

## Por que NÃO ES modules

Repetindo o ponto-chave (também em ADR 0001):

ES modules quebrariam `onclick="loadFeed()"` — função importada não fica
em `window`. Migrar todos os inline handlers pra `addEventListener`
(plus seleção de elemento, plus delegação onde aplicável) seria uma 2ª
onda de risco em paralelo à extração de 338 funções. **IIFE + shim
mantém o contrato `window.X` enquanto encapsula por módulo** — o melhor
dos dois mundos pra esta fase.

## Alternativas consideradas

- **Monolito grande**: status quo de origem. Inviável pra continuar
  evoluindo — diff de feature batia em arquivo de 9k linhas, conflito
  de merge constante.
- **ES modules + reescrita HTML**: ver acima — refactor enorme em
  paralelo.
- **Bundler**: viola ADR 0001 (no build step). Não.
- **Splittar `app.js` em `app-feed.js`, `app-chat.js`, ... sem IIFE**:
  resolveria tamanho mas mantém poluição de `window` e não encapsula
  state. Pouco ganho.

## Quando re-avaliar

- Quando ADR 0001 for re-avaliado (migração pra TS/framework), este
  ADR cai junto — shims desaparece, `window.Modules` vira tree
  `lib/modules/*.ts`.
- Se cache-busting manual virar fonte recorrente de incidente (>1
  esquecimento/mês causando bug em prod), considerar gerar `?v=` via
  script ou hash do arquivo.
- Se chegarmos a 80+ módulos e `shims.js` virar gargalo cognitivo,
  considerar split por área (`shims-social.js`, `shims-pipeline.js`)
  ou code-gen do shims a partir de marcadores nos módulos.

## Referências

- `ARCHITECTURE.md §Frontend`, `§Por que IIFE + shim em vez de ES modules`
- `ARCHITECTURE_PLAN.md` (auditoria completa que guiou a Fase 4)
- `CONVENTIONS.md §Enforcement`
- `shims.js`, `modules/*.js` (44 arquivos)
- `tests/shims.test.js`, `tests/conventions.test.js`
- ADR 0001 (vanilla JS — o "por que vanilla")
