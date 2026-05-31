# Camadas — equivalente a Clean Architecture no QueroUmaCor

> Documento de **decisão arquitetural consciente**. Explica como esta SPA
> vanilla JS atinge a separação de concerns da Clean Architecture **sem**
> adotar a estrutura formal `domain/application/infrastructure/ui`.
>
> Convivem com este doc: `ARCHITECTURE.md` (estado atual concreto da arch),
> `ARCHITECTURE_PLAN.md` (plano de modularização), `BACKLOG.md` (roadmap).
> Este aqui responde **"por que NÃO Clean formal e como então?"**.

---

## 1. Por que NÃO Clean Architecture formal

A Clean Architecture canônica (Uncle Bob) pressupõe:

- linguagem com tipos / interfaces explícitas (Java, C#, TS, Go, Kotlin),
- injeção de dependência (manual ou via container),
- build step que junta múltiplos arquivos / módulos em um artefato,
- DTOs distintos por camada pra evitar leak de modelo,
- separação física `domain/`, `application/`, `infrastructure/`,
  `interfaces/` (ou nomes equivalentes).

Nada disso é gratuito neste projeto:

- **Vanilla JS sem TypeScript**: não há `interface IFollowsRepository` a
  ser implementada. Faking pra teste é só passar outro objeto com a mesma
  shape. Cerimônia de DI vira boilerplate sem captura de erros em tempo
  de build.
- **Sem build step**: tudo é servido como está pelo Cloudflare Pages
  (exceção: portal admin pré-compila JSX). ES modules nativos quebrariam o
  contrato global descrito abaixo, e adicionar bundler iria contra o
  espírito "sem cerimônia" da SPA.
- **HTML inline handlers**: `index.html` tem ~2300 linhas com `onclick=
  "loadFeed()"`, `onsubmit="signup(event)"`, etc. Esses handlers exigem que
  a função esteja em `window.X`. Migrar pra `addEventListener` era 2ª onda
  de risco — descartado conscientemente em `ARCHITECTURE.md §Frontend`.
- **Tamanho do app**: ~12k linhas de JS no client (depois da Fase 4 etapa 2
  da modularização) + ~25 endpoints backend. Custo de cerimônia
  (interfaces, DTOs, DI containers) supera benefício nesta escala.

**Decisão**: separação de concerns **por convenção** (nomes de arquivo,
papéis claros, regras de dependência seguidas à mão), não por **estrutura
de pastas**. Os benefícios da Clean Arch (testabilidade, regras puras,
adapters trocáveis) são atingidos mesmo assim — verificável (ver §4).

---

## 2. Mapeamento — camada conceitual → arquivos reais

| Camada Clean Arch | Arquivos no projeto | Responsabilidade |
|---|---|---|
| **Domain** | `policies.js`, `validators.js`, `errors.js`, partes puras de `utils.js` (`parseBRL`, `escapeHtml`, `getTimeAgo`) | Regras de negócio puras. **Sem DOM, sem rede, sem Supabase**. Testáveis sem mocks. |
| **Application (Use Cases)** | Funções de feature em `modules/*.js` (`loadFeed`, `sendChatMsg`, `salvarOrcamento`, `syncQuotesToJobs`, `submitReport`) e `functions/api/*.js` (endpoints como casos de uso server-side) | Orquestra Domain + Infrastructure. "O que o sistema faz." |
| **Infrastructure** | `db.js` (facade Supabase), `head.js` (auth, fetch, `getSupabase`, `apiPost`), `logger.js`, `config.js`, `functions/api/_security.js` (auth + rate-limit), `functions/api/_ai.js` (OpenAI ↔ Gemini), service worker `sw.js` | Adapters externos. Esconde detalhes de Supabase, fetch, console, env. |
| **UI / Presentation** | `index.html`, `styles.css`, partes de `modules/*.js` que tocam DOM (`renderConvList`, `appendMsg`, `setFeedFilter`), `app.js` boot (state vars residuais, `showScreen`), `shims.js` (republica handlers como bare globals) | Apresentação. Renderiza estado, captura input, dispara use cases. |

Notas sobre o que **não** existe nesta tabela:

- **Sem camada Application "pura" separada da UI**: numa Clean Arch
  textbook, `loadFeed` (orquestração) seria distinto de `renderFeed` (UI).
  Aqui as duas vivem no mesmo módulo `modules/feed.js` por pragmatismo —
  o ganho de separar seria refator grande sem benefício de teste
  proporcional (não temos teste E2E mesmo).
- **Sem DTO/Entity dedicado**: trabalhamos direto com a row do Supabase
  (`{ id, user_id, caption, ... }`). A "entity" é o shape que
  `db.js POST_COLS` define. Mudança de schema = mudança em `db.js` +
  call sites que lêem campos novos. Migração futura pra TS resolve isso.

---

## 3. Regras de dependência (fluxo válido)

```
            ┌──────────────────────────────────────────┐
            │ UI / Presentation                        │
            │ index.html · styles.css · shims.js       │
            │ DOM bits em modules/*.js · app.js boot   │
            └────────────────────┬─────────────────────┘
                                 │  pode chamar
                                 ▼
            ┌──────────────────────────────────────────┐
            │ Application (Use Cases)                  │
            │ feature fns em modules/*.js              │
            │ endpoints em functions/api/*.js          │
            └──────────┬───────────────────┬───────────┘
                       │  pode chamar      │  pode chamar
                       ▼                   ▼
        ┌──────────────────────┐   ┌──────────────────────┐
        │ Domain (PURO)        │   │ Infrastructure       │
        │ policies.js          │   │ db.js  head.js       │
        │ validators.js        │   │ logger.js  config.js │
        │ errors.js            │   │ _security.js  _ai.js │
        │ utils.js (parte)     │   │                      │
        └──────────────────────┘   └──────────────────────┘
```

**Setas proibidas**:

- Domain **nunca** depende de UI nem de Infrastructure.
  (`policies.js` não pode importar `getSupabase`, não pode tocar DOM.)
- Infrastructure **nunca** depende de Application.
  (`db.js` não pode chamar `loadFeed` ou `syncQuotesToJobs`.)
- UI **não** deve falar direto com Supabase quando há método em `db.js`
  cobrindo. (Esta regra é a mais violada hoje — ver §5.)

---

## 4. Cumprimento real — o que dá pra verificar agora

**Domain é genuinamente puro** (auditável grepando):

- `policies.js`: 109 linhas, zero referência a `document`, `getSupabase`,
  `fetch`, `localStorage`. Só recebe `user`/`resource` e retorna `boolean`.
  Testável em `tests/policies.test.js` sem mocks.
- `validators.js`: 205 linhas, zero `document`/`fetch`. Padrão de retorno
  uniforme `{ ok, error?, value? }`. Algoritmos completos de CPF/CNPJ
  (DVs ponderados) sem deps externas. Testado em `tests/validators.test.js`.
- `errors.js`: hierarquia `AppError` + `ValidationError`,
  `AuthorizationError`, `NotFoundError`, etc. Cada subclasse fixa o par
  `(code, status)` pra padronizar resposta HTTP sem o caller decidir.

**Infrastructure é genuinamente facade**:

- `db.js` esconde a API do Supabase atrás de `DB.profiles.getById/getMany`,
  `DB.follows.follow/unfollow/isFollowing`, `DB.posts.getFeedPosts/getByUser`.
  `DB.follows.follow()` faz **verify-after-insert** (SELECT depois do
  INSERT) pra contornar o bug 23505 onde trigger AFTER INSERT em outra
  tabela faz ROLLBACK silencioso. Esse é o tipo de detalhe que **só
  pertence à infra**, e está corretamente encapsulado.
- `head.js` centraliza `getSupabase()` (lazy singleton), `currentUser`
  (fonte da verdade no client), `apiPost` (fetch + Bearer JWT),
  `withTimeout`, `safeAwait`. Application code não constrói client
  Supabase do zero — pede pra head.
- `functions/api/_security.js` centraliza `getToken`, `requireAuth`,
  `requirePro`, `checkRateLimit`. Endpoints não reimplementam parse de
  JWT nem rate-limit.

**Application orquestra sem reimplementar**:

- `modules/pipeline.js syncQuotesToJobs()` chama `getSupabase()` (infra),
  itera quotes/jobs, decide sync — a regra de "quando virar job" é
  application; o `from('jobs').insert(...)` é infra.
- `functions/api/mp-checkout-loja.js` valida JWT (via `verifySupabaseToken`),
  busca pedido com RLS, confere posse + status, chama Mercado Pago. Cada
  passo é uma chamada à infra; a sequência é o use case.
- `functions/api/log-error.js` aplica rate-limit (infra), trunca campos
  (regra de negócio: "máx 2KB"), loga (infra), persiste via service-role
  (infra) — fire-and-forget com `waitUntil`.

---

## 5. Violações conhecidas e por que aceitamos

Nenhum projeto real cumpre a Clean Arch 100%. Onde sangra aqui:

1. **`head.js` mistura infra + cross-cutting + boot.** Tem `getSupabase`
   (infra puro), `currentUser` (estado global), `loadMyProfileData` (use
   case — deveria estar em `modules/profile-edit.js`), helpers de
   formatação (`brl`, `dateBR`, `avatarUrl`, deveriam estar em `utils.js`).
   **Aceito** porque boot precisa rodar antes de tudo, e `head.js` carrega
   logo após `supabase.js`. Extrair vira efeito dominó. Plano: aos poucos
   mover o que for puro pra `utils.js` e o que for use case pra `modules/`.
2. **`app.js` ainda tem 1189 linhas** com state vars residuais (`chatData`,
   `currentChat`, `_lastOrcData`, etc.), boot one-shots
   (`_injectSheetCloseButtons`, `_bootstrapFromUrl`), helpers exclusivos.
   **Aceito** depois da Fase 4 etapa 2 (era 9176 linhas, -86%). Próxima
   onda é viável mas não prioritária — ROI marginal.
3. **`modules/*.js` misturam Application + UI.** `feed.js loadFeed()`
   (use case) e `buildFeedPostHTML` (UI) vivem juntos. Separar daria 2
   arquivos por feature × 44 módulos = 88 arquivos. Custo cognitivo de
   navegar > ganho de pureza. **Aceito** com a convenção de manter
   funções claramente nomeadas (`render*`, `build*HTML` = UI; `load*`,
   `submit*`, `sync*` = use case).
4. **`functions/api/*.js` misturam HTTP handler + business logic.** Cada
   endpoint é um arquivo com `onRequestPost` que faz parse, validação,
   regra de negócio, escrita, response. **Aceito** até refator dedicado
   (itens #7 e #8 do `ARCHITECTURE_PLAN.md`). Migração natural quando virar
   Next.js / TS.
5. **Escritas direto via `sb.from('X').insert()` espalhadas.** `db.js`
   cobre só `follows.follow/unfollow` no lado de write. Resto do app
   escreve direto. **Aceito** — migrar gradualmente quando tocar a feature.

---

## 6. Como adicionar feature nova — guia prático

| Tipo de mudança | Onde colocar |
|---|---|
| Regra pura (RBAC, validação, formatação) | Função nova em `policies.js`, `validators.js`, ou `utils.js`. Sem deps. Testável direto. |
| Acesso a tabela nova do Supabase (leitura repetida em ≥2 lugares) | Método em `db.js` com `try/catch` que devolve valor seguro (`[]`, `null`, `0`). Atualizar `tests/db.test.js`. |
| Acesso pontual a tabela (1 call site) | `sb.from('X').select(...)` direto no módulo — promovê-lo a `db.js` só quando duplicar. |
| Feature inteira nova no client | Novo arquivo `modules/X.js` no padrão IIFE: `(function(){ 'use strict'; ... window.Modules.X = { fn1, fn2 }; })();` + bump em `shims.js` se algum `fn` precisa virar `window.fn`. |
| Endpoint backend novo | Novo arquivo `functions/api/X.js` exportando `onRequestPost` (ou `onRequestGet`). Usar helpers de `_security.js` pra auth/rate-limit. |
| Erro novo padronizado | Nova subclasse em `errors.js` ou usar `AppError` direto com `{ code, status }`. |
| Constante de config | Em `config.js` se for cross-cutting, ou local ao módulo se for específica. |
| Inline handler novo em HTML | Função tem que viver em `window.X`. Padrão: definir no módulo, expor via `shims.js`. |

---

## 7. Migração futura — TS + framework

Quando (se) este projeto migrar pra TypeScript + Next.js (ou similar), o
custo é dramaticamente menor do que parece, porque a separação já existe:

- **`policies.js`, `validators.js`, `errors.js`** migram quase 1:1 pra
  `.ts` puros. São funções sem deps; só adicionar tipos. Viram pacote
  `@app/domain` se quiser.
- **`db.js`** migra pra `lib/db.ts` ou se torna interface `IDB` com
  implementação `SupabaseDB`. A facade já existe — só formalizar.
- **`modules/*.js`** com lógica de UI viram componentes React (cada
  `renderConvList` → `<ConvList />`). Os use cases (`loadFeed`,
  `syncQuotesToJobs`) viram custom hooks (`useFeed`, `usePipelineSync`)
  ou server actions.
- **`functions/api/*.js`** migram pra Next.js Route Handlers
  (`app/api/X/route.ts`) quase sem mudança — a shape de
  `onRequestPost(context)` é muito próxima de `POST(request)`.
- **`shims.js`** desaparece — não há mais `window.*` necessário.
- **`app.js`** desaparece — boot vira `_app.tsx` / layout.
- **`head.js`** vira `lib/supabase.ts` + `lib/auth.ts` + provider React.

**Estimativa honesta**: 70% do código de domínio + infra migra com find &
replace. 30% (UI bits dos `modules/*.js`) precisa reescrever pra
componentes. **Nada vira tech debt insuperável** pela escolha atual.

---

## 8. Resumo executivo

- Não temos pastas `domain/`, `application/`, `infrastructure/`, `ui/`.
- Temos as **mesmas garantias** (Domain puro testável, Infrastructure
  encapsulada, regras de dependência respeitadas) por **convenção de
  nomes e papéis** dos arquivos.
- Custo de cerimônia evitado vale a impureza tolerada em `head.js`,
  `app.js` e na mistura UI+Application dos `modules/*.js`.
- Estado migra limpo pra TS + framework moderno quando/se fizer sentido.
- Quem adiciona feature nova: §6 é o guia operacional.
