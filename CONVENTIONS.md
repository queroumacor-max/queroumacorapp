# Convenções — QueroUmaCor

## Idioma
- Código em inglês (identificadores), comentários em PT-BR.
- Strings de UI em PT-BR (toast, labels, modais).

## Nomeação
- Funções/variáveis: camelCase (loadFeed, currentUser).
- Classes: PascalCase (AppError, ValidationError, NotFoundError).
- Constantes: UPPER_SNAKE (FEED_PAGE, POST_COLS, ADMIN_EMAILS).
- Funções/vars privadas/internas: prefixo `_` (_feedOffset, _pipelineSub).
- Módulos /modules/X.js: kebab-case (feed-publish, auth-pw, points-refs).
- Namespaces window.X: PascalCase + kebab→camel (Modules.feedPublish, Modules.authPw).

## Arquivos
- ES modules (com import/export): só em /functions/api/ e /tests/.
- IIFE com window.X: em /modules/, /schemas/, db.js, errors.js, logger.js, policies.js, config.js, utils.js.
- HTML: SPA single-page (index.html).
- CSS: styles.css + inline em element-level quando hot.

## Imports
- Não duplicar utility entre arquivos — use Utils.X de /utils.js.
- Constantes compartilhadas: Config.X em /config.js.
- Validação: Schemas.X.parse(v) em /schemas/ (`primitives.js`, `documents.js`, `social.js`). Retorno `{ ok, value? } | { ok:false, error:{ code, message } }`.
- Erros: AppErrors.X em /errors.js.
- Logs: Logger.X em /logger.js.
- Authz: Policies.canX em /policies.js.
- Data: DB.profiles/follows/posts em /db.js.

## Comentários
- Explicar o PORQUÊ, não o quê.
- Especialmente: bugs evitados, decisões não-óbvias, gotchas.
- Sem TODOs sem owner/data — abra issue.

## Erros / mensagens ao usuário
- Sempre PT-BR.
- Tom: direto, sem culpar o usuário.
- Códigos: `[feature-action-fail]` no console (`feed-step-timeout`, `follow-not-persisted`).

## Async / errors
- Async/await ao invés de .then() chains, exceto pra fire-and-forget.
- Try/catch obrigatório em handler que toca rede/DOM.
- Timeouts via withTimeout() (head.js) em chamadas externas.
- Erros do client: reportError({ type, ctx, msg }) → /api/log-error → tabela errors.

## Estado
- Estado por feature: dentro do IIFE do módulo (let _xCache no fechamento).
- Estado compartilhado entre módulos: top-level no app.js (durante a etapa 1 da Fase 4 — depois migra pra getter/setter no namespace).
- Estado do usuário logado: currentUser (head.js).

## Versionamento de assets
- index.html nunca cachea (must-revalidate via _headers).
- JS/CSS versionados via ?v=YYYYMMDDx — bumpar quando muda o arquivo.
- Convenção da letra: a, b, c... até z; depois rolar pra próximo dia.

## Convenções de commit
- Prefixo: feat / fix / chore / docs / refactor / test.
- Escopo opcional: feat(arquitetura), fix(feed), etc.
- Mensagem: imperativo em PT-BR.
- Body: contexto + decisões + lista de mudanças.
- Footer: link da sessão Claude Code se aplicável.

## Branches
- main → produção (queroumacor.com.br).
- staging → integração (CF Preview deploy automático).
- claude/* → branches de trabalho (também ganham preview).

## SQL
- Sempre colar no chat (CLAUDE.md regra).
- Migrations idempotentes (CREATE TABLE IF NOT EXISTS, etc.).
- RLS habilitada por default; service_role bypassa.

## Anti-patterns reconhecidos (não fazer)
- innerHTML com dado de usuário sem escapeHtml.
- await dentro de loop quando se pode usar Promise.all.
- Modal aberto sem closeModals() no fluxo de retorno.
- Bump cache esquecido após editar arquivo versionado.
- Sentry/SaaS externo sem aprovação explícita (preferir interno: tabela errors).
- Touch em app.js sem necessidade durante Fase 4 etapa 1 (cópia pura).

## Enforcement
Algumas convenções acima são verificadas mecanicamente por um script
leve em Node (sem ESLint / sem deps novas):

```bash
npm run lint:conventions          # summary, sempre exit 0
node scripts/check-conventions.js --strict  # exit 1 se houver FAIL
node scripts/check-conventions.js --json    # output JSON pra CI
```

Cobertura (item #18 do audit arquitetural):
- IIFE pattern em `modules/*.js` (`(function(){ ... })();`).
- `'use strict';` dentro de cada IIFE.
- Exatamente 1 `window.Modules.<name> = { ... }` por módulo.
- `?v=` em toda `<script src="/...">` local do `index.html`.
- `console.log` proibido em `modules/*` e `app.js` (warn/error/info ok).
- `// TODO` / `// FIXME` exige `#issue` ou `(YYYY-MM-DD)` na mesma linha.
- Cada `window.Modules.X` deve aparecer em `shims.js` (warn-only).

Roda automaticamente no CI via `.github/workflows/conventions.yml` em
todo push e PR (warn-only por enquanto; trocar pra `--strict` quando o
backlog estiver zerado).
