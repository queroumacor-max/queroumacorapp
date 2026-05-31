# ADR 0001 — Vanilla JS com IIFE + shim em vez de Next.js/TS/React

- **Status**: Accepted
- **Date**: 2026-05-31
- **Deciders**: mantenedor único
- **Tags**: frontend, runtime, build, stack

## Context

A SPA do QueroUmaCor cresceu organicamente como vanilla JS sem build step.
No início de 2026 chegou a ~12k linhas de JS no client (`app.js`
monolítico de 9176 linhas + `head.js`) e ~25 endpoints serverless em
`functions/api/*`. A pergunta natural surge: migrar pra Next.js +
TypeScript + React resolveria muita coisa (tipo, componentes, HMR, SSR,
edge runtime do Vercel)?

Pontos de partida factuais:

- `index.html` tem ~2300 linhas com **centenas** de `onclick="loadFeed()"`,
  `onsubmit="signup(event)"`, `oninput="checkTagAvailability()"`. Esses
  handlers exigem que a função esteja em `window`.
- O time efetivo é 1 mantenedor + Claude Code como par. Cerimônia
  arquitetural cara compete por horas reais.
- O produto é PWA mobile-first instalável; performance de cold-start
  importa, peso de bundle importa.
- Não há feature que exija SSR/streaming/RSC. Telas são interativas pós-
  auth, indexação SEO é só na landing.
- Existe uma camada de UI separada — o **portal admin** — que já é React
  18 UMD + Babel standalone (sem build), também sem framework de build.

## Decision

**Mantemos vanilla JS sem build step.** Refatoramos o monolito em 44
módulos `modules/X.js` no padrão IIFE registrando em `window.Modules.X`,
com `shims.js` republicando como bare globals (`window.X`) pra preservar
o contrato dos inline handlers do HTML. ES modules nativos NÃO são
adotados no client.

Stack resultante:

- Cloudflare Pages serve arquivos estáticos como estão.
- `<script defer>` em ordem fixa em `index.html` (supabase → head → libs
  fundacionais → modules/* → shims → app).
- Backend em Cloudflare Pages Functions (ESM, ver ADR 0003).
- Portal admin React UMD + Babel inline (sem bundler nem ele).

## Consequences

### Positive

- **Zero build step.** Push → CDN. Iteração rápida, sem `npm run build`,
  sem cache de bundler, sem map/sourcemap divergente.
- **Bundle leve.** Sem runtime React/Next no cliente do app principal.
  Tempo de TTI baixo em 3G/4G, que é a realidade do público-alvo.
- **Inline handlers continuam funcionando.** Centenas de `onclick=` no
  HTML não precisam ser tocados — risco enorme evitado.
- **Stack legível.** Qualquer dev JS lê o código sem framework lore.
  Onboarding humano (e do agent) é direto.
- **Migração futura é viável.** `LAYERS.md §7` mapeia o caminho: domain
  puro (`policies.js`, `schemas/`, `errors.js`) migra 1:1 pra `.ts`;
  `db.js` vira interface; `modules/*` viram componentes/hooks; endpoints
  viram Route Handlers. Estimativa: 70% find & replace, 30% reescrita de
  UI. Sem tech-debt insuperável.

### Negative

- **Sem tipos.** Bugs de shape (campo renomeado no Supabase, prop
  passada errada) só pegam em runtime/teste. Mitigação parcial:
  `db.types.d.ts` consumidos via `jsconfig.json` no editor.
- **Sem HMR.** Iteração visual exige refresh manual (ou preview deploy).
  Aceitável porque o produto é mobile-first e testamos no celular real.
- **Padrão IIFE + shim é não-idiomático.** Devs vindos de Next/Vite
  estranham `window.Modules.X` e `shims.js`. Compensamos com docs
  (`ARCHITECTURE.md §Por que IIFE + shim`, este ADR, ADR 0004).
- **Sem code-splitting automático.** Tudo carrega no boot
  (mitigado por defer + cache imutável + bumping). Leaflet é o único
  asset carregado on-demand (via `ensureLeaflet()`).
- **Sem ecossistema de componentes.** Não dá pra `npm install shadcn`.
  Toda UI é HTML+CSS+JS manual. Aceitável pra um app cuja superfície já
  está implementada.
- **Linting de DOM/HTML é limitado.** Sem JSX, sem tsc, sem RN — só
  ESLint vanilla e o script caseiro `check-conventions.js`.

## Alternativas consideradas

- **Next.js + React + TS**: ROI negativo agora. Custo de migração
  (centenas de handlers, ~12k linhas, schema acoplado a UI) supera
  benefício imediato. Re-avaliar quando: (a) o time crescer pra 3+ devs,
  (b) tipos virarem bloqueio mensurável em incidentes, ou (c) precisar
  de SSR/streaming pra alguma feature.
- **Vite + ES modules + sem React**: removeria globals e ganharia HMR,
  mas força reescrita de todos os inline handlers do HTML pra
  `addEventListener` — exatamente o risco que IIFE+shim evita.
- **TypeScript "vanilla" (sem framework)**: adiciona tsc + tipos sem
  ganhar componentes. Em consideração pra foundation libs (`policies`,
  `validators`, `db`) como passo intermediário; ainda não decidido.

## Quando re-avaliar

Gatilhos pra abrir um ADR de superseção:

1. Equipe atinge 3+ devs ativos e onboarding em vanilla JS vira fricção
   recorrente.
2. Volume de bugs de tipo (campo renomeado, shape errado) passa de
   ~1/mês relatado em produção.
3. Aparece feature que precisa de SSR/streaming/edge rendering (raro
   pro modelo PWA).
4. Bundle/perf orçamento aperta e code-splitting manual já não atende.
5. Padrão IIFE+shim começa a impedir refactors em vez de habilitar.

## Referências

- `ARCHITECTURE.md §Frontend`, `§Por que IIFE + shim em vez de ES modules`
- `ARCHITECTURE_PLAN.md` (auditoria que guiou a Fase 4)
- `LAYERS.md §1` (por que não Clean formal), `§7` (migração futura)
- ADR 0004 (arquitetura modular com shims — o "como")
