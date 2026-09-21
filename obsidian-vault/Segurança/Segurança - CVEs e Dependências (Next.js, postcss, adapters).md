---
tags: [segurança, cve, dependências, nextjs, postcss]
---

# CVEs e Dependências — Next.js, postcss, adapters

Esta nota reúne o histórico dos CVEs de dependências de produção fechados no projeto, separado das auditorias temáticas porque cada um foi tratado numa investigação própria, muitas vezes travada pela dependência do adapter de deploy (`@cloudflare/next-on-pages`, deprecado).

## Next.js 15.5.2 — 3 CVEs CRITICAL (Cloudflare, 2026-09-13)
Achado pela [[Segurança - Cloudflare|auditoria de segurança Cloudflare]]: RCE via React Flight protocol, exposição de código-fonte de Server Actions, DoS. A versão estava fixada em `15.5.2` porque `@cloudflare/next-on-pages@1.13.16` (deprecado, nunca mais atualizado) declara peer `next: "<=15.5.2"`, e o `npm install` interno do `vercel build` (rodado pelo próprio next-on-pages) falha com ERESOLVE em qualquer patch acima disso.

**Fix**: `next` → `15.5.25` (último patch da MESMA minor, sem mudança de API) + `next-app/.npmrc` com `legacy-peer-deps=true` (só isso destrava o `npm install` do adapter; não afeta a resolução de mais nada). Build real testado ponta a ponta (`npm run build:cf` completo, `wrangler pages dev` servindo o artefato) — funciona.

**Regra registrada**: essa trava de peer dep é conhecida e esperada — não é motivo pra reverter um bump de PATCH do Next; só minor/major exige rever o adapter primeiro. A regra antiga "next pinado EXATO em 15.5.2, não subir sem subir next-on-pages junto" ficou PARCIALMENTE SUPERADA: dentro da minor 15.5.x, pode subir à vontade (rodando `npm run build:cf` antes de confiar).

`tar` e `vitest` seguem com CVE CRITICAL sem fix disponível sem major breaking — os dois são só devDependency/build-time do adapter, não rodam em produção; aceito como risco residual baixo.

## CVE-2025-66478 / CVE-2025-55182 (RCE via header `Next-Action`)
Achado pela [[Segurança - Mobile (Capacitor Android iOS)|auditoria de segurança mobile]] (2026-09-13/15): RCE, CVSS 10.0, desserialização do protocolo Flight via header `Next-Action`. Nesta sessão a versão do Next estava presa em `15.5.2` pelo mesmo teto de peer range acima (`>=14.3.0 && <=15.5.2`).

**Mitigação aplicada nesta sessão (fica como defesa em profundidade)**: `next-app/middleware.ts` barra qualquer requisição com o header `Next-Action` com 404 antes de qualquer processamento (seguro porque o app não declara NENHUMA Server Action — zero `'use server'` no repo). Matcher ampliado de `/api/:path*` pra todas as rotas de página (Actions são invocadas na própria URL da página).

**Fechado na raiz** pela auditoria Cloudflare em paralelo (mesmo dia): `next` → `15.5.25`, acima do patch que corrige o CVE (15.5.3+, conforme o comentário do próprio `.npmrc`) — a causa raiz está fechada em produção, não só contida. A migração de adapter (OpenNext-Cloudflare) segue como melhoria arquitetural de médio prazo, não mais bloqueante de segurança.

## CVE do postcss fechado sem esperar migração de adapter (PR #339, 2026-09-18)
Investigação separada, parte do encadeamento de 3 PRs (#337/#339/#340) descrito também em [[Infraestrutura - Cloudflare, Env Vars e Deploy]] (o plano de migração pros Workers, que NÃO é escopo desta nota de segurança). `npm audit --json` mostrava `next` vulnerável só via `postcss` (4 advisories — GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849, faixa combinada `<=8.5.22`), com `fixAvailable` apontando só pro `next@16.3.5`.

O `postcss` vulnerável existia numa ÚNICA cópia privada e isolada (`node_modules/next/node_modules/postcss@8.4.31`, pinada em versão EXATA pelo próprio `package.json` do `next`). O `postcss` de nível superior do projeto (`@tailwindcss/postcss`, `vite`, `autoprefixer`) já estava em `8.5.26`, acima da faixa vulnerável, só nunca deduplicava contra a cópia do `next` por causa do pin exato.

**Fix** (commit `cd02b88`): `overrides` escopado em `next-app/package.json` (`{"next":{"postcss":"$postcss"}}`, sintaxe `$postcss` do npm apontando sempre pro `postcss` já resolvido no topo) — sem bump de major do `next`, sem trocar de adapter. Diff do lockfile cirúrgico (26 linhas removidas, a entrada nested), provado isolado comparando contra uma regeneração completa do lockfile (que traria dezenas de bumps não relacionados — não foi isso que foi commitado). `npm audit` confirma: `postcss`/`next` somem, resto do relatório (capacitor/cli, next-on-pages, vitest/mocker, cookie, esbuild, miniflare, sharp, tar, undici, vite, vite-node, ws) idêntico, achados pré-existentes não tocados.

**Contexto: por que não foi resolvido só subindo o Next para 16** — PR #337 (`d598194`), branch `claude/next16-opennext-eval`, provou que `next@16.3.5` + `@opennextjs/cloudflare@1.20.6` builda limpo e fecha o CVE — mas o adapter atual (`@cloudflare/next-on-pages`, deprecado) trava o peer range em `next<=15.5.2`, então migrar de verdade exigiria trocar de adapter TAMBÉM, mudando o MODELO DE DEPLOY (Cloudflare Pages → Workers). Essa troca foi **revertida de propósito** nesta PR (o usuário pediu confirmação do risco real antes de mergear — lendo o código-fonte do Wrangler instalado, achou-se que a PR tinha criado um `wrangler.jsonc` novo coexistindo com o `wrangler.toml` existente, e Wrangler resolve `wrangler.json > wrangler.jsonc > wrangler.toml`, o que quebraria o próximo deploy automático de produção via Pages). Reverteu-se `package.json`, `package-lock.json`, `.npmrc`, `wrangler.jsonc`, `open-next.config.ts`, `eslint.config.mjs` de volta ao estado de `main`, mantendo só 102 achados de lint corrigidos e o **ADR 0006** (`docs/adr/0006-opennext-cloudflare-deploy-pipeline.md`), status `Proposed`. A execução completa dessa migração (P1-P8, PR #340) é acompanhada em [[Infraestrutura - Cloudflare, Env Vars e Deploy]] — não é escopo de segurança em si, já que o CVE que motivava a pressa foi fechado por este PR #339 sem depender dela.

## jspdf 2 → 4.2.1 (CVE CRITICAL eliminada, 2026-09-03)
Da rodada "P0 da auditoria de arquitetura" (item C6): `jspdf` atualizado de v2 para `4.2.1`, eliminando uma vulnerabilidade CRITICAL. Junto, `next` foi então pinado EXATO em `15.5.2` (teto do peer range do `@cloudflare/next-on-pages` — não subir sem subir o next-on-pages junto; caret ali quebrava o `npm ci`). Na época, as ~26 vulns restantes do `npm audit` eram consideradas upstream (advisory do `next` cobrindo todas as versões; `postcss`/`sharp` vendored dele; resto só fecharia com Sentry major 10) — esse estado foi reavaliado e progressivamente fechado pelas auditorias posteriores acima.

## sharp 0.34.5 → 0.35.4 (CVE HIGH, PR CI/CD 2026-09-16)
Fechado via `npm audit fix` não-forçado como parte da [[Segurança - Auditoria CI-CD|auditoria de segurança da pipeline CI/CD]] — fecha a única CVE HIGH de dependência de produção com fix não-breaking à época. Validado com `npm ci` limpo + suíte completa (169 arquivos/2160 testes) + typecheck + lint + `next build`.

## Cadeia `wrangler` → `sharp@0.33.5`/`undici`/`ws` com CVE HIGH
Achado residual reafirmado pela auditoria Bloco 21 (2026-09-18): mesma classe já aceita pra `tar`/`vitest` (dev-only, não embarca no artefato). Dependências de PRODUÇÃO confirmadas em **0 vulnerabilidades** (`npm audit --omit=dev`). Ver [[Segurança - Auditoria Final (Bloco 21, OWASP ASVS, Release Gate)]].

---
## Ver também
[[Segurança - Cloudflare]] · [[Segurança - Mobile (Capacitor Android iOS)]] · [[Segurança - Auditoria CI-CD]] · [[Segurança - Auditoria Final (Bloco 21, OWASP ASVS, Release Gate)]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]]
