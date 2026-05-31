# `_layers/` — índice nominal de Clean Architecture

> Esta pasta **NÃO contém código**. É **apenas um índice** que mapeia os
> arquivos reais do projeto (que vivem nas raízes `/`, `/modules`,
> `/schemas`, `/functions/api`, etc.) pras 4 camadas conceituais da
> Clean Architecture (Domain, Application, Infrastructure, UI).

## Por que esta pasta existe

Item **A5** da auditoria arquitetural cobrou: *"separação entre Domain,
UI e Infrastructure não está documentada de forma verificável."* A
discussão completa do trade-off (por que **não** migrar pra estrutura
formal `domain/application/infrastructure/ui` com mover arquivos) está
em [`LAYERS.md`](../LAYERS.md) — TL;DR: vanilla JS sem TS/interfaces,
HTML inline handlers exigem `window.X`, custo de cerimônia > ROI.

Esta pasta resolve A5 com **placeholders nominais**: 4 subpastas vazias
com README cada, apontando pra onde o código realmente vive. Quem auditar
"existe separação de camadas?" abre `_layers/` e vê o mapeamento literal.

## Por que NÃO mover os arquivos

- `index.html` tem ~2300 linhas com `<script src="db.js?v=...">`,
  `<script src="head.js?v=...">`, `<script src="modules/feed.js">`,
  etc. (200+ refs). Mover quebra o boot.
- `shims.js` republica `window.Modules.X.fn → window.fn` esperando
  paths atuais. Mover sem reescrever o shim quebra todos os
  `onclick="loadFeed()"` no HTML.
- `_redirects` / `_headers` / SW cache lists referenciam paths atuais.
- Sem build step, paths são literais — `find & replace` por 44 módulos +
  4 schemas + 8 globals = horas de bisect quando algo quebrar.

## Fluxo de dependência (regra)

```
              UI (presentation)
              index.html · styles.css
              DOM bits em modules/*.js
              portal/ · app.js boot
                     │
                     │  pode chamar
                     ▼
              Application (use cases)
              modules/*.js (feature fns)
              functions/api/_services/*.js
                     │
       ┌─────────────┴──────────────┐
       │  pode chamar               │  pode chamar
       ▼                            ▼
  Domain (puro)               Infrastructure (adapters)
  policies.js                 db.js · head.js
  schemas/*                   logger.js · config.js
  errors.js                   functions/api/_security.js
  utils.js (parte)            functions/api/_ai.js
                              sw.js
```

**Setas proibidas**:
- Domain **nunca** depende de UI nem Infrastructure.
- Infrastructure **nunca** depende de Application.
- UI evita falar direto com Supabase quando há método em `db.js`.

## Subpastas

- [`domain/`](./domain/README.md) — regras puras (RBAC, validação, erros, helpers puros)
- [`application/`](./application/README.md) — use cases (modules + api services)
- [`infrastructure/`](./infrastructure/README.md) — adapters (DB, fetch, auth, log, env, SW)
- [`ui/`](./ui/README.md) — presentation (HTML, CSS, DOM rendering, portal admin)

## Como auditar separação de camadas literalmente

Pra checar o item #5 do audit (*"Falta de separação entre domínio, UI e
infraestrutura"*), aponte pra esta estrutura. Cada README lista os
arquivos reais que cumprem a camada e os invariantes esperados (ex.:
"Domain não importa `getSupabase()`"). Grep direto valida:

```sh
grep -rE 'getSupabase|document\.|fetch\(' policies.js schemas/ errors.js
# → deve voltar VAZIO (Domain é puro)
```

Discussão de violações conhecidas e por que aceitamos: `LAYERS.md §5`.
