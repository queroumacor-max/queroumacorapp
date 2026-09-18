# ADR 0006 — Migração @cloudflare/next-on-pages → @opennextjs/cloudflare (deploy pipeline)

- **Status**: Proposed — investigação/documentação feita em branch de
  avaliação isolada (`claude/next16-opennext-eval`, nunca empurrada,
  nenhum PR aberto). Este ADR documenta o TAMANHO da mudança pro
  mantenedor decidir; não implementa nada em `main`, `STAGING.md`,
  `DEPLOYMENT.md` nem em qualquer config real de produção.
- **Date**: 2026-09-18
- **Deciders**: pendente (mantenedor ainda vai decidir)
- **Tags**: infra, deploy, cloudflare, build, runtime

## Context

`next@15.5.25` tem uma vulnerabilidade de dependência transitiva
(`postcss` — GHSA-qx2v-qp2m-jg93 e mais 3 CVEs relacionados) que só se
fecha de verdade subindo `next` pra major (`16.3.5`, confirmado via
`npm audit`). O adapter atual, `@cloudflare/next-on-pages@1.13.16`, está
**deprecado** (o próprio pacote recomenda migrar pro OpenNext) e sua
última versão publicada trava `peerDependencies.next` em `<=15.5.2` — não
há caminho de suporte pra `next@16` com esse adapter. `@opennextjs/
cloudflare@1.20.6` já declara suporte a `next: ">=15.5.24 <16 ||
>=16.3.3"`, cobrindo exatamente `16.3.5`.

Testado numa branch isolada (ver relatório completo no histórico de chat
da sessão que criou este ADR): com `next@16.3.5` + `@opennextjs/
cloudflare@1.20.6` + `wrangler@^4.134.0`, o build local completo passa —
`next build`, `opennextjs-cloudflare build`, suíte de testes (2299/2299),
`tsc --noEmit`, e (depois de migrar o ESLint pro flat config) `eslint .`
também rodam limpos como FERRAMENTA (sem crash de config; findings de
código são outra questão). `npm audit` confirma que `postcss`/`next`
somem da lista de vulnerabilidades depois do bump.

**O que este ADR NÃO resolve**: o build local passar não significa que o
DEPLOY passa. `@opennextjs/cloudflare` não gera o mesmo tipo de artefato
que `@cloudflare/next-on-pages` gerava, e isso muda a peça de infra que
este projeto usa pra publicar — Cloudflare **Pages** hoje, potencialmente
Cloudflare **Workers** depois. Esse é o objeto deste ADR.

## Decision

**Ainda não decidida.** Este documento só registra o que MUDARIA se a
migração for adiante, pra decisão ser informada.

## O que muda, concretamente

### 1. Formato do artefato publicável

| | `@cloudflare/next-on-pages` (atual) | `@opennextjs/cloudflare` (proposto) |
| --- | --- | --- |
| Comando de build | `npx @cloudflare/next-on-pages@1` | `opennextjs-cloudflare build` |
| Saída | `.vercel/output/static/` (HTML/JS/CSS estático + `_worker.js` gerado a partir das rotas dinâmicas) | `.open-next/assets/` (estático) + `.open-next/worker.js` (um Worker de verdade, escrito à mão pelo adapter, não derivado automaticamente das rotas) |
| Runtime de produção | Cloudflare **Pages Functions** (o `_worker.js` roda dentro do modelo de Pages) | Cloudflare **Worker** nativo — Pages vira só o host dos assets estáticos, ou some do quadro por completo dependendo de como se publica |

### 2. Comando/superfície de deploy

Hoje (`next-app/wrangler.toml`, `package.json`):

```
wrangler pages deploy .vercel/output/static --project-name=queroumacor-next
```

Com OpenNext (`wrangler.jsonc`, template do próprio adapter):

```
opennextjs-cloudflare build && opennextjs-cloudflare deploy
# por baixo: wrangler deploy (não `wrangler pages deploy`)
```

`wrangler deploy` publica um **Worker**, não um projeto Pages. São dois
produtos diferentes no dashboard do Cloudflare, com páginas de
configuração, logs e billing separados (Workers tem seu próprio modelo de
cobrança/limites, distinto de Pages).

### 3. O que hoje depende do modelo "Cloudflare Pages" especificamente

Levantamento no repo (`DEPLOYMENT.md`, `STAGING.md`, `.github/workflows/
deploy.yml`, `next-app/wrangler.toml`) do que assume Pages e precisaria
ser revisto:

- **Preview deploy automático por branch** (`STAGING.md` inteiro): hoje é
  comportamento NATIVO do Cloudflare Pages via Git integration — todo
  push em branch != `main` ganha `<branch-slug>.queroumacorapp.pages.dev`
  de graça, sem configurar nada. Cloudflare Workers **não tem esse
  recurso embutido** — "preview por branch" em Workers normalmente exige
  Workers Environments configurados à mão (`wrangler.jsonc` com `env.*`)
  ou Worker Versions/Gradual Deployments, nenhum dos dois com o mesmo
  "zero config, funciona sozinho" que Pages dá hoje.
- **`X-Robots-Tag: noindex` automático em preview** (`STAGING.md`): também
  comportamento nativo do Pages preview; não existe em Workers sem
  replicar via código/config própria.
- **Banner amarelo "🧪 STAGING"** (`STAGING.md`, injetado por detectar
  `location.hostname !== 'queroumacor.com.br'`): a LÓGICA do app não
  muda, mas o HOSTNAME que aparece nesse cenário muda de formato
  (`*.pages.dev` → o que quer que o setup de Workers Environments gerar,
  se gerar).
- **Env vars via painel do CF Pages** (`NEXT_PUBLIC_*` em `[vars]` do
  `wrangler.toml`, secrets via painel "Environment variables"):
  Workers usa `wrangler secret put` / `[vars]` no `wrangler.jsonc`
  próprio — mecanismo parecido mas é OUTRO painel, outra superfície de
  API, e a separação Production/Preview de env vars que `STAGING.md`
  documenta como "verificado e fechado" (nenhum secret de produção vaza
  pro Preview) precisaria ser reconferida do zero no modelo novo, não
  presumida como igual.
- **`.github/workflows/deploy.yml`** (dispatch manual, hoje já secundário
  ao deploy automático via Git integration): usa
  `cloudflare/wrangler-action` com `command: pages deploy ...` — o
  comando muda pra `command: deploy` (Workers) ou o workflow inteiro é
  substituído pelos comandos `opennextjs-cloudflare build && deploy`. O
  step "Scan artifact for stray source maps" que varre
  `.vercel/output/static` (ver ADR relacionado à auditoria de 13/09)
  precisa apontar pra `.open-next/assets` — MESMO achado que já bateu no
  `scripts/strip-source-maps.mjs` nesta mesma investigação.
- **KV binding pra cache de cidades IBGE** (comentário em
  `wrangler.toml`, hoje configurado só no painel CF Pages, não lido pelo
  código ainda): binding de KV em Workers é declarado direto no
  `wrangler.jsonc` (`kv_namespaces`), não no painel — outra pegada,
  mesma capacidade.
- **Cache incremental do Next (ISR/`revalidate`)**: `@opennextjs/
  cloudflare` tem um sistema de cache próprio via R2 (ver template
  `open-next.config.ts` gerado pelo CLI, que já sugere um bucket R2 —
  `NEXT_INC_CACHE_R2_BUCKET`). Este projeto não usa muito ISR hoje
  (a maioria das rotas dinâmicas é `ƒ` — server-rendered on demand, sem
  revalidate), mas qualquer rota que dependa de cache implícito do Next
  precisaria ser reavaliada nesse novo modelo.

### 4. O que PROVAVELMENTE não muda

- O código da aplicação em si (`app/`, `components/`, `lib/`) — o build
  local provou que compila e passa nos testes sem alteração de lógica.
- RLS/Supabase/Auth — nada disso depende de Pages vs Workers.
- O domínio `queroumacor.com.br` continua apontando pro Cloudflare; só
  o QUE responde na origem muda de "Pages project" pra "Worker".

## Plano concreto: reconstruindo em Workers o que Pages dá de graça

Esta seção detalha COMO cada item da seção 3 seria refeito, pro mantenedor
dimensionar o esforço antes de decidir. Nada aqui foi implementado — é
levantamento de mecanismo, não código real.

### P1. Preview por branch

Workers não tem "todo push numa branch ganha uma URL sozinho" — isso é uma
feature do Git integration do Pages, que não existe pro produto Workers.
O mecanismo mais próximo é **Worker Versions** (parte de Gradual
Deployments): `wrangler versions upload` publica uma versão do Worker SEM
mover tráfego pra ela, e devolve uma URL de preview própria no formato
`https://<version-short-id>-<worker-name>.<subdomínio-da-conta>.workers.dev`
— funcionalmente equivalente ao que o Pages faz, mas **não automático**:
precisa de um passo de CI que rode em todo push de branch != `main`.

Desenho proposto:

1. Novo workflow `.github/workflows/preview-deploy.yml`, `on: push` com
   `branches-ignore: [main]` (paralelo ao `ci.yml`, não substituindo).
2. Roda `npm run build:cf` (mesmo comando de hoje) e, em vez de
   `wrangler pages deploy`, roda `wrangler versions upload --env preview`
   (o `--env` importa — ver P4).
3. Captura a URL de preview da saída do comando (`wrangler versions
   upload` imprime a Preview URL em stdout; via `--json` dá pra parsear
   estruturado) e posta como comentário no PR (`actions/github-script` ou
   equivalente) — porque não existe um "Deployments" tab do Pages
   mostrando isso sozinho; sem esse passo, a URL fica só no log do Actions
   e ninguém acha.
4. **Diferença de custo/modelo real**: Worker Versions preview URLs usam o
   MESMO Worker nomeado (`queroumacor-next`), então não há "N workers
   diferentes, um por branch" — é uma versão nova do mesmo Worker, sem
   tráfego roteado pra ela por padrão. Isso é bom (não multiplica
   contagem de Workers no plano) mas significa que **branches concorrentes
   sobrescrevem a "última versão preview"** só no sentido de qual aparece
   primeiro na lista do dashboard — cada URL de preview continua válida
   e endereçável independente, então não há colisão real entre branches
   simultâneas, mas o dashboard de Workers não organiza isso por branch
   como o Pages faz.

Nada disso substitui `STAGING.md` — o documento inteiro precisaria ser
reescrito descrevendo este fluxo novo (comando manual `wrangler versions
upload` continua funcionando pra teste local também, sem esperar o CI).

### P2. `X-Robots-Tag: noindex` em preview

No Pages isso é automático (toda URL de preview ganha o header sozinha).
Em Workers, quem serve a resposta é o próprio `.open-next/worker.js` — não
existe uma camada de infra separada aplicando headers "porque é preview".
Precisaria de um wrapper fino em volta do handler gerado pelo OpenNext
(ou um `open-next.config.ts` com um hook, se o adapter expuser um; a
versão testada nesta avaliação não configurou isso — ver `open-next.config.ts`
nesta branch, vazio de propósito) que, quando `env` indicar ambiente de
preview (uma var própria, setada só no `env.preview` do `wrangler.jsonc` —
ver P4), injeta o header em toda resposta antes de devolver. Ou seja: sai
de "grátis, automático" pra "mais um middleware pra escrever, testar e
manter" — pequeno em código, mas é superfície nova.

### P3. Banner "🧪 STAGING"

A LÓGICA do componente (`StagingBanner.tsx`, comparando
`window.location.hostname` contra `queroumacor.com.br`) não muda — ele já
funciona com QUALQUER hostname diferente do de produção, incluindo o
formato novo de URL do Workers (`<version>-<worker-name>.<subdomínio>
.workers.dev`, bem mais longo e menos legível que
`<branch-slug>.queroumacorapp.pages.dev`). O único ajuste é cosmético: a
mensagem mostra o hostname cru, então o banner ficaria com uma URL bem
mais feia/longa até alguém decidir formatar melhor. Não é bloqueante, é
só pior UX de debug até alguém notar.

### P4. Env vars / secrets — replicando a fronteira de segurança já verificada

Este é o item que exige mais cuidado, porque `STAGING.md` documenta uma
garantia de segurança CONCRETA e VERIFICADA (2026-09-16): o ambiente de
Preview do Pages hoje só tem 5 variáveis públicas, zero secret de
produção. Migrar pra Workers não pode ser "copia tudo pro `wrangler.jsonc`
e reconfere depois" — precisa nascer já com essa mesma fronteira, ou o
risco que `STAGING.md` fechou reabre no primeiro deploy do modelo novo.

Mecanismo em Workers: `wrangler.jsonc` suporta múltiplos **environments**
nomeados (`env.production`, `env.preview`, etc.), cada um com seu próprio
bloco `vars` (não-secreto, no arquivo, versionado) e seus próprios
secrets, setados via `wrangler secret put <NOME> --env <ambiente>` —
comando por comando, um secret nunca é lido de volta depois de setado
(mesma propriedade do painel do Pages hoje).

Desenho proposto:

- `wrangler.jsonc` ganha `env.production` (secrets completos: Supabase
  service role, chaves de IA/MP/WhatsApp/FCM — os mesmos que hoje só
  existem no painel Pages, migrados um a um) e `env.preview` (só as
  MESMAS 5 vars públicas que Preview tem hoje: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`,
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` — a mesma lista que já
  está em `wrangler.toml [vars]` nesta branch de avaliação).
- O workflow de preview (P1) SEMPRE publica com `--env preview` — nunca
  `--env production` a partir de uma branch de feature. O workflow de
  produção (substituto do `deploy.yml` atual) é o ÚNICO que usa
  `--env production`, e continua restrito a `main` (mesmo guard
  `if: github.ref == 'refs/heads/main'` que existe hoje, ver
  `.github/workflows/deploy.yml:23`).
- **Diferença importante de superfície**: hoje a separação Production/
  Preview do Pages é um recurso do PAINEL — alguém com acesso ao painel
  mas sem acesso ao repo não consegue misturar os dois sem querer, porque
  a UI já separa as duas abas. Em Workers, a separação vira **convenção
  de código** (`--env` no comando) — mais fácil de errar num deploy manual
  feito à mão fora do CI. Mitigação: nenhum humano roda `wrangler deploy`
  manualmente pra produção; só o workflow de CI (mesma regra que já vale
  hoje, o `deploy.yml` atual já é dispatch-manual-mas-via-Actions, não via
  laptop de alguém).
- Reconferir esta fronteira (nenhum secret de produção acessível a partir
  de `env.preview`) com o MESMO rigor que `STAGING.md` documenta pro
  modelo atual — não presumir que "copiei a lista de 5 vars, tá igual".

### P5. `.github/workflows/deploy.yml` (produção)

Reescrita direta, sem ambiguidade de mecanismo (ao contrário do preview):

```yaml
- name: Build Cloudflare Worker output
  run: npm run build:cf   # já aponta pra .open-next/assets nesta branch

- name: Scan artifact for stray source maps / secrets
  run: |
    MAPS=$(find .open-next/assets -iname '*.map' | wc -l)   # path novo
    # ... resto do guard idêntico, só o path muda

- name: Deploy to Cloudflare Workers
  uses: cloudflare/wrangler-action@<mesmo-sha-pinado>
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: next-app
    command: deploy --env production   # não mais `pages deploy`
```

O guard `if: github.ref == 'refs/heads/main'` (auditoria CI/CD de
2026-09-13, ver `CLAUDE.md`) e `persist-credentials: false` continuam
valendo sem mudança — nada disso é específico de Pages.

### P6. KV binding (cidades IBGE)

Hoje configurado só no painel (comentário em `wrangler.toml`). Em Workers,
bindings (KV, R2, D1, etc.) são declarados no `wrangler.jsonc` por
ambiente (`env.production.kv_namespaces`, se algum dia o código passar a
ler `env.KV`). Não é mudança de modelo, só de onde mora a declaração —
sai do painel, entra no arquivo versionado (arguavelmente uma melhoria:
o binding passa a ser revisável em PR).

### P7. Cache incremental (R2)

Não é migração NECESSÁRIA hoje (a maioria das rotas dinâmicas do projeto é
`ƒ` server-rendered on demand, sem `revalidate` — ver saída de `next
build` nesta mesma avaliação). Se alguma rota futura passar a usar ISR,
`@opennextjs/cloudflare` precisa de um bucket R2 configurado em
`open-next.config.ts` (`incrementalCache`) — custo de infra novo, não
incluído neste levantamento por não ser bloqueante da migração em si.

### P8. Corte de produção (DNS) — a parte que não dá pra fazer incremental

Diferente dos itens acima (que são só configuração/CI), o corte de
`queroumacor.com.br` de "serve pelo Pages project" pra "serve pelo
Worker" é uma mudança de ROTEAMENTO DE DOMÍNIO real, com produção ao
vivo. Sequência seria:

1. Publicar o Worker com `env.production` completo sob um endereço
   PRÓPRIO primeiro (subdomínio `*.workers.dev` da conta, ou um domínio
   de teste) — SEM tocar em `queroumacor.com.br`. Pages continua servindo
   produção normalmente, intocado.
2. Smoke test manual (não só `curl`) nas rotas mais sensíveis a diferença
   de runtime: login/signup (Supabase Auth), `/api/whatsapp/webhook`
   (verificação de assinatura, idempotência), `/api/mp-webhook` (mesma
   coisa, HMAC), `/api/checkout`, uma publicação de post com upload de
   mídia, uma leitura de feed com RLS. Cloudflare Workers e Pages Functions
   rodam sobre o mesmo runtime `workerd` por baixo, então a superfície de
   incompatibilidade esperada é BAIXA, mas "esperada baixa" não é
   "provada zero" — daí o smoke test antes do corte.
3. Só depois de (2) confirmado: Cloudflare **Custom Domains** (feature de
   Workers, equivalente ao que Pages já usa pra `queroumacor.com.br`
   hoje) aponta o domínio pro Worker novo, em vez do Pages project.
4. Manter o Pages project VIVO (não deletar) por um período — se algo
   quebrar em produção depois do corte, reverter é reapontar o Custom
   Domain de volta pro Pages project, não é preciso re-deployar nada.

Este item é o motivo pelo qual a seção "Quando re-avaliar" deste ADR diz
"não dá pra fazer incremental com o app em produção rodando em Pages" —
os itens P1-P7 são preparação; P8 é o único passo com produção ao vivo em
risco, e só ele precisa de uma janela dedicada + rollback ensaiado.

### Estimativa de tamanho (não é orçamento formal, é ordem de grandeza)

- P1 (preview) + P4 (secrets por ambiente) + P5 (workflow de produção):
  a maior parte do trabalho de CI/config — múltiplas iterações prováveis
  até o preview funcionar igual ao de hoje (postar URL em PR não é
  built-in, precisa de script).
- P2 (noindex) + P3 (banner) + P6 (KV): pequenos, poucas linhas cada.
- P7 (R2/ISR): zero trabalho SE nenhuma rota nova passar a depender de
  revalidation antes da migração.
- P8 (corte de DNS): pequeno em código, mas é o único passo que exige
  uma JANELA coordenada (não é PR normal revisado com calma) e um
  rollback testado ANTES do corte acontecer, não depois.

Ordem de grandeza honesta: não é um PR de tarde — é um projeto de alguns
dias de trabalho focado (CI + verificação de secrets + corte + rollback
ensaiado), mesmo com o código da aplicação já validado nesta branch sem
nenhuma mudança necessária.

## Consequences

### Positive (se migrar)

- Fecha o CVE do `postcss`/`next` na raiz, não só contendo o vetor
  (como o middleware fez em 2026-09-13 pro CVE anterior).
- Sai de um adapter deprecado e sem manutenção futura pra um mantido
  ativamente pelo time do Next.js + Cloudflare.
- Ganha acesso a features que só o adapter novo suporta bem (cache
  incremental via R2, image optimization binding nativo, etc.) — hoje
  não usados, mas fecham a porta pra usar sem migrar de novo depois.

### Negative (custo de migrar)

- **Não é troca de dependência — é troca de MODELO DE DEPLOY.** Preview
  automático por branch, o jeito atual de gerenciar env vars/secrets, e
  o workflow de dispatch manual todos precisam ser refeitos, testados e
  re-verificados (inclusive o item de segurança já fechado em
  `STAGING.md` sobre secrets não vazarem pro Preview — não dá pra
  presumir que continua verdade no modelo novo sem reconferir).
- Ganha uma dependência nova de infra (R2 bucket pro cache incremental,
  se usado) que não existe hoje.
- `eslint-config-next` precisou subir de `^15.0.0` pra `^16.3.5` junto
  (achado da mesma investigação) — não é do OpenNext em si, mas é parte
  do mesmo pacote de mudanças, e trouxe consigo um ruleset novo e mais
  estrito (`react-hooks` "React Compiler" rules) que sinalizou ~102
  findings em código já existente — nenhum deles corrigido nesta
  investigação (fora de escopo; decisão separada do mantenedor).

## Alternativas consideradas

- **Não migrar, manter `next@15.5.25` + `next-on-pages`**: fecha zero do
  CVE do postcss; aceita o risco residual como já documentado no
  `CLAUDE.md` (dependência de build-time, não roda em produção). Custo
  zero, mas o CVE fica aberto indefinidamente enquanto o adapter não for
  trocado — não há bump de PATCH que resolva isso, é estrutural.
- **Migrar só o `next` sem trocar de adapter**: testado e confirmado
  inviável — `@cloudflare/next-on-pages@1.13.16` (única versão
  publicada, deprecada, sem novo release) trava o peer range em
  `<=15.5.2`; não tem como.

## Quando re-avaliar

- Se o `npm audit` do projeto voltar a marcar `postcss`/`next` como
  CVE ativo depois de algum patch futuro da minor 15.5.x fechar o mesmo
  problema sem precisar de major (verificar antes de assumir que só a
  migração de adapter resolve — reconferir com `npm audit` a cada patch
  do Next).
- Se o mantenedor decidir seguir adiante: próximo passo é orçar tempo
  pra reconstruir `STAGING.md`/preview-por-branch/gerência de secrets no
  modelo Workers, ANTES de qualquer PR real — não dá pra fazer incremental
  com o app em produção rodando em Pages.

## Referências

- `next-app/package.json`, `next-app/wrangler.toml` (estado atual, Pages)
- `next-app/open-next.config.ts`, `next-app/wrangler.jsonc` (config
  mínima criada na branch de avaliação, só pro build local — NÃO
  configuração de deploy real)
- `STAGING.md`, `DEPLOYMENT.md` (docs do modelo atual, não tocados)
- `.github/workflows/deploy.yml` (workflow de dispatch manual, não
  tocado)
- `CLAUDE.md` — entrada "AUDITORIA DE SEGURANÇA CLOUDFLARE (2026-09-13)"
  (histórico do CVE do Next e da decisão de manter `next-on-pages` por
  enquanto) e "AUDITORIA DE SEGURANÇA MOBILE" (mesma trilha, CVE
  contido via middleware antes de ser corrigido na raiz)
- `docs/adr/0003-cloudflare-pages-functions.md` (ADR original da escolha
  de Cloudflare Pages Functions como backend — este ADR 0006 é uma
  possível superseção PARCIAL dele, se a migração for adiante)
