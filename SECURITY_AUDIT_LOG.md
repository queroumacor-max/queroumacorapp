# Security Audit Log

## ✅ Sessão 25/05/2026 — Hardening Externo

### Item 4 — Google Search Console (CONCLUÍDO)

- Meta tag de verificação adicionada no `index.html` (commit `194771f`)
- DNS TXT record adicionado no Cloudflare: `google-site-verification=26FCGCEtRW_BoP4DjZXXq_OWmAUGfPxaOt_OL0_Nyhw`
- Propriedade `queroumacor.com.br` verificada via DNS (Domain property — cobre www + subdomínios + http/https)
- Sitemap submetido: `https://www.queroumacor.com.br/sitemap.xml`
- Regra Cloudflare criada (posição 1): "Permitir bots de busca verificados (Google, Bing)"
  - Expressão: `(cf.verified_bot_category in {"Search Engine Crawler" "Search Engine Optimization"})`
  - Ação: Skip → All Super Bot Fight Mode Rules
  - Garante que Googlebot/Bingbot não sejam bloqueados pelo Bot Fight Mode

### Item 5 — HSTS + TLS (CONCLUÍDO)

- Always Use HTTPS: ON
- HSTS: Max-Age 12 meses, includeSubDomains ON, Preload OFF (aguardar ~6 semanas = ~07/07/2026)
- TLS mínimo: 1.2
- No-Sniff Header: ON
- ⚠️ **LEMBRETE:** em ~07/07/2026, adicionar `preload` no HSTS e submeter em https://hstspreload.org

### Item 6 — SPF/DKIM/DMARC (PARCIAL)

- `queroumacor.com.br`: DMARC ✅ `v=DMARC1; p=reject`
- `calicolors.com.br`: SPF ✅, DMARC ❌ **PENDENTE**
  - ⚠️ **AÇÃO MANUAL:** Logar no GoDaddy DNS e adicionar TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:dpo@calicolors.com.br`

### Item 7 — Sentry/PostHog

- ⏳ Aguardando decisão do usuário sobre vendor

### Cloudflare Security Rules (estado final)

5/5 custom rules em uso:

1. Permitir bots de busca verificados (Google, Bing) — Skip Bot Fight Mode
2. Challenge países de alto risco
3. Bloquear bots conhecidos e scrapers
4. Bloquear admin paths suspeitos
5. Challenge portal para IPs fora do BR/US/PT

## 🔒 Sessão 13-15/09/2026 — Auditoria Completa Cloudflare (132 seções)

Branch `claude/cloudflare-security-audit-gurtsy`, pedido explícito do usuário.
Cobriu DNS, TLS, WAF, Workers/Pages, cache, secrets, CI/CD e o artefato REAL
do build (não só `.next`). Relatório completo das 132 seções foi entregue no
chat da sessão; aqui fica o resumo operacional — o que mudou, o que ficou
confirmado por evidência e o que ainda depende do Dashboard.

### Corrigido no código (commits `4abcea8` + `3956760`)

- **CRITICAL**: `next` 15.5.2 → **15.5.25** (mesma minor) — 3 CVEs CRITICAL
  (RCE via React Flight protocol, exposição de código-fonte de Server
  Actions, DoS). O `@cloudflare/next-on-pages@1.13.16` (deprecado) trava o
  peer range em `<=15.5.2`; `next-app/.npmrc` com `legacy-peer-deps=true`
  destrava só isso. Build `npm run build:cf` reproduzido do zero com
  sucesso.
- **HIGH**: 157 source maps do bundle client-side ficavam PÚBLICOS no
  artefato de produção — sem `SENTRY_AUTH_TOKEN` no ambiente de build, o
  plugin do Sentry pula o upload E o apagamento dos `.map`. Novo
  `next-app/scripts/strip-source-maps.mjs`, plugado no `build:cf`, apaga
  todo `.map` do artefato final independente do token existir.
- **HIGH**: `deploy.yml` (workflow_dispatch) podia publicar PRODUÇÃO a
  partir de qualquer branch — `wrangler pages deploy --branch=main` é
  fixo, mas o dispatch deixava escolher a ref livremente. Corrigido com
  `if: github.ref == 'refs/heads/main'`.
- **MEDIUM**: chave Gemini ia na query string (`?key=...`) em 8 pontos —
  movida pro header `x-goog-api-key` (URL de requisição vaza fácil pra
  log/Sentry/proxy).
- **MEDIUM**: chave Gemini **vazada no histórico do Git** (arquivo
  `queroumacorportal.html`, commit `a735531`, 2026-03-23, removido 17min
  depois mas recuperável via `git show`) — **ROTACIONAR `GEMINI_API_KEY`**
  no Google AI Studio/GCP + trocar no Cloudflare Pages.
- Webhook Evolution (legado): comparação de token `!==` → `safeEqual`
  (tempo constante). `ios-screenshots.yml` ganhou `permissions:` mínimo.
  `next-app/` entrou no `dependabot.yml` (só cobria o `package.json` da
  raiz antes).

### Confirmado por evidência real (curl via `wrangler pages dev` contra o
### artefato publicado, não suposição)

- CSP/HSTS/COOP/CORP/Permissions-Policy aplicados corretamente em
  `/login`, `/portal` e rotas prerenderizadas — a fonte única é o
  `headers()` do `next-app/next.config.mjs` (C2 da auditoria de
  2026-08-26 está de fato fechado).
- Artefato final pós-fix: **0** `.map`, **0** `.env*`, **0** `service_role`
  key vazada (só a `anon` key, pública por design).
- `_headers`/`_redirects` da RAIZ do repo (fora de `next-app/`) são
  **INERTES** — Cloudflare Pages só lê esses arquivos de DENTRO do build
  output (`next-app/.vercel/output/static`). Banner de aviso adicionado
  nos dois pra não confundir sessão futura.

### Cruzamento com o registro de 25/05/2026 acima — corrige um veredito

O relatório desta auditoria tinha marcado "Bot protection: FAIL" olhando
só a ausência de Turnstile no `next-app` (confirmado: o widget saiu na
migração vanilla→Next, só a CSP ainda permite `challenges.cloudflare.com`
por precaução). **Isso ignorava o que já está registrado ACIMA neste
mesmo arquivo**: 5 custom rules no Cloudflare desde 25/05, incluindo
"Bloquear bots conhecidos e scrapers" e "Challenge portal para IPs fora
do BR/US/PT" — proteção de bot EXISTE na camada Cloudflare (edge), só não
tem uma segunda camada no nível de APLICAÇÃO (login/signup do app não
pedem nenhum challenge). Veredito correto: proteção de borda presente,
proteção de aplicação ausente — não "nenhuma proteção".
**Não reverificado nesta sessão se as 5 regras de 25/05 ainda estão
ativas** — ver item 5 abaixo.

### MANUAL ACTION REQUIRED (Cloudflare Dashboard — nada disso é
### verificável/corrigível a partir do repo)

1. **[PRIORIDADE MÁXIMA]** Confirmar se as env vars de **Preview** no
   Cloudflare Pages são as MESMAS de produção. Se forem, qualquer push em
   qualquer branch expõe `SUPABASE_SERVICE_ROLE_KEY`/chaves de IA/
   pagamento/WhatsApp a um build malicioso (supply-chain via
   `postinstall`). Ver aviso completo em `STAGING.md`.
2. **Rotacionar `GEMINI_API_KEY`** (vazamento histórico, ver acima).
3. Confirmar `SENTRY_AUTH_TOKEN` está de fato no Build Command real do CF
   Pages Dashboard (não só no GitHub Actions, já corrigido).
4. `DMARC` de `calicolors.com.br` — **segue pendente desde 25/05/2026**,
   ninguém rodou o TXT no GoDaddy ainda.
5. Reconferir se as 5 custom rules do WAF (seção acima) ainda existem e
   fazem sentido — não verificado nesta sessão.
6. Confirmar SSL/TLS mode = Full (Strict), TLS mínimo/1.3, DNSSEC, CAA.
7. Confirmar escopo do `CLOUDFLARE_API_TOKEN` do deploy (deveria ser só
   `Pages:Edit`).
8. Considerar Cloudflare Access na frente de `*.pages.dev`.
9. Considerar Bot Fight Mode/Managed Challenge (ou Turnstile com
   validação server-side real) especificamente em `/login` e `/signup`
   do app — hoje sem camada de aplicação.

### Testes

2096/2096 testes verdes (163 arquivos), typecheck limpo, `npm run
build:cf` reproduzido do zero com `npm ci`. Testes novos:
`whatsapp-evo-webhook-auth.test.ts`, `gemini-key-not-in-query-string
.test.ts`, `strip-source-maps.test.ts`.

### Sessão 15/09/2026 (continuação) — itens de código que sobraram, fechados

Dos achados não-Dashboard da sessão anterior, os três acionáveis no repo:

- **`/api/ig-art-diag` virou admin-only de verdade** (`ensurePortalAdmin`
  depois do `gateProAI`, reaproveitando a identidade já validada — sem
  round-trip extra ao GoTrue). O comentário do arquivo sempre disse
  "PRO + admin"; só PRO era checado. Teste novo cobre PRO-mas-não-admin
  → 403; `__tests__/api/_helpers.ts` ganhou suporte a `admin` no
  `installAuthMocks` (default `true`, os outros 17 consumidores do
  helper não mudam de comportamento).
- **Scanner de segredos (gitleaks) entrou no CI.** `.gitleaks.toml` +
  `.gitleaksignore` + `scripts/secret-scan-selftest.sh` recuperados de
  `claude/admiring-turing-20zlkj` (branch nunca mergeada, longe demais de
  `main` pra merge seguro — só esses 3 arquivos, puramente aditivos,
  foram trazidos). Job `gitleaks` novo em `security.yml`, com self-test
  que prova a regra `gcp-api-key` continua detectando (chave sintética →
  FALHA; árvore limpa → PASSA), não só que o job roda.
  **Validado localmente com o binário real (gitleaks 8.21.2) contra os
  1519 commits do histórico inteiro: 0 leaks.** No caminho, um allowlist
  regex frágil foi corrigido: ancorava no HEADER do JWT de exemplo do
  jwt.io, e um segundo fixture de teste no histórico
  (`scrubSecrets.test.ts`) usa o MESMO payload com um header HS256
  diferente — passava batido pelo regex antigo. Trocado pra casar só
  pelo payload (`eyJzdWIiOiIxMjM0NTY3ODkwIn0`), que é o invariante.
  A chave Gemini real (`GEMINI_API_KEY`, item 2 da lista acima) segue
  registrada em `.gitleaksignore` como "ROTAÇÃO PENDENTE" — o scanner
  não substitui a rotação, só evita que o histórico fique vermelho pra
  sempre por algo já identificado.
- **`scripts/load-test.js` restaurado** (existia no commit `e82ccbd`,
  apagado sem querer num cleanup do vanilla) — `load-test.yml`
  referenciava um arquivo inexistente desde então. Os dois endpoints que
  ele testa (`/api/health`, `/api/cidades`) continuam existindo.

Testes após essa leva: 2097/2097 verdes, typecheck limpo.

Itens que continuam exigindo decisão/ação fora do repo: os 9 da lista
`MANUAL ACTION REQUIRED` acima (nenhum mudou) — nenhum item de código
sobrou pendente desta auditoria.
