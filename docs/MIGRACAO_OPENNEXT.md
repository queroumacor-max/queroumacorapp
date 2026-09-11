# Next.js 15.5.2 → 15.5.25 e `next-on-pages` → OpenNext: plano e estado

**Escrito na auditoria de segredos de 2026-09-11. Nada aqui foi deployado.**
A branch da auditoria continua em Next 15.5.2 + `@cloudflare/next-on-pages`,
porque a única saída da versão vulnerável exige trocar o alvo de deploy no
Cloudflare (Pages → Workers), e isso é ação externa.

## 1. Por que o Next está preso em 15.5.2

| Fato | Evidência |
|---|---|
| `@cloudflare/next-on-pages` está **deprecado** | `npm view @cloudflare/next-on-pages deprecated` → "Please use the OpenNext adapter instead: https://opennext.js.org/cloudflare" |
| Última versão 1.13.16, peer `next >=14.3.0 && <=15.5.2` | `npm view @cloudflare/next-on-pages peerDependencies` |
| Não existe versão nova que aceite 15.5.x | `npm view … versions`: 1.13.16 é a última |
| `npm install next@15.5.25` com ele instalado dá ERESOLVE | peer range acima; `--force`/`--legacy-peer-deps` estão fora por decisão |
| OpenNext exige `next >=15.5.24 <16 \|\| >=16.3.3` e `wrangler ^4.125` | `npm view @opennextjs/cloudflare peerDependencies` (1.20.6) |

Ou seja: **não há caminho pra 15.5.24+ que mantenha o `next-on-pages`**. O
adapter deprecado é o bloqueio, não uma escolha de pin.

## 2. Advisories que afetam 15.5.2 (npm audit, 2026-09-11)

Arquitetura relevante: App Router + React Server Components; **sem** Server
Actions (`use server` não aparece no repo); middleware só carimba
`x-request-id` (não faz auth); rewrites estáticos; imagens: `next/image`
em 2 arquivos, **sem** `images.*` no config; em `next-on-pages` o worker
não tem `sharp`/`libvips` (`grep sharp .vercel/output/static/_worker.js` = 0)
e `/_next/image` cai no Image Resizing do Cloudflare ou devolve a
imagem original, então AVIF **não é processado** pelo Next; `formats` do
artefato = `['image/webp']`.

| Advisory | Sev. | Corrigido em | Aplicável aqui? | Por quê |
|---|---|---|---|---|
| GHSA-9qr9-h5gf-34mp (CVE-2025-55182) RCE na desserialização do React Flight | **critical** | 15.5.7 | **SIM** | App Router + RSC; a desserialização acontece no servidor (workerd inclusive). RCE em JS no isolate = acesso a `SUPABASE_SERVICE_ROLE_KEY` e todas as envs. Não há workaround. |
| GHSA-h25m-26qc-wcjf, GHSA-mwv6-3258-q52c, GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj DoS via Server Components | high | 15.5.10 / 15.5.8 / 15.5.15 / 15.5.16 | **SIM** | App Router + RSC. |
| GHSA-wfc6-r584-vfw7, GHSA-68g3-v927-f742, GHSA-4633-3j49-mh5q, GHSA-vfv6-92ff-j949 cache poisoning/confusion RSC | moderate/low | 15.5.16 / 15.5.21 | **SIM (parcial)** | Depende do cache na frente (Cloudflare); corrigir por upgrade. |
| GHSA-ggv3-7p47-pfv8 request smuggling em rewrites | moderate | 15.5.13 | provável | Há `rewrites()`; corrigir por upgrade. |
| GHSA-267c-6grr-h53f, GHSA-26hh-7cqf-hhc6, GHSA-492v-c6pp-mqqv, GHSA-36qx-fr4f-26g5 bypass de middleware | high | 15.5.16 / 15.5.18 | **NÃO** | O middleware não autentica nada (só `x-request-id`); toda auth é dentro da rota. |
| GHSA-3g8h-86w9-wvmq redirect de middleware envenenável | low | 15.5.16 | NÃO | Middleware não redireciona. |
| GHSA-p9j2-gv94-2wf4 SSRF em rewrites com host dinâmico | high | 15.5.21 | **NÃO** | Rewrites têm destino fixo (`/api/:path*`, `/portal/index.html`). |
| GHSA-c4j6-fc7j-m34r SSRF via WebSocket upgrade | high | 15.5.16 | **NÃO** | Exige o servidor Node embutido; no workerd não existe. |
| GHSA-m99w-x7hq-7vfj, GHSA-89xv-2m56-2m9x, GHSA-4c39-4ccg-62r3, GHSA-955p-x3mx-jcvp, GHSA-w37m-7fhw-fmv9 (Server Actions) | high/moderate | 15.5.8 – 15.5.21 | **NÃO hoje** | Nenhum `use server` no repo. Vira aplicável no primeiro Server Action. |
| GHSA-2xp9-vwfh-vxw4 RCE no Image Optimization com AVIF | **critical** | 15.5.24 | **NÃO** | Exige `sharp`/`libheif` no servidor; o worker não tem. |
| GHSA-p293-qw3h-jr36 RCE em servidores Windows | critical | 15.5.24 | NÃO | Não é Windows. |
| GHSA-h64f-5h5j-jqjh, GHSA-q8wf-6r8g-63ch, GHSA-9g9p-9gw9-jx7f, GHSA-3x4c-7xq6-9pq8 DoS/disco no Image Optimizer | moderate | 15.5.10 – 15.5.21 | NÃO | Optimizer do Next não roda no worker. |
| GHSA-ffhc-5mcf-pf4q XSS com nonce de CSP | moderate | 15.5.16 | NÃO | CSP usa `'unsafe-inline'`, sem nonce. |
| GHSA-gx5p-jg67-6x7h XSS em `beforeInteractive` | moderate | 15.5.16 | NÃO | Nenhum `next/script` `beforeInteractive`. |
| GHSA-mg66-mrh9-m8jx DoS com Cache Components | high | 15.5.16 | NÃO | Recurso não usado. |

**Conclusão:** há pelo menos UM critical aplicável (RCE React Flight) e
quatro high aplicáveis (DoS RSC). "Não usar Server Actions" e "não ter
sharp" reduzem a superfície, mas não corrigem nada. **Alvo: `next` 15.5.25.**

## 3. O que foi PROVADO localmente (spike em worktree descartável)

Feito num `git worktree` fora da branch, sem `--force`:

1. `npm uninstall @cloudflare/next-on-pages` + `npm install next@15.5.25
   @opennextjs/cloudflare@^1.20 wrangler@^4` resolve sem ERESOLVE.
2. `next build` com 15.5.25 passa depois de remover os **68**
   `export const runtime = 'edge'` (OpenNext roda tudo em Workers com
   `nodejs_compat`; página edge precisa de bundle separado e não é o caminho
   recomendado).
3. `opennextjs-cloudflare build` **falha** enquanto existe o Pages Router
   (`pages/_error.tsx` e `pages/500.tsx`, criados em 09/2026 pro 500 do
   next-on-pages): o bundle de `pages/_error.js` resolve `@sentry/nextjs`
   pela entrada `workerd`/edge, que o tracing do Next não copia →
   `Could not resolve "@sentry/nextjs"` (com Sentry 8.55 e 10.74; a opção
   `useWorkerdCondition:false` não muda o resultado).
4. **Removendo `pages/` (o App Router já tem `error.tsx`/`global-error.tsx`)
   e com `@sentry/nextjs@10` + `instrumentation.ts`, o build COMPLETA:**
   `Worker saved in .open-next/worker.js` / `OpenNext build complete`.
5. O artefato do OpenNext não carrega `.js.map` (0 em `.open-next/assets`).
6. **`wrangler dev` local (workerd) com esse worker:**

   | Rota | Resultado |
   |---|---|
   | `GET /api/health` | 200, `supabase:true`, `x-request-id` presente |
   | `GET /login` | 200 `text/html`, CSP e HSTS do `next.config` aplicados |
   | `POST /api/whatsapp/webhook?token=errado` | 403 (fail-closed) |
   | `POST /api/push-notify` com `x-internal-secret` errado | 503 (sem `PUSH_INTERNAL_SECRET` = desligado, fail-closed) |
   | `POST /api/log-error` | 200 `{"ok":true}` |
   | `POST /api/alice` sem token | 503 (sem service key em produção = fail-closed) |
   | `GET /api/v1/health` (rewrite) | 200 |
   | `GET /portal` (rewrite pra `index.html`) | **307** — o assets binding redireciona pra `/portal/`; conferir no preview que o portal abre e que o `/portal/index.html` continua servido |
   | `GET /_next/static/chunks/<chunk>.js.map` | 404 |

Não foi possível validar aqui: auth, uploads, OAuth callback, webhooks,
push. Todos dependem de Supabase/Meta/FCM, e a rede do container só
libera GitHub/npm/Anthropic. **Isso só se valida num preview de Workers.**

## 4. Plano de migração (ordem)

### Código (na branch, sem deploy)

1. `package.json`: `next` **15.5.25** exato; remover
   `@cloudflare/next-on-pages`; adicionar `@opennextjs/cloudflare` ^1.20 e
   `wrangler` ^4.125; `@sentry/nextjs` → ^10 (o v8 tem high no `npm audit`
   e é o que trava o bundle).
2. Remover os 68 `export const runtime = 'edge'` (script:
   `grep -rlE "^export const runtime = ['\"]edge['\"];?$" app pages | xargs sed -i -E "/^export const runtime = ['\"]edge['\"];?$/d"`).
   `__tests__` não dependem dessa linha. **Remover `pages/`** (`_error.tsx`,
   `500.tsx`): eram o override da 500 do next-on-pages; no OpenNext o
   App Router (`error.tsx`/`global-error.tsx`) cobre, e o Pages Router é o
   que quebra o bundle com o Sentry.
3. `lib/api/env.ts`: hoje lê o symbol `__cloudflare-request-context__`
   (só existe no next-on-pages). No OpenNext usar
   `getCloudflareContext()` de `@opennextjs/cloudflare` — `env` pra
   variáveis/segredos e `ctx.waitUntil` pro `runAfterResponse`. Manter o
   fallback `process.env` (vitest/build). `app/api/cidades/route.ts` idem.
4. Sentry: `instrumentation.ts` com `register()` importando
   `sentry.server.config` / `sentry.edge.config` por `NEXT_RUNTIME`, e
   `onRequestError = Sentry.captureRequestError`. Manter
   `sourcemaps.deleteSourcemapsAfterUpload: true`.
5. `open-next.config.ts` + `wrangler.jsonc` (main `.open-next/worker.js`,
   `nodejs_compat`, `assets` binding). Apagar `wrangler.toml` do
   next-on-pages. Scripts: `build:cf` → `opennextjs-cloudflare build`,
   `preview` → `opennextjs-cloudflare preview`, `deploy` →
   `opennextjs-cloudflare deploy`.
6. `.github/workflows/deploy.yml`: trocar `npx @cloudflare/next-on-pages@1`
   + `wrangler pages deploy` por `opennextjs-cloudflare deploy` (Workers).
7. `next.config.mjs`: `headers()` continua valendo (OpenNext os aplica).
   `public/_headers` deixa de ter efeito em Workers com assets binding —
   conferir CSP com `curl -I` depois do primeiro preview.
8. Revisar `CLAUDE.md`/`DEPLOY.md`: tudo que cita `_worker.js`,
   `.vercel/output`, `pages_build_output_dir`.

### Cloudflare (MANUAL — fora do repo)

1. Criar o **Worker** `queroumacor-next` (ou converter o projeto Pages) e
   apontar o domínio `www.queroumacor.com.br` pra ele; manter o Pages até
   o corte.
2. Copiar TODOS os secrets do Pages (Production) pro Worker: `wrangler
   secret put` um a um, ou pelo painel. Lista em `next-app/.env.example`.
3. Recriar o binding KV `KV` (cidades IBGE), se ainda for usado.
4. `NEXT_PUBLIC_*`: vão em `[vars]`/`vars` do `wrangler.jsonc` (são
   públicas) e precisam estar no ambiente de BUILD.
5. Preview em `*.workers.dev` primeiro; rodar o checklist abaixo; só então
   trocar o DNS.
6. Depois do corte: apagar o projeto Pages (ou deixar como rollback por uma
   semana).

### Checklist de validação no preview (o que o container não consegue)

- [ ] `/api/health` → `supabase:true`, `build` novo.
- [ ] Login por e-mail e por Google/Apple (deep link da casca).
- [ ] Publicar foto (upload → bucket `posts`) e trocar avatar.
- [ ] `/api/whatsapp/webhook` GET (verify token) e POST com `?token=` errado → 401.
- [ ] `/api/push-notify` com `x-internal-secret` errado → 401.
- [ ] `/api/mp-webhook` sem assinatura → recusado.
- [ ] Rota de IA (Alice) com usuário PRO → resposta; sem token → 401.
- [ ] `/portal` carrega (rewrite) e `/api/admin/users` com admin.
- [ ] `curl -I` da home: CSP, HSTS, `x-request-id` presentes.
- [ ] `curl https://…/_next/static/chunks/<x>.js.map` → 404.
- [ ] Sentry recebe evento com `request.url` sem `?token=`.

## 5. Riscos

- **Edge → Node runtime:** as 68 rotas passam a rodar no runtime Node do
  Workers. Código que dependia de `Symbol.for('__cloudflare-request-context__')`
  ou de `ctx.waitUntil` via esse symbol muda de forma (item 3 acima).
- **Sentry:** major 8 → 10 (mudanças de API no `withSentryConfig` e no init).
- **Headers/CSP:** `public/_headers` deixa de valer; validar em preview.
- **Deploy é outro produto** (Workers): custos, limites de CPU e o
  workflow do GitHub mudam. Rollback = manter o Pages vivo até o corte.
- **Enquanto isso não acontece, produção segue em Next 15.5.2 com RCE
  aplicável.** Mitigação possível hoje (não implementada, decisão do
  usuário): regra de WAF no Cloudflare bloqueando `POST` com header
  `Next-Action` (o app não tem Server Actions) e limitando corpo/taxa nas
  rotas RSC — reduz o vetor do React Flight, não elimina.

## 6. Resumo do spike

Sequência que chegou a um worker funcional (tudo em worktree descartável,
nada commitado): `next@15.5.25` + `@opennextjs/cloudflare@1.20.6` +
`wrangler@4` + `@sentry/nextjs@10` → remover 68 `runtime='edge'` → remover
`pages/` → `instrumentation.ts` → `open-next.config.ts` mínimo +
`wrangler.jsonc` (`nodejs_compat`, assets binding) → `opennextjs-cloudflare
build` OK → `wrangler dev` responde (tabela acima). Passo 2 do plano
precisa incluir a remoção de `pages/` e o passo 4 o `onRequestError`.
