# Application — use cases / orchestration

> **Esta pasta é um índice nominal.** Os arquivos reais NÃO vivem aqui —
> vivem em `/modules/*.js` e `/functions/api/_services/*.js`. Ver
> [`_layers/README.md`](../README.md) pra contexto.

## O que é Application neste projeto

**Use cases**: funções que orquestram Domain (regras puras) + Infrastructure
(DB, fetch, auth) pra resolver uma feature completa. "O que o sistema faz."

Padrão: use case **chama** Domain (valida via `Schemas`, autoriza via
`Policies`) e Infrastructure (busca/grava via `DB.*`, fetch via `apiPost`),
retorna dado ou faz `throw new ServiceError(...)`. Não reimplementa nada
que já existe nas camadas vizinhas.

## Arquivos reais que cumprem Application

### Client-side — `/modules/*.js` (44 módulos IIFE)

Cada módulo é uma feature isolada que registra `window.Modules.X = { fn1,
fn2 }`. Funções de feature contam como use cases. Exemplos:

| Módulo | Use cases | Domain/Infra usados |
|---|---|---|
| [`/modules/feed.js`](../../modules/feed.js) | `loadFeed`, `loadMoreFeed`, `refreshFeed` | `DB.posts.getFeedPosts`, `DB.follows.listFollowingIds`, `Policies.canSeePost` |
| [`/modules/chat.js`](../../modules/chat.js) | `sendChatMsg`, `loadConvList`, `openChat` | `getSupabase()`, `Schemas.comment`, realtime channels |
| [`/modules/orcamento.js`](../../modules/orcamento.js) | `salvarOrcamento`, `gerarPDF`, `enviarOrcamento` | `parseBRL`, `apiPost('/api/pricing-suggest')`, `jspdf` |
| [`/modules/pipeline.js`](../../modules/pipeline.js) | `syncQuotesToJobs`, `moveJobStage` | Regra "quote → job" = application; `sb.from('jobs').insert` = infra |
| [`/modules/feed-interactions.js`](../../modules/feed-interactions.js) | `likePost`, `submitReport`, `comentarPost` | `Policies.canDeletePost`, `Schemas.report`, `DB.posts.*` |
| [`/modules/agenda.js`](../../modules/agenda.js) | `loadAgenda`, `criarEvento` | `apiPost('/api/agenda-order')` |
| ... | (mais 38 módulos) | Ver `ls modules/` |

Lista completa: `ls /home/user/queroumacorapp/modules/` (44 arquivos).
Cada IIFE expõe seu set de funções via `window.Modules.X`. Bridge
`shims.js` republica como bare `window.fn` pra HTML inline handlers.

### Server-side — `/functions/api/_services/*.js` (services privados)

Endpoints HTTP `/functions/api/X.js` agora delegam pra services
extraídos. O service é o use case backend; o arquivo `X.js` é só HTTP
handler + glue (parse body, auth check, chamar service, formatar response).

| Service | Use case |
|---|---|
| `_services/suggestPrice.js` | sugestão de preço por área/cidade |
| `_services/createProCheckout.js` | criar checkout Mercado Pago PRO |
| `_services/moderateContent.js` | moderar UGC (texto/imagem) |
| `_services/generateLogo.js` | gerar logo via IA |
| `_services/igArt.js` | montar arte pra Instagram |
| `_services/crmDraft.js` | rascunho CRM gerado por IA |
| `_services/finAnalysis.js` | análise financeira mensal |
| `_services/agendaOrder.js` | ordenar agenda inteligentemente |
| `_services/resolveColor.js` | resolver cor por descrição livre |
| `_services/areaFromPhoto.js` | estimar área de foto |
| `_services/transcribe.js` | STT |
| `_services/caption.js` | gerar captions de mídia |
| `_services/tts.js` | TTS |
| `_services/meExport.js` | export LGPD do próprio usuário |
| `_services/cidades.js` | autocomplete IBGE (parte use case; adapter HTTP fica em infra) |

(Lista exata varia conforme refator; `ls functions/api/_services/` é a fonte.)

## Padrão de erro

Use cases fazem `throw new ServiceError(code, message, status)` (definida
em `functions/api/_security.js`) ou usam a hierarquia de `/errors.js` no
client. O HTTP handler em `functions/api/X.js` traduz pra response JSON.

## Migração futura

Cada `modules/X.js` poderia virar `app/features/<name>/page.tsx` +
custom hook (`useFeed`, `usePipelineSync`) + service em React/Next.
Cada `_services/X.js` migra quase 1:1 pra Route Handler ou Server Action
(`app/api/X/route.ts`).
