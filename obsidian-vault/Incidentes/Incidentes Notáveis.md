---
tags: [incidentes, bugs, produção, postmortem]
---

# Incidentes Notáveis (resolvidos)

Consolidado de incidentes de produção com causa raiz e lição — muitos já detalhados nas notas de domínio; aqui fica o resumo cronológico/temático pra busca rápida.

## Auditoria 2026-09-01 — 9 achados corrigidos (P1..P9)
- **P1 (o mais grave): `parseBRL` multiplicava por 100.** Apagava TODO ponto como milhar antes de trocar a vírgula: `"1500.50"` → 150050, `"0.99"` → 99, e até `parseBRL(1500.5)` → 15005 (número passava por `String()`). O campo de preço usa `inputMode="decimal"` e o teclado do Android oferece PONTO — era o caminho comum, não caso de canto. Atingia preço de arte à venda, Financeiro, Agenda e o `brlSchema`. Pior: os comentários em `utils.ts` e `schemas.ts` JÁ AFIRMAVAM aceitar `"1500.50"`. **Regra nova: vírgula sempre é decimal; ponto é decimal com 1-2 casas (ou parte inteira zerada) e milhar com 3.** 7 testes novos.
- **P2 foi FALSO ALARME e a lição é essa.** `linkUrl` faltava nas deps de um `useCallback` de submit, mas não causava bug: `autosave` também está nas deps e o `useAutosave` devolve **objeto novo a cada render**, então o callback era recriado sempre. A correção do link dependia de um acidente em outra dependência — estabilizar o retorno do `useAutosave` (o certo pra perf) reintroduziria o bug em silêncio. **Só confirmei porque o teste de regressão passou SEM o fix.** Teste que não falha sem a correção não é teste de regressão.
- **P3: busca aproximada NUNCA decide destinatário de mensagem.** `resolveCalicolorsUserId` caía em `.ilike('name','%cali%').limit(1)` sem `order` — casava com Calixto/Micaeli/Carlos Calisto e escolhia de forma não-determinística. Esse id abre a conversa "🎨 Loja": dava pra mandar pra um estranho. Agora só igualdade exata (tags conhecidas → nome exato), e **erro do Supabase não é mais lido como "não existe"**.
- **P4/P5: `catch {}` mudo esconde bug por meses.** O upload da foto no CADASTRO falhava em silêncio (nem toast, nem `/admin/errors`) — foi o que escondeu o bug de MIME em todo cadastro novo (ver [[Mobile - Bugs de WebView e Picker]]). O perfil público engolia falha de quals/cursos/avaliações e renderizava **vazio**: pintor com 20 avaliações aparecia sem nenhuma, na tela onde o cliente decide contratar. Os `.catch` individuais dentro de `Promise.all` também precisam marcar a falha.
- P6 (`linkUrl`/`artType` não limpos após publicar), P7 (regressão: `armarSelecao` sem cancelar no unmount deixava ouvintes vivos e marca no localStorage → aviso falso "o app reiniciou"), P8 (`??` não é fallback pra efeito colateral: `handler?.(err) ?? console.warn(...)` logava sempre) e P9 (pílulas `bg-gray-100` sem inversão no dark).
- **`eslint.ignoreDuringBuilds: true`** no `next.config.mjs`: os ~17 avisos do linter nunca aparecem no deploy. Rodar `next lint` na mão.

## Auditoria 2 (2026-09-01) — achados A1..A4
- **A1: o selo PRO mentia pra quem venceu.** Havia DUAS fontes de verdade: o `TopNav` dizia PRO com `is_pro=true` sozinho, enquanto `canSeeProFeature` (o portão real, usado em Agenda/CRM/Anotações) exige `is_pro=true` **E** data futura quando há data. E **nada limpa `is_pro` no vencimento** — não há cron nem trigger, e o portal ativa PRO gravando `is_pro=true` + expiração. Ou seja, "is_pro com data vencida" é estado PERMANENTE: a pessoa via PRO na barra e levava "exclusivo do Plano PRO" em toda ferramenta. O `TopNav` agora usa `usePolicyUser` + `canSeeProFeature`/`isAdmin`. **REGRA: selo e portão perguntam à mesma função.** (Há uma 3ª implementação no banco, `is_pro_active`.)
- **A2: "hoje" saía do fuso do APARELHO.** O patch de fuso do `layout.tsx` cobre só `toLocale{Date,Time,}String` — **`getTimezoneOffset()` passa direto**, e era ele que decidia o dia em 5 lugares. O Brasil tem mais de um fuso (Manaus, UTC−4): entre meia-noite e 1h o aparelho diz um dia e Brasília já está no seguinte. Deslocava o destaque de "hoje" na agenda, o recorte do dia no Financeiro e a data de follow-up do pipeline. Helpers novos em `utils.ts`: **`ymdBrt()`** (que dia é hoje em Brasília, via `Intl` com `timeZone` — não depende do patch) e **`ymdDeCampos()`** (formata um Date montado a partir de ano/mês/dia). `agYmd` virou apelido depreciado. `ymdBrt` tem fallback pro fuso do aparelho se o `Intl` falhar (WebView sem ICU completo). Suíte verde em São Paulo, Manaus, UTC, Tóquio, Los Angeles e Lisboa. Ver [[Infraestrutura - Cloudflare, Env Vars e Deploy]] pra regra geral de fuso.
- A3 (legenda/comentário sem `overflowWrap` — palavra longa era cortada pelo `overflow-x: hidden` do AppShell; comentário precisou de `minWidth: 0` por ser flex item) e A4 (`cartTotal` somava float e gravava `269.70000000000005` no pedido; agora soma em centavos).
- **Descartado após verificar**: rotas "sem gate" (autenticam uma camada abaixo, no service) e 97 "botões sem `aria-label`" (regex errado; as amostras têm texto ou o atributo em linha seguinte).

## Parsing de valores (`parseBRL`) — ver P1 acima
Mesma entrada, consolidada.

## Busca aproximada decidindo destinatário de mensagem — ver P3 acima
Mesma entrada, consolidada.

## `catch {}` mudo escondendo bugs por meses — ver P4/P5 acima
Ver também [[Mobile - Bugs de WebView e Picker]] (upload de mídia sem segunda chance) e [[Auth - OAuth, Cadastro e RLS de Sessão]] (`reportFailure` no publish/avatar).

## `eslint.ignoreDuringBuilds: true` escondendo ~17 avisos do deploy
Avisos nunca aparecem no CI — rodar `next lint` manualmente.

## Cache do portal / SRI
Mexer no `app.js` do portal sem refazer o hash SRI do `index.html` → navegador recusa em silêncio, "Carregando..." eterno pra sempre. Regra registrada em [[Portal - Pessoas, Produtos e Ferramentas]] e em [[Infraestrutura - Cloudflare, Env Vars e Deploy]] (cache-busting).

## Contador de seguidores em dobro (Wave 54, 2026-08-30)
Perfil novo com 3 follows mostrava 6 (2× exato, sem backfill no meio = veio só de trigger). Dois triggers de contador vivos em `follows` simultaneamente — um legado além do `trg_maintain_follow_counts` da Wave 40, que só derrubava o homônimo. `/migrations/2026-08-30-follow-counts-dedupe.sql` derruba todo trigger de contador não-canônico (filtro: a função toca followers/following/posts_count — triggers de pontos/notificação passam) e RECONTA os três contadores da verdade. **Lição: wave nova de trigger precisa varrer duplicatas por FUNÇÃO, não só pelo próprio nome do trigger.** Detalhe adicional em [[Performance - Índices, RPCs e Paginação]].

## `File` comparado por `toEqual` em teste — falso verde
`File` não tem propriedade própria enumerável — dois arquivos diferentes passam como iguais em `toEqual`. Aconteceu no fix de "Failed to fetch ao publicar" (ver [[Mobile - Bugs de WebView e Picker]]): o 1º teste passou com a correção revertida. **Regra: comparar `File` por IDENTIDADE (`toBe`), nunca `toEqual`/`toHaveBeenCalledWith`.**

## Teste "skipped" contando como verde
Vitest reporta arquivo com erro de parse como "skipped", não "failed" — contagem de `Tests passed` sobe normalmente enquanto `Test Files` teria a pista. Aconteceu com `__tests__/portalJanela24h.test.ts` (extração de trecho JSX quebrou o parse, arquivo foi pra "skipped" e quase passou despercebido, com `1619 passed | 12 skipped`). **Regra: conferir a linha `Test Files`, não só `Tests`.** Fix: marcadores nomeados (`// [teste:janela-inicio]`/`-fim`) + teste que falha ALTO se um marcador sumir ou se entrar JSX entre eles.

## Fuso horário — "hoje" saía do aparelho, não de Brasília
Ver A2 acima — `getTimezoneOffset()` não é coberto pelo patch de `toLocaleString`. Helpers `ymdBrt()`/`ymdDeCampos()` corrigem sem depender do patch.

## Página 500 do Next tem DOIS caminhos internos, e nenhum cobre erro de App Router abaixo do render
`pages/500.tsx` cobre só erro ESTÁTICO; erro em runtime cai em `pages/_error.tsx`. E nenhum dos dois cobre falha abaixo do render do App Router (esse caso específico era o Service Worker interceptando o payload RSC e devolvendo um 500 cru direto pro router — ver [[Mobile - Bugs de WebView e Picker]] pra investigação completa, incluindo a pegadinha de criar `pages/` mudar a tipagem global do `useSearchParams()`).

## `waitUntil` chamado solto → 500 síncrono no webhook do WhatsApp (2026-09-05)
`runAfterResponse` fazia `const waitUntil = ctx?.waitUntil` e chamava `waitUntil(seguro)` — método de API nativa do workerd (ExecutionContext) chamado fora do objeto dono lança `TypeError: Illegal invocation`, e de forma SÍNCRONA dentro do handler, derrubando a resposta inteira com 500 mesmo a mensagem já tendo sido reconhecida. **REGRA: método de API nativa se chama NO OBJETO DONO** (`ctx.waitUntil(...)`, nunca extraído pra variável solta) — vale também pra `crypto.subtle.*`, `fetch`, `TextEncoder`. O teste antigo não pegava porque um `vi.fn()` solto não liga pro `this`; só um objeto que EXIGE o `this` reproduz o bug. Detalhe completo em [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]].

## Duas identidades reconciliadas por sessões paralelas — "auditei agora" vale minutos
Ver [[Infraestrutura - Cloudflare, Env Vars e Deploy]] (corte de DNS P8) e a entrada de susto pós-merge de 2026-09-19 (contenção de fila) — as duas são a mesma classe de incidente: uma sessão audita/valida algo, outra sessão em paralelo (mesmo usuário, ambiente diferente) muda o estado real minutos depois, e a conclusão da 1ª sessão fica obsoleta sem ninguém perceber até reconferir. **Regra prática: com mais de uma sessão mexendo no mesmo projeto, reconferir `origin/main`/painel logo antes de agir, não confiar num snapshot de minutos atrás.**

---
## Ver também
[[Convenções Gerais de Desenvolvimento]] · [[Mobile - Bugs de WebView e Picker]] · [[Auth - OAuth, Cadastro e RLS de Sessão]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]] · [[Posts, Stories e Feed]]
