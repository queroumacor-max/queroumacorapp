# Dependências entre arquivos JS

Análise do grafo de dependências do frontend vanilla JS (sem ES modules).
Cobre item **#16** do audit arquitetural ("dependências circulares"). Roda via:

```bash
npm run check:deps          # output Markdown no stdout
npm run check:deps -- --json # JSON pra integração futura
```

O script vive em `scripts/check-deps.js` (≤200 linhas, sem deps novas, roda em <100ms).

## TL;DR

- **0 ciclos** detectados na heurística atual (Tarjan SCC).
- 58 arquivos analisados, 17 arestas de dependência reais.
- Profundidade máxima do grafo: **1 nível** (foundation → consumidores diretos,
  sem cadeias profundas — esperado dado que o padrão IIFE+shim emprega o
  `window` global como hub, não chain).
- O grafo se parece com uma **estrela**: poucos "foundation files" no centro
  (`db.js`, `utils.js`, `schemas/_core.js`), muitos consumidores ao redor.

## Camadas (ASCII)

```
                            ┌─────────────────────────────────┐
                            │  FOUNDATION (top-level, no deps)│
                            │                                 │
                            │  config.js   errors.js          │
                            │  events.js   logger.js          │
                            │  policies.js utils.js           │
                            │  db.js       head.js            │
                            │  schemas/_core.js               │
                            └────────────────┬────────────────┘
                                             │  consumed by
                            ┌────────────────▼────────────────┐
                            │  AGGREGATORS / VALIDATORS       │
                            │                                 │
                            │  schemas/{primitives,documents, │
                            │           social,index}.js      │
                            │  shims.js                       │
                            └────────────────┬────────────────┘
                                             │  consumed by
                            ┌────────────────▼────────────────┐
                            │  FEATURE MODULES (42 IIFEs)     │
                            │                                 │
                            │  modules/feed.js, chat.js,      │
                            │  ai-art.js, agenda.js, ...      │
                            │  → registram window.Modules.X   │
                            └────────────────┬────────────────┘
                                             │  glued at runtime by
                            ┌────────────────▼────────────────┐
                            │  app.js                         │
                            │  (entry point legado +          │
                            │   boot/screen routing)          │
                            └─────────────────────────────────┘
```

Order canônico de load em `index.html` (resumo):
`supabase.js` → `head.js` → `config/utils/events/errors/logger/policies/db` →
`schemas/{_core,primitives,documents,social,index}` →
`modules/*` (42 arquivos) → `app.js` → `shims.js`.

## Arestas reais detectadas (17)

```
shims.js                  → utils.js                     (window.Utils)

schemas/documents.js      → schemas/_core.js, index.js   (Schemas._core)
schemas/primitives.js     → schemas/_core.js, index.js   (idem)
schemas/social.js         → schemas/_core.js, index.js   (idem)

modules/ai-logo.js        → db.js  (DB.profiles.*)
modules/archive.js        → db.js
modules/chat.js           → db.js
modules/crm.js            → db.js
modules/feed.js           → db.js  (DB.profiles, DB.posts, DB.follows)
modules/maquininha.js     → db.js
modules/profile-edit.js   → db.js
modules/stories.js        → db.js
```

Observações:
- `db.js` é o hub mais "puxado" — 8 módulos chamam `DB.X.Y(...)`.
  Esperado: é a camada de acesso a dados.
- Schemas formam uma sub-hierarquia limpa (`_core` é base de todos).
- Existem só **3 referências cross-module via `Modules.X`** no código todo
  (`Modules.feed.getLastFeedLoad`, `Modules.feed.shouldReload`,
  `Modules.screenHooks.install`) — todas em `app.js` ou `screen-hooks.js`.
  Ou seja, módulos NÃO chamam outros módulos pelo namespace `Modules.X` —
  o tráfego inter-módulo passa pelos shimmed bare globals (`toast()`,
  `loadFeed()`, `getSupabase()`), que não criam edges no grafo de load order.

## Ciclos

**Nenhum ciclo detectado** após a Fase 4 etapa 2 da modularização.

Isso era a hipótese: o padrão IIFE+shim isola módulos atrás do `window.Modules.X`
namespace, e o shim layer (`shims.js`) só re-exporta — não cria ciclos.

### Edge case "falso ciclo" que tratamos no script

`schemas/_core.js` e `schemas/index.js` ambos contêm
`window.Schemas = window.Schemas || {}` (padrão idempotente de init). Pela
heurística ingênua, ambos "proveem" E "usam" `Schemas`, gerando um SCC.

O script filtra isso: se um arquivo provê e usa o MESMO símbolo, é self-init
e não conta como dep externa (ver `if(selfProvides.has(sym)) continue;` em
check-deps.js).

## Por que análise estática em vanilla JS é heurística (não spec)

ES Modules definem grafo de imports formalmente (`import`/`export` statements
parseable pelo motor JS). Ferramentas como `madge` e `dependency-cruiser`
usam essa spec.

Vanilla JS + IIFE + `window.X` namespace = **convenção, não spec**:

1. **Bare globals**: quando `modules/ai-art.js` chama `toast('...')`, não
   há indicação textual de qual arquivo provê `toast`. A resolução é
   estritamente runtime — `toast` é qualquer `window.toast` que existir
   quando a função for invocada. Não criamos edge pra isso porque:
   - A chamada NUNCA acontece durante o IIFE de `ai-art.js` (sempre dentro
     de função body chamada por evento de UI).
   - Quando o evento dispara, TODOS os scripts já carregaram (todos têm
     `defer`).
   - Portanto: zero risco de ciclo de load order.

2. **Co-providers de namespace**: quatro arquivos
   (`schemas/_core/primitives/documents/social.js`) todos escrevem em
   `window.Schemas = window.Schemas || {}`. O script reporta a edge pra
   TODOS os providers, mesmo que só um seja o "real". Aceitável — pequena
   imprecisão que não muda o relatório de ciclos.

3. **Dispatch dinâmico**: `Modules[modName]?.foo()` ou
   `window[funcName]?.()` — strings dinâmicas não são detectáveis por regex.
   Raríssimo no projeto, e mesmo quando aparece, é runtime.

4. **Reatribuições**: se algum arquivo fizer `toast = require(...)` (não
   acontece aqui) o regex não captura.

Heurística vale a pena: detecta os ciclos que importam (parse-time / load
order) sem precisar de AST parser ou nova dep. Falsos positivos foram
tratados (self-init). Falsos negativos restantes são chamadas runtime que
não impactam load order.

## Como expandir

Se quiser detectar ciclos runtime (chamadas function-body que poderiam
sugerir alto acoplamento entre módulos), adicionar ao script:

- Tokenização de bare identifiers (já desenhamos esse passo em uma versão
  anterior; removemos porque gera centenas de falsos positivos sem AST).
- Whitelist de "função pública de módulo" (e.g., só conta `loadFeed`,
  `openChat` etc.). Mais útil pra refator targeted que pra detecção
  automática.

Hoje o script é **informativo, não gate de CI**. Se quiser ligar:

```yaml
# .github/workflows/lint.yml
- run: npm run check:deps -- --json | jq -e '.cycles | length == 0'
```

Mas só faz sentido depois de decidir o que é "ciclo aceitável" (e.g., se
algum dia houver módulo A ↔ B legítimo, precisa allowlist).

## Histórico

- **2026-05-31** — Primeira execução pós-Fase 4 etapa 2 da modularização.
  0 ciclos, 17 edges, 58 arquivos. Estado de baseline.
