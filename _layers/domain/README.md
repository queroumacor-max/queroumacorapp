# Domain — regras de negócio puras

> **Esta pasta é um índice nominal.** Os arquivos reais NÃO vivem aqui —
> vivem nas raízes do projeto (`/policies.js`, `/schemas/*`, `/errors.js`,
> partes puras de `/utils.js`). Ver [`_layers/README.md`](../README.md)
> pra contexto.

## O que é Domain neste projeto

Regras de negócio **puras**. Sem DOM, sem rede, sem framework, sem
Supabase, sem `localStorage`, sem `document.*`. Funções que recebem
dados, decidem alguma coisa e devolvem resultado. Testáveis sem mocks.

## Arquivos reais que cumprem Domain

| Arquivo | Conteúdo | Responsabilidade |
|---|---|---|
| [`/policies.js`](../../policies.js) | RBAC + ownership predicates (~11 funções) | `canEditProfile`, `canDeletePost`, `canEditQuote`, `canModerateContent`, `canSeeProFeature`, `canFollowUser`, etc. Recebe `user`/`resource`, retorna `boolean`. |
| [`/schemas/_core.js`](../../schemas/_core.js) | Wrapper chainable (`.optional()`, `.refine(fn, msg)`) | Helper de base. `wrap(parseFn)` produz schema testável com `.parse(value) → { ok, value?, error? }`. |
| [`/schemas/primitives.js`](../../schemas/primitives.js) | `email`, `password`, `passwordMatch`, `tag`, `phone`, `name`, `birthDate`, `url` | Validação de primitivos. |
| [`/schemas/documents.js`](../../schemas/documents.js) | `cpf`, `cnpj` (DVs ponderados completos) | Algoritmos de DV sem deps externas. |
| [`/schemas/social.js`](../../schemas/social.js) | `caption`, `comment`, `report` (limites de tamanho social) | Limites de UGC. |
| [`/errors.js`](../../errors.js) | `AppError`, `ValidationError`, `AuthorizationError`, `NotFoundError`, `RateLimitError` | Hierarquia de erro. Cada subclasse fixa `(code, status)` pra resposta HTTP padronizada. |
| [`/utils.js`](../../utils.js) (parte pura) | `parseBRL`, `fmtBRL`, `crmNormName`, `crmMonthsSince`, `_normTxt`, `_hashStr`, `_agYmd`, `escapeHtml`, `getTimeAgo` | Helpers puros — sem deps de DOM, fetch ou Supabase. (A outra metade de `utils.js` toca DOM via `toast`/`alertaCustom` → conta como UI.) |

## Invariante — qualquer função adicionada aqui DEVE ser pura

- Não chamar `getSupabase()` nem `sb.from(...)`.
- Não tocar `document.*`, `window.*` (exceto pra registrar o módulo no boot).
- Não chamar `fetch()`, `apiPost()`, `localStorage.*`.
- Não depender de timer/clock (passe `now` como argumento se precisar).

Verificação rápida:

```sh
grep -nE 'getSupabase|document\.|fetch\(|localStorage|sb\.from' \
  policies.js schemas/_core.js schemas/primitives.js \
  schemas/documents.js schemas/social.js errors.js
# → DEVE retornar zero matches.
```

## Testabilidade

Cada arquivo Domain tem teste correspondente em `/tests/<nome>.test.js`:

- `tests/policies.test.js` — cobre cada predicado RBAC.
- `tests/schemas.test.js` — 13 schemas com casos válidos/inválidos
  (CPF/CNPJ inclusive).
- `tests/db.test.js` — não conta como Domain (testa `db.js` que é infra),
  mas inclui smoke de `Utils` puros.

Sem mocks, sem JSDOM. Vitest roda direto em Node.

## Migração futura pra TS

Migração 1:1 pra `.ts` puro. Vira o pacote `@app/domain` se quiser.
`policies.js` → `policies.ts` com `function canEditProfile(user: User,
target: Profile): boolean`. Schemas viram Zod genuíno ou Valibot.
Erros mantêm a hierarquia com `class AppError extends Error`.
