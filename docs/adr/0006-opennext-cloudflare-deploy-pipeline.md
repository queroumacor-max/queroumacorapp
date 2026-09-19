# ADR 0006 — Migração @cloudflare/next-on-pages → @opennextjs/cloudflare (deploy pipeline)

- **Status**: Proposed — investigação/documentação feita em branch de
  avaliação isolada (`claude/next16-opennext-eval`, nunca empurrada,
  nenhum PR aberto). Este ADR documenta o TAMANHO da mudança pro
  mantenedor decidir; não implementa nada em `main`, `STAGING.md`,
  `DEPLOYMENT.md` nem em qualquer config real de produção.
- **Date**: 2026-09-18 (revisão do mesmo dia: P1 e P4 corrigidos/
  aprofundados depois de consultar a documentação viva da Cloudflare —
  ver nota no início de cada seção revisada. Artefatos prontos pra
  execução — `wrangler.jsonc` completo, YAML do workflow de produção,
  runbook de corte de DNS — em
  `docs/adr/0006-workers-migration-artifacts.md`, mesmo status Proposed,
  nada executado.)
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
  de graça, sem configurar nada. **Atualizado em 2026-09-18** (ver P1 mais
  abaixo, revisado depois de consultar a doc oficial): Cloudflare Workers
  TEM um recurso equivalente — **Workers Builds**, com "non-production
  branch builds" — que gera preview URL por branch e comenta no PR
  automaticamente, do mesmo jeito que o Pages faz hoje. Não é "sem
  configurar nada" (precisa ligar o toggle e configurar os triggers uma
  vez), mas é zero-código, sem workflow de CI bespoke.
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
  presumida como igual. **Atualizado em 2026-09-18** (ver P4 mais abaixo):
  além de ser outro painel, Workers separa vars de BUILD-TIME de vars de
  RUNTIME em duas superfícies distintas — Pages usava uma só pras duas
  coisas. Isso não é só "outro lugar pra mesma config", é uma superfície
  a mais pra manter sincronizada.
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

**Revisado em 2026-09-18 depois de consultar a documentação viva da
Cloudflare (`search_cloudflare_documentation`) — a 1ª versão desta seção
(que propunha um workflow de GitHub Actions bespoke rodando `wrangler
versions upload` + postando o link via `actions/github-script`) estava
descrevendo um mecanismo mais trabalhoso do que o que existe hoje. Achado
central: Cloudflare tem um produto próprio, **Workers Builds**
(`/workers/ci-cd/builds/`), que é o equivalente direto do Git integration
que o Pages já usa — não precisa ser reconstruído em CI nosso.**

Como funciona, verificado na doc oficial:

- Conectar o repositório (dashboard, **Workers & Pages → o Worker →
  Settings → Builds**, mesmo tipo de fluxo que Pages usa hoje) liga
  **build automático em todo push na branch de produção** (`main`,
  configurável em Settings → Build → Branch control).
- Ligando **"non-production branch builds"** (mesma tela), TODO push em
  QUALQUER outra branch dispara build + `wrangler versions upload`
  automaticamente — **com `--env preview` explícito** (correção de
  2026-09-18, achado do Codex na revisão automática da PR #340: Workers
  Environments NÃO herdam config e o comando sem `--env` cai no Worker
  raiz, que não é nem produção nem preview — ver detalhe completo em
  `docs/adr/0006-workers-migration-artifacts.md` seções 1 e 3). O deploy
  command de produção correspondente é `wrangler deploy --env production`.
- Cada versão ganha, automaticamente, **duas Preview URLs**: uma por
  commit (`<version-prefix>-<worker-name>.<subdomínio>.workers.dev`) e
  uma por BRANCH, estável entre commits (`<branch-name>-<worker-name>
  .<subdomínio>.workers.dev`). Como o `--env preview` publica no Worker
  **`queroumacor-next-preview`** (não `queroumacor-next` — nome com
  sufixo, mesma correção acima), o exemplo real seria
  `claude-postcss-cve-override-queroumacor-next-preview.<subdomínio>
  .workers.dev`. A de branch é a equivalente direta da URL
  `<branch-slug>.queroumacorapp.pages.dev` que o Pages dá hoje.
- **As duas URLs são postadas automaticamente como comentário no PR**
  (mesmo texto da doc: "just like they are in Cloudflare Pages") — sem
  precisar escrever `actions/github-script` nem nenhum passo de CI
  próprio pra isso.
- Retry de build com falha direto pelo GitHub (Check Run → "Rerun"), sem
  precisar voltar pro dashboard — mesmo fluxo que Pages já tem hoje.

**O que isso muda no desenho:** P1 deixa de precisar de um novo
`.github/workflows/preview-deploy.yml` — a automação inteira é
CONFIGURAÇÃO DE PAINEL (ou via API, ver
`docs/adr/0006-workers-migration-artifacts.md`), não um workflow YAML
novo pra manter. O `.github/workflows/deploy.yml` (P5) continua existindo
só como o caminho de dispatch MANUAL/backup, exatamente como hoje —
Workers Builds cobre o automático.

**Limite documentado a registrar**: Preview URLs não são geradas pra
Workers que usam Durable Objects/Containers/Sandbox — não é o caso deste
projeto (sem DO em uso), mas fica registrado caso algum dia mude.

**Ainda não muda sozinho**: o BANNER "🧪 STAGING" (P3) segue precisando do
hostname certo pra detectar preview (agora `*.workers.dev`, formato mais
feio e mais longo que `*.pages.dev`); e a fronteira de secrets (P4) precisa
ser configurada explicitamente nesse novo painel — Workers Builds não
herda nada do painel de Pages automaticamente.

Nada disso substitui `STAGING.md` — o documento inteiro precisaria ser
reescrito descrevendo este fluxo novo (o comando `wrangler versions
upload` continua disponível pra rodar manualmente/localmente também, sem
esperar o CI, útil pra depurar um build antes de fazer push).

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

**Revisado em 2026-09-18 depois de consultar a documentação viva da
Cloudflare — achado que muda o desenho, não só o mecanismo:
"Unlike Pages, Workers does not share the same set of runtime and
build-time variables"** (texto literal do guia de migração Pages→Workers
da própria Cloudflare). Isto é DIFERENTE do modelo mental que a 1ª versão
desta seção assumia (que `wrangler.jsonc env.*.vars` + secrets bastariam
sozinhos). Em Workers/Workers Builds existem **DUAS superfícies
separadas**, cada uma configurada à parte:

1. **Build Variables and Secrets** (Workers Builds → Settings → Build →
   "Build Variables and Secrets", POR TRIGGER — produção e preview têm
   cada uma a sua): só disponíveis durante o `npm run build`/`next
   build`, NUNCA em runtime. É aqui que precisam ir as
   `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` — o
   `next.config.mjs` as INLINA no bundle do cliente durante o build,
   exatamente como o step "Build Next.js" de `.github/workflows/
   deploy.yml` já faz hoje passando `env:` pro `npm run build`.
2. **Runtime Variables & Secrets** (Worker → Settings → "Variables &
   Secrets", ou `env.<ambiente>.vars`/`wrangler secret put --env
   <ambiente>` no `wrangler.jsonc`/CLI): disponíveis em `env` dentro do
   handler do Worker — é daqui que `getRuntimeEnv()`
   (`next-app/lib/api/env.ts`) lê tudo (Supabase service role, chaves de
   IA/MP/WhatsApp/FCM etc.), do MESMO jeito que lê hoje do painel do
   Pages.

**Consequência prática**: qualquer var que o app precisa TANTO no build
(pra inlinar no client bundle) QUANTO em runtime (se algum código do
servidor também ler `NEXT_PUBLIC_SUPABASE_URL` via `getRuntimeEnv`, o que
`resolveSupabaseEnv()` já faz como fallback) precisa estar cadastrada NAS
DUAS superfícies, não numa só — errar isso não dá erro na hora, dá bundle
built certo mas rota de servidor quebrada silenciosamente (ou o
contrário), porque as duas fontes nunca se misturam.

Desenho proposto, mapeando pro roster de env vars REALMENTE lidas hoje
(levantado por grep de `getRuntimeEnv('NOME')` em `app/` e `lib/` — lista
completa e o `wrangler.jsonc` anotado em
`docs/adr/0006-workers-migration-artifacts.md`, não repetida aqui):

- **Build Variables and Secrets**, trigger de produção: as MESMAS 2 vars
  que `deploy.yml` já passa hoje pro `next build`
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — nada
  novo, só migra de superfície (GitHub Secrets → painel Workers Builds).
- **Build Variables and Secrets**, trigger de preview: MESMAS 2, mesmos
  valores públicos (não há razão pra ter um Supabase de preview
  diferente hoje — não existe um ambiente de banco separado).
- **Runtime Variables & Secrets**, ambiente `production`: TODO o roster
  de runtime hoje configurado no painel do Pages (Supabase service role,
  OpenAI/Gemini, Mercado Pago, Dualhook/WhatsApp, FCM, VAPID, admin
  emails etc. — grep completo no companion doc), migrados um a um.
- **Runtime Variables & Secrets**, ambiente `preview`: só as MESMAS 5
  vars públicas que Preview tem hoje no Pages (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`,
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`) — ZERO secret de
  produção. É esta lista, e só ela, que precisa ser reconferida linha a
  linha contra o painel novo antes de considerar a fronteira fechada.
- O workflow de produção manual (substituto do `deploy.yml` atual, P5)
  continua usando `wrangler deploy` (sem `--env`, ou `--env production`
  se o nome do ambiente for explícito) e continua restrito a `main`
  (mesmo guard `if: github.ref == 'refs/heads/main'` que existe hoje, ver
  `.github/workflows/deploy.yml:23`). O caminho automático de preview (P1,
  Workers Builds) nunca toca no ambiente `production` — ele só existe
  como trigger separado, com o seu próprio conjunto de Build/Runtime
  vars restrito.
- **Diferença importante de superfície, mantida da versão anterior desta
  seção**: hoje a separação Production/Preview do Pages é um recurso do
  PAINEL — alguém com acesso ao painel mas sem acesso ao repo não
  consegue misturar os dois sem querer, porque a UI já separa as duas
  abas. Em Workers, a separação vira **configuração explícita por
  trigger/ambiente** (dois lugares na UI do Workers Builds + o bloco
  `env.*` do `wrangler.jsonc`) — mais superfícies pra errar do que o
  painel único do Pages, então checar as DUAS (build e runtime) em cada
  ambiente, não só uma.
- Reconferir esta fronteira (nenhum secret de produção acessível a partir
  do trigger/ambiente de preview, nas duas superfícies) com o MESMO rigor
  que `STAGING.md` documenta pro modelo atual — não presumir que "copiei
  a lista de 5 vars, tá igual".

### P5. `.github/workflows/deploy.yml` (produção)

Reescrita direta, sem ambiguidade de mecanismo (ao contrário do preview).
Trecho ilustrativo abaixo; **arquivo completo, com o SHA pinado real da
action já preenchido, em `docs/adr/0006-workers-migration-artifacts.md`
seção 4**:

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
vivo. Sequência resumida abaixo — **runbook completo, com comandos
exatos, checklist de smoke test e passo a passo de rollback, em
`docs/adr/0006-workers-migration-artifacts.md`** (não repetido aqui pra
não ter duas cópias divergentes do mesmo procedimento):

1. Publicar o Worker com `env.production` completo sob um endereço
   PRÓPRIO primeiro (subdomínio `*.workers.dev` da conta) — SEM tocar em
   `queroumacor.com.br`. Pages continua servindo produção normalmente,
   intocado.
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
   **Detalhe verificado na doc oficial que a 1ª versão desta seção não
   registrava**: um Custom Domain NÃO pode ser criado "por cima" de um
   hostname que já tem registro DNS do tipo CNAME — o Custom Domain do
   Pages já criou esse CNAME pra `queroumacor.com.br`. Ou seja, o corte
   não é "adicionar o novo e depois remover o velho": é **remover o
   Custom Domain do Pages project primeiro** (isso apaga o CNAME dele) e
   SÓ ENTÃO adicionar o Custom Domain no Worker novo — há uma janela real,
   por mais curta que seja, entre os dois passos onde o domínio pode não
   resolver pra nenhum dos dois. Runbook detalha como minimizar essa
   janela.
4. Manter o Pages project VIVO (não deletar) por um período — se algo
   quebrar em produção depois do corte, reverter é reapontar o Custom
   Domain de volta pro Pages project (mesma ressalva do CNAME do passo
   3, na direção contrária), não é preciso re-deployar nada. Pra um
   rollback mais rápido ainda ANTES de mexer em DNS — algo quebrado no
   Worker mas o corte de domínio ainda não aconteceu — `wrangler
   rollback` reverte o Worker pra uma versão anterior sem precisar tocar
   em domínio nenhum.

Este item é o motivo pelo qual a seção "Quando re-avaliar" deste ADR diz
"não dá pra fazer incremental com o app em produção rodando em Pages" —
os itens P1-P7 são preparação; P8 é o único passo com produção ao vivo em
risco, e só ele precisa de uma janela dedicada + rollback ensaiado.

### Estimativa de tamanho (não é orçamento formal, é ordem de grandeza)

- P1 (preview) + P4 (secrets por ambiente) + P5 (workflow de produção):
  a maior parte do trabalho de CI/config — mais leve do que a 1ª versão
  desta estimativa presumia (P1 é configuração de painel/API do Workers
  Builds, não um workflow de CI novo pra manter — ver revisão de
  2026-09-18 na seção P1), mas P4 continua tendo DUAS superfícies de env
  var pra preencher e reconferir (build-time e runtime, por ambiente) em
  vez de uma.
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

- `docs/adr/0006-workers-migration-artifacts.md` — artefatos prontos pra
  execução (`wrangler.jsonc` completo com `env.production`/`env.preview`,
  roster de env vars levantado por grep do código real, configuração do
  trigger de Workers Builds, `.github/workflows/deploy.yml` reescrito,
  runbook de corte de DNS P8 com comandos exatos e rollback). Mesmo
  status Proposed deste ADR — nada executado, nada em produção.
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
