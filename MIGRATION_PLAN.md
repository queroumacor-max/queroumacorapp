# MIGRATION_PLAN — vanilla JS → Next.js + TypeScript + React (Path C)

> Plano operacional da migração incremental do app vanilla atual
> (`/index.html` + `/app.js` + `/modules/*.js` + `/functions/api/*.js`)
> para a stack Next.js 15 + TS + React + Tailwind v4 que vive em
> `/next-app/`.
>
> Documentos relacionados: `ARCHITECTURE.md` (estado atual),
> `LAYERS.md` (Clean Arch por convenção), `BACKLOG.md` (roadmap geral),
> `next-app/README.md` (PoC do scaffold), `STAGING.md` (preview deploys).
>
> Este documento responde: **por que migrar, em que ordem, com que riscos,
> em quanto tempo, e qual é o critério de cutover por feature.**

---

## 1. Por que migrar?

A vanilla JS atual funciona, mas tem teto de evolução. A auditoria
React/Frontend (30 itens) sobre o app marcou **13 itens como ❌ N/A** —
não porque estão errados, mas porque o app não tem React e portanto não
pode ter hooks, Context, memoização, Redux/Zustand, Suspense, error
boundaries, SSR/SSG, ou qualquer dos padrões idiomáticos modernos. Esses
itens **só desbloqueiam migrando**.

### ROI estimado a 500k usuários

| Vetor de ganho | Estimativa anual (R$) |
|---|---|
| Performance (LCP/INP melhores → menos rage-quit + +conversão) | 200k–400k |
| Retenção (PWA + offline + UX rica) | 150k–300k |
| Velocity (TS strict + componentização → -50% tempo de feature) | 200k–400k |
| Hiring (mercado React >>> vanilla JS) | 100k–150k |
| **Total** | **650k–1,2M/ano** |

### Custo

- **Solo (1 dev + Claude):** 3-6 meses de calendário, ~R$90-180k em custo
  de oportunidade (assumindo R$30k/mês de dev sênior alocado).
- **Janela ótima:** AGORA. O app tem ~13k linhas hoje; em 2 anos vai estar
  em ~50k. Cada mês de adiamento aumenta o custo da migração
  exponencialmente.

### Risco de NÃO migrar

- Cada nova feature consome 2-3× o tempo que consumiria em React + TS.
- Hiring trava — devs sêniores não querem manter vanilla JS legado.
- Bugs de tipo (campo errado, null undefined, payload mal-formado)
  continuam aparecendo em runtime; TS strict cataria em build.

---

## 2. Estratégia escolhida: Path C (Hybrid Incremental)

Três paths foram considerados:

| Path | Descrição | Veredito |
|---|---|---|
| A — Big-bang | Reescrever tudo, soltar em data X | Rejeitado. Risco alto, 0% reversível, 3-6 meses sem entregar feature nova. |
| B — Strangler Fig in-place | Adicionar React no `index.html` lado-a-lado do vanilla | Rejeitado. CSP + bundling + dois mundos no mesmo DOM = caos. |
| **C — Hybrid Incremental** | Next.js em subdomínio/subpath, vanilla continua em prod, features migram 1 a 1 | **ESCOLHIDO.** |

### Como Path C funciona

- **Vanilla continua em produção** em `queroumacor.com.br` durante toda
  a migração. Nada para. Nada quebra silenciosamente.
- **Next.js coexiste** em subdomínio (`app2.queroumacor.com.br`) ou
  subpath (`/v2/`). Mesmo backend Supabase, mesma auth, mesma sessão.
- **Features migram 1 a 1**: portar `feed` (por exemplo) pra Next.js, QA
  no subdomínio, abrir feature flag pra 10% → 50% → 100% dos usuários.
- **Reversível a qualquer momento**: se uma feature regrede no Next.js,
  fechar o flag → vanilla volta a servir aquela tela. Zero downtime.
- **Cutover final** só quando 100% das 44 features migradas e estáveis.
  Aí `queroumacor.com.br` aponta pro Next.js e vanilla vira `/legacy/`
  por 30 dias antes de deletar.

### Compartilhamento de estado entre apps

- **Sessão Supabase**: localStorage compartilhado por domínio raiz. Login
  no vanilla = logado no Next.js, e vice-versa.
- **Backend**: o mesmo Supabase + os mesmos endpoints `/api/*` (até que
  cada endpoint migre para `app/api/*/route.ts`).
- **Assets**: imagens/uploads em buckets Supabase ficam acessíveis dos
  dois lados sem mudança.

---

## 3. Stack alvo

| Camada | Tecnologia | Por quê |
|---|---|---|
| Framework | Next.js 15 App Router | RSC para reduzir bundle JS, file-system routing, edge route handlers, middleware nativo. |
| Linguagem | TypeScript strict | Catches bugs em build, autocomplete, refactor seguro. |
| Estilo | Tailwind CSS v4 | Sem build CSS complexo. `@import "tailwindcss"` e pronto. Já em uso no scaffold. |
| Banco | Supabase Postgres (MESMO) | Zero mudança. RLS já validada. |
| Auth | Supabase Auth (MESMO) | Zero mudança. Sessão compartilhada por domínio. |
| Forms | React Hook Form + Zod | Idiomático React, validação tipada, integra com `lib/schemas.ts`. |
| Server state | TanStack Query | Substitui o cache stale-while-revalidate manual do vanilla. Retry, dedup, optimistic updates de graça. |
| Local state | useState / useReducer | Sem Zustand/Redux até precisar. YAGNI. |
| Observability | `@sentry/nextjs` | Auto-wrap de Server Components, route handlers e middleware. Já conectado ao GitHub do projeto (ver `CLAUDE.md`). |
| Tests | Vitest + RTL + Playwright | Vitest já em uso na vanilla; RTL para componentes; Playwright para E2E. |
| Deploy | Cloudflare Pages via `@cloudflare/next-on-pages` | Mesma infra (plano PRO), mesmas env vars, mesmo workflow de preview. |

---

## 4. Ordem de migração das 44 features

A ordem segue **dificuldade crescente + risco financeiro crescente**.
Começa com features isoladas e de baixo blast radius pra ganhar
momentum e validar a infra. Termina com nav + cutover. A ordem **não é**
puramente alfabética; ela equilibra:

- **Independência** (features que não dependem de outras migram antes).
- **Frequência de bug** (features estáveis migram antes).
- **Risco financeiro** (`mp-webhook` migra por último).
- **Aprendizado** (features pequenas servem de tutorial pra padrões que
  serão repetidos nas grandes).

### Phase 1 — Foundation (~1 semana) — FEITO neste session

- [x] Scaffold Next.js 15 + TS strict + Tailwind v4 em `/next-app/`
- [x] Foundation libs portadas em `lib/`: `db.ts`, `schemas.ts`,
      `policies.ts`, `errors.ts`, `utils.ts`, `config.ts`, `logger.ts`
- [x] `AuthProvider` + middleware básico
- [x] Demo end-to-end: Login (RHF + Zod + Supabase Auth) + Info page
- [x] CI rodando `npm run typecheck` + `vitest run` em ambos os apps
- [x] Sentry wired (`sentry.client.config.ts` etc.)

### Phase 2 — Páginas públicas / simples (~2 semanas, 6 features)

Ordem: features menos críticas, mais isoladas, sem realtime, sem
upload pesado. Objetivo: validar padrão de portagem e ganhar momentum.

1. **info** (`modules/info.js`) — feito no PoC. Sub-páginas (`/info/ajuda`,
   `/info/privacidade`, `/info/termos`, `/info/sobre`, `/info/conta`)
   ainda pendentes.
2. **signup** (`modules/signup-flow.js` + `modules/signup-tag.js`) — fluxo
   multi-step. RHF + Zod brilham aqui.
3. **auth-pw** (`modules/auth-pw.js`) — reset/update password. Página
   `update-password` precisa de tratamento especial (deep-link do email).
4. **notif** (`modules/notif.js`) — read-only list do sininho. TanStack
   Query + Supabase realtime subscription.
5. **pedidos** (`modules/pedidos.js`) — read-only list pintor. Server
   Component com fetch direto.
6. **leads** (`modules/leads.js`) — `comprarObra`, `distribuirLead`.
   Server Action para escritas.

Endpoints associados: `/api/auth-rate-check`, `/api/me-export`.

### Phase 3 — Catálogo + checkout (~2 semanas, 4 features)

ALTA prioridade — toca revenue. Migrar com canary 10% → 50% → 100% e
monitoring tight.

7. **mkt** (`modules/mkt.js`) — loja Cali Colors. Catálogo + carrinho.
   Carrinho já persiste em `profiles.cart` (ver `CLAUDE.md`).
8. **camisetas** — UI dentro de mkt mas merece página própria
   (`/mkt/camisetas`).
9. **pro** (`modules/pro.js`) — checkout PRO (`abrirParceriaMP`,
   `startProCheckout`).
10. **maquininha** (`modules/maquininha.js`) — fluxo de interesse em
    maquininha física (tabela `feature_interest`).

Endpoints: `/api/checkout`, `/api/mp-checkout-loja`. **`/api/mp-webhook`
NÃO migra agora** — fica em vanilla até Phase 9 (ver §8 Riscos).

### Phase 4 — Social core (~3 semanas, 6 features) — MAIS CRÍTICO

A maior superfície de feature do app. TanStack Query brilha aqui
substituindo o cache manual + optimistic updates manuais do vanilla.

11. **feed** (`modules/feed.js`) — feed timeline. TanStack Query
    infinite query + Supabase realtime para novos posts.
12. **feed-interactions** (`modules/feed-interactions.js`) — like /
    comment / save / report. Optimistic updates via `useMutation`.
13. **feed-publish** (`modules/feed-publish.js`) — upload + composer.
    Bucket `posts` já aceita vídeo (ver `CLAUDE.md`).
14. **stories** (`modules/stories.js`) — `IntersectionObserver` vira
    React component com `useIntersectionObserver` hook.
15. **profile-mock** (`modules/profile-mock.js`) — perfil público de
    pintor. Server Component SSG com `generateStaticParams` em pintores
    populares + ISR.
16. **profile-edit** (`modules/profile-edit.js`) — formulário grande
    (avatar, bio, especialidades, raio de atendimento, etc.). RHF
    brilha aqui.

### Phase 5 — Pintor PRO tools (~2 semanas, 7 features)

Features para pintores PRO. Cada uma é uma sub-página independente sob
`/pro/*` ou `/portal/*`. Baixo acoplamento entre elas.

17. **pipeline** (`modules/pipeline.js`) — kanban de orçamentos.
    `dnd-kit` ou `react-beautiful-dnd` para drag-and-drop.
18. **crm** (`modules/crm.js`) — lista de clientes + tags.
19. **agenda** (`modules/agenda.js`) — calendário. `react-day-picker`
    ou `fullcalendar` (lazy load).
20. **financeiro** (`modules/financeiro.js`) — DRE simplificado +
    gráficos. `recharts` ou `tremor`.
21. **avaliacao** (`modules/avaliacao.js`) — sistema de reviews.
22. **quals-courses** (`modules/quals-courses.js`) — qualificações +
    cursos.
23. **calc** (`modules/calc.js`) — calculadora de tinta.

### Phase 6 — Chat + realtime (~2 semanas, 3 features) — DIFÍCIL

A feature de **maior risco técnico** do plano. `chat.js` tem 1175
linhas, faz realtime via Supabase channels, mantém cache local de
mensagens, deduplica via `_msgIds` set, faz throttling de typing
indicator, etc.

24. **chat** (`modules/chat.js`) — avaliar **quebrar em 3 submódulos**:
    `chat-list` (lista de conversas), `chat-msgs` (mensagens da conversa
    aberta), `chat-send` (composer + upload). Cada um vira um componente
    React com seu próprio `useChannel` hook.
25. **orcamento-form** (`modules/orcamento-form.js`) — fluxo de
    orçamento (form complexo, vários steps).
26. **archive** (`modules/archive.js`) — conversas arquivadas. Persiste
    em `profiles.archived_conversations` (ver `CLAUDE.md`).

### Phase 7 — IA features (~2 semanas, 6 features)

Features que dependem de endpoints IA (`chat-ai`, `caption`, `tts`,
`transcribe`, `generate-logo`, `ig-art`). UI relativamente simples — o
peso está nos endpoints. Migrar UI e endpoints em paralelo.

27. **ai-chat** (`modules/ai-chat.js`) — Seu Zé, assistente IA do
    orçamento.
28. **ai-art** (`modules/ai-art.js`) — Arte pra Instagram. Usa bucket
    `style-refs` (ver `CLAUDE.md`).
29. **ai-logo** (`modules/ai-logo.js`) — gerador de logo. Persiste
    contador em `profiles.ai_logo_gen_count`.
30. **audio-stt** (`modules/audio-stt.js`) — speech-to-text via
    `/api/transcribe`.
31. **autoresp** (`modules/autoresp.js`) — auto-resposta de chat.
32. **orcamento-pdf** (`modules/orcamento-pdf.js`) — wrapper de jsPDF.
    Considerar React-PDF (`@react-pdf/renderer`) — vale o trade-off?

### Phase 8 — Misc + cleanup (~1 semana, 9 features)

Features menores, isoladas, baixa frequência de uso. Migrar em batch.

33. **map** (`modules/map.js`) — Leaflet. `react-leaflet` ou wrapper
    custom. Lazy load.
34. **content-mod** (`modules/content-mod.js`) — moderação client-side.
35. **notes** (`modules/notes.js`) — anotações. Tabela `notes` já
    existe (ver `CLAUDE.md`).
36. **checklist** (`modules/checklist.js`) — checklist de obra. Tabela
    `checklists` já existe.
37. **invite** (`modules/invite.js`) — convites + referrals. Sistema
    de pontos já wired no Supabase (ver `CLAUDE.md` SQL Wave 2).
38. **ranking** (`modules/ranking.js`) — ranking de pintores.
39. **points-refs** (`modules/points-refs.js`) — UI dos pontos.
40. **mkt** extras (cores IA, carrinho avançado) — finalizar resíduos.
41. **admin-mod** (`modules/admin-mod.js`) — UI admin. Substitui o
    `/portal` atual (React UMD + Babel) por React real.

### Phase 9 — Nav + cutover (~1 semana)

42. **nav** (`modules/nav.js` + `screen-hooks.js`) — Next.js router
    substitui inteiramente. `showScreen('feed')` vira
    `router.push('/feed')`. Bottom nav vira componente compartilhado.
43. Eliminação de **todas** as inline `onclick="..."` — já implícito ao
    migrar cada feature (componentes React não usam HTML inline).
44. **Service Worker + PWA** reconfig — Next.js precisa do
    `next-pwa` ou `@serwist/next`. Cuidado com conflito entre o SW
    velho (cobrindo `queroumacor.com.br`) e o novo. Solução:
    `clients.claim()` no SW novo + cache versionado por hash do build.
45. **Smoke E2E completo** em `app2.queroumacor.com.br` cobrindo todos
    os 47 fluxos críticos (lista em `tests/e2e/`).
46. **Cutover DNS**: `queroumacor.com.br` aponta pra Next.js Pages
    project. Vanilla vira `legacy.queroumacor.com.br` (mantido 30 dias
    para rollback).
47. **Após 30 dias estável** → deletar vanilla. Apaga `app.js`,
    `modules/`, `shims.js`, `head.js`, `index.html`. Move `next-app/`
    pra raiz do repo.

---

## 5. Endpoints (28 → Next.js route handlers)

Migração paralela às features que os consomem. Ordem segue a Phase
da feature client correspondente.

| Endpoint vanilla | Next.js handler | Phase |
|---|---|---|
| `/api/health` | `app/api/health/route.ts` | 1 ✅ |
| `/api/log-error` | `app/api/log-error/route.ts` | 1 ✅ |
| `/api/cidades` | `app/api/cidades/route.ts` | 1 ✅ |
| `/api/auth-rate-check` | `app/api/auth-rate-check/route.ts` | 2 |
| `/api/me-export` | `app/api/me-export/route.ts` | 2 |
| `/api/checkout` | `app/api/checkout/route.ts` | 3 |
| `/api/mp-checkout-loja` | `app/api/mp-checkout-loja/route.ts` | 3 |
| `/api/mp-webhook` | `app/api/mp-webhook/route.ts` | **9** ⚠️ migra POR ÚLTIMO |
| `/api/upload-style-ref` | `app/api/upload-style-ref/route.ts` | 7 |
| `/api/ig-art` | `app/api/ig-art/route.ts` | 7 |
| `/api/ig-art-diag` | `app/api/ig-art-diag/route.ts` | 7 |
| `/api/generate-logo` | `app/api/generate-logo/route.ts` | 7 |
| `/api/chat-ai` | `app/api/chat-ai/route.ts` | 7 |
| `/api/caption` | `app/api/caption/route.ts` | 7 |
| `/api/tts` | `app/api/tts/route.ts` | 7 |
| `/api/transcribe` | `app/api/transcribe/route.ts` | 7 |
| `/api/moderate` | `app/api/moderate/route.ts` | 8 |
| `/api/moderate-video` | `app/api/moderate-video/route.ts` | 8 |
| `/api/admin-moderate` | `app/api/admin-moderate/route.ts` | 8 |
| `/api/admin-users` | `app/api/admin-users/route.ts` | 8 |
| `/api/admin-errors-list` | `app/api/admin-errors-list/route.ts` | 8 |
| `/api/agenda-order` | `app/api/agenda-order/route.ts` | 5 |
| `/api/crm-draft` | `app/api/crm-draft/route.ts` | 5 |
| `/api/fin-analysis` | `app/api/fin-analysis/route.ts` | 5 |
| `/api/pricing-suggest` | `app/api/pricing-suggest/route.ts` | 5 |
| `/api/area-from-photo` | `app/api/area-from-photo/route.ts` | 5 |
| `/api/resolve-color` | `app/api/resolve-color/route.ts` | 8 |

Helpers privados (`_security.js`, `_ai.js`, `_services/*`) viram
módulos em `next-app/lib/server/`:

| Vanilla | Next.js |
|---|---|
| `functions/api/_security.js` | `lib/server/security.ts` |
| `functions/api/_ai.js` | `lib/server/ai.ts` |
| `functions/api/_services/*` | `lib/server/services/*` |

Padrão de portagem por endpoint: `onRequestPost(ctx)` → `export async
function POST(req: NextRequest)`. Shape muito próxima — find & replace
do `ctx.request` → `req`, `ctx.env` → `process.env`, e tipar o JSON
parseado com Zod.

---

## 6. Critérios de cutover por feature

Cada feature está PRONTA para cutover quando satisfaz **todos** os
critérios abaixo. Sem exceção, sem "depois eu testo".

- [ ] **Implementada** em Next.js (página + componentes + hooks +
      route handlers necessários)
- [ ] **TS strict passa** (`npm run typecheck` no `next-app/` sem
      `any` injustificado)
- [ ] **Tests unit** (Vitest + RTL) cobrem os casos críticos:
      happy path + 1 erro esperado + ownership/policy
- [ ] **Tests E2E** (Playwright) cobrem o fluxo principal end-to-end
      contra Supabase de staging
- [ ] **Sentry** recebe erros do componente (validado com erro
      forçado em preview)
- [ ] **Performance** >= vanilla (medido em Lighthouse: LCP, INP, CLS).
      Se pior em qualquer métrica >10%, investigar antes de cutover.
- [ ] **Acessibilidade** mínima: navegação por teclado funciona,
      ARIA labels nos botões/links sem texto, contraste WCAG AA.
- [ ] **QA manual** em staging (`app2.queroumacor.com.br`) com pelo
      menos 2 sessões reais (não só Claude testando)
- [ ] **Feature flag** desligado por default; abre pra **10%** → monitora
      24h → **50%** → monitora 48h → **100%** se estável
- [ ] **Rollback plan** documentado: se feature regrede, qual flag
      fechar, qual URL volta a servir vanilla

Sem checkbox a menos. Se um item falha, NÃO cutover.

---

## 7. Cutover final (Phase 9)

Quando 100% das 44 features migradas e estáveis em produção:

1. **Backup** do `main` antigo em branch `legacy/v1` (tag git
   `v1-final` para fácil checkout).
2. **DNS**: `queroumacor.com.br` aponta para o Cloudflare Pages
   project do `next-app/`. `legacy.queroumacor.com.br` aponta para o
   Pages project vanilla.
3. **Redirect global**: vanilla service worker é desregistrado via
   bumped SW que faz `self.registration.unregister()` e
   `clients.claim()`. Garante que browsers velhos com SW cacheado
   liberam controle pro Next.js.
4. **Monitoramento 30 dias**: Sentry + Web Vitals comparando contra
   baseline pré-cutover. Qualquer regressão >5% em LCP, INP, error
   rate, ou conversão dispara investigação.
5. **Após 30 dias sem incidente**:
   - Deletar `/app.js`, `/head.js`, `/modules/`, `/shims.js`,
     `/index.html`, `/db.js`, `/policies.js`, `/utils.js`,
     `/schemas/`, `/functions/api/` (depois de confirmar 100%
     migrado), `/portal/` (substituído em Phase 8).
   - Mover conteúdo de `/next-app/` para raiz do repo.
   - Atualizar `ARCHITECTURE.md`, `LAYERS.md`, `CLAUDE.md` para
     refletir realidade nova.
   - Deletar `legacy.queroumacor.com.br` (com aviso prévio caso
     ainda haja tráfego).

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Regressão em produção durante migração | Média | Alto | Feature flags com canary 10/50/100%. Sentry alarme em erro rate >baseline. |
| Cliente em browser velho não suporta Next.js | Baixa | Médio | Vanilla mantido por 30 dias após cutover. Detectar via UA → redirect pra `legacy.` se Next.js falhar. |
| Performance pior que vanilla | Média | Alto | Profile cada feature em Lighthouse antes do cutover. Se pior >10%, reverter e investigar. RSC vs Client Component review por feature. |
| Custo Cloudflare aumenta (build minutes, bandwidth) | Baixa | Baixo | Plano PRO atual já cobre. Monitorar billing mensal. |
| **Bug em `mp-webhook` durante migração** | Crítica se acontecer | Crítico (perda de revenue) | Migra POR ÚLTIMO em Phase 9. Mantém vanilla rodando até confirmado 100% estável no Next.js. Replay de 1 semana de webhooks reais em staging antes de cutover. |
| Sessão Supabase não migra entre apps | Baixa | Médio | localStorage compartilhado por domínio raiz. Testar early no PoC. Fallback: re-login forçado. |
| Service Worker conflito entre vanilla e Next.js | Média | Médio | SW separado por subpath. Teste em incognito + browser real com cache populado. Documentar passos de "limpar SW" pro suporte. |
| TS strict + RHF + Zod aumentam barreira de entrada pra contributors | Média | Baixo | Documentar padrões em `next-app/README.md`. Code review rigoroso nas primeiras PRs de cada Phase. |
| Migração estendida demais (>6 meses) leva a fadiga | Média | Médio | Phases de ~2 semanas cada com merge para `main` ao fim. Vitórias visíveis frequentes. |
| Realtime (chat) regrede no Next.js | Média | Alto | Phase 6 dedicada ao chat. Submódulos (`chat-list`/`chat-msgs`/`chat-send`) testáveis isoladamente. E2E com 2 browsers em paralelo. |
| Bundle size do Next.js explode | Baixa | Médio | RSC por default (zero JS client). Dynamic import para libs pesadas (Leaflet, jsPDF, recharts). Bundle analyzer no CI. |
| Cloudflare Pages limites para Next on Pages (edge runtime restrictions) | Média | Médio | Validar early no PoC quais APIs do Node não estão disponíveis. Forçar `export const runtime = 'edge'` onde possível. |

---

## 9. Equipe ideal (não-Claude-actionable)

Quanto tempo a migração leva em função do tamanho da equipe:

| Configuração | Calendário estimado |
|---|---|
| Solo (você + Claude, 1-2 sessions/semana) | 6-12 meses |
| Solo (você + Claude, 3-4 sessions/semana intensivas) | 4-6 meses |
| Você + 1 dev React sênior dedicado | 3-6 meses |
| Você + 2-3 devs dedicados | 2-3 meses |

Notas:

- Claude acelera porte de boilerplate (RSC + RHF + Zod) e refactor
  mecânico, mas QA manual e decisões de UX continuam dependendo de
  humano. Calendário acima assume QA humano paralelo.
- Contratar dev React sênior demora ~1-2 meses no mercado BR atual.
  Considerar nessa janela.

---

## 10. Timeline realista (solo + Claude, 1-2 sessions/semana)

| Phase | Conteúdo | Sessões Claude | Calendário |
|---|---|---|---|
| 1 | Foundation | 1 (FEITA) | 1 semana |
| 2 | Páginas públicas (6) | 3-4 | 2-3 semanas |
| 3 | Catálogo + checkout (4) | 2-3 | 2 semanas |
| 4 | Social core (6) | 4-5 | 4-5 semanas |
| 5 | Pintor PRO (7) | 3-4 | 3-4 semanas |
| 6 | Chat + realtime (3) | 2-3 | 2-3 semanas |
| 7 | IA features (6) | 2-3 | 2-3 semanas |
| 8 | Misc + cleanup (9) | 2-3 | 2-3 semanas |
| 9 | Nav + cutover | 1-2 | 1-2 semanas |
| **TOTAL** | **44 features + 28 endpoints** | **20-30 sessões** | **~20-30 semanas (5-7 meses)** |

Buffer recomendado: **+20% pra imprevistos** (bug crítico, refactor de
schema, feature nova pedida no meio do caminho). Estimativa honesta:
**6-9 meses de calendário** numa cadência sustentável.

---

## 11. Próximos passos imediatos

Pós este scaffold (estado atual em 2026-05-31):

1. [x] Foundation libs portadas (`lib/db.ts`, `lib/schemas.ts`, etc.)
2. [x] Login + Info demo end-to-end
3. [ ] **Deploy `next-app/` em preview separado** — criar novo Cloudflare
       Pages project apontando pra subdir `next-app/` com build
       `@cloudflare/next-on-pages`. Subdomain candidato:
       `app2.queroumacor.com.br`.
4. [ ] **Validar Supabase Auth funciona end-to-end** — login real no
       preview, ver sessão persistir, ver `currentUser` populado.
5. [ ] **Validar sharing de sessão** — logar no vanilla (prod),
       carregar Next.js (preview) → confirmar sessão herdada.
6. [ ] **Próxima sessão (Phase 2 início)**: portar `signup` (multi-step)
       + `notif` (read + realtime) + `pedidos` (read-only). 3 features
       num único PR pra validar padrão.
7. [ ] Definir **feature flag system** — Cloudflare Workers KV ou
       campo `profiles.feature_flags jsonb`? Decisão antes de Phase 3.
8. [ ] Setup **Playwright** no `next-app/` — fluxo mínimo `login → feed
       → publish post → logout`. Roda em CI.

---

## Apêndice A — Mapping completo vanilla → Next.js (foundation)

| Vanilla | Next.js | Status |
|---|---|---|
| `/db.js` | `next-app/lib/db.ts` | ✅ portado |
| `/schemas/*.js` | `next-app/lib/schemas.ts` (Zod nativo) | ✅ stub, falta porte completo |
| `/policies.js` | `next-app/lib/policies.ts` | 🟡 a portar |
| `/errors.js` | `next-app/lib/errors.ts` | ✅ portado |
| `/utils.js` (parte pura) | `next-app/lib/utils.ts` | 🟡 parcial |
| `/config.js` | `next-app/lib/config.ts` | 🟡 a portar |
| `/logger.js` | `next-app/lib/logger.ts` | 🟡 a portar |
| `/head.js` | `next-app/lib/supabase.ts` + `lib/auth.ts` + `components/AuthProvider.tsx` | ✅ AuthProvider feito |
| `/modules/*.js` | `next-app/app/<feature>/*` + `lib/hooks/<feature>.ts` | 🟡 1/44 (info parcial) |
| `/functions/api/*.js` | `next-app/app/api/*/route.ts` | 🟡 3/28 (health, log-error, cidades) |
| `/index.html <div class="screen">` | `app/<feature>/page.tsx` | 🟡 1/20 (login) |
| `onclick="loadFeed()"` | `<button onClick={loadFeed}>` | implícito no porte |
| `window.X` globals | imports ESM + React Context | implícito no porte |
| `/shims.js` | **DELETADO** após cutover | n/a |
| `/app.js` | **DELETADO** após cutover | n/a |
| `/index.html` | substituído por `app/layout.tsx` + `app/page.tsx` | n/a |

---

## Apêndice B — Glossário

- **PoC**: Proof of Concept — scaffold do Next.js já feito em
  `/next-app/` com login + info funcionando.
- **Cutover**: ato de redirecionar tráfego de uma versão pra outra.
  No Path C, acontece por feature (canary) e depois global (DNS swap).
- **Feature flag**: chave booleana (`flags.use_next_feed = true`) que
  decide se um user vê a versão vanilla ou Next.js daquela tela.
- **Canary**: rollout gradual (10% → 50% → 100%) usado pra validar
  cada feature em produção sem expor 100% dos usuários a regressão.
- **RSC**: React Server Component — renderiza no servidor, manda HTML,
  zero JS client. Default no Next.js 15 App Router.
- **Path C**: estratégia escolhida (Hybrid Incremental). Ver §2.

---

*Documento mantido por convenção viva. Atualizar ao fim de cada Phase
com lições aprendidas, escopo ajustado, e timeline real vs estimado.*
