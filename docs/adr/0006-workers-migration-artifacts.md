# ADR 0006 — Anexo: artefatos prontos pra execução (Workers Builds, wrangler.jsonc, corte de DNS)

- **Status**: Proposed — mesmo status do ADR 0006. Documento
  **inteiramente de planejamento**: nenhum arquivo listado aqui foi
  criado/editado em `next-app/` de verdade, nenhuma config real de
  Cloudflare foi tocada, nada foi commitado além deste próprio markdown
  (branch local `claude/workers-migration-plan`, sem push). Serve pra
  dimensionar e preparar a EXECUÇÃO de P1-P8 do ADR 0006 — só vira
  trabalho real depois que o ADR 0006 mudar de "Proposed" pra "Accepted"
  e o mantenedor decidir a data da janela de corte (P8).
- **Date**: 2026-09-18
- **Como usar este documento**: cada seção é um artefato que pode ser
  copiado quase literalmente na hora de executar — mas os placeholders
  marcados com `<...>` (IDs de KV/R2, nomes exatos de secret) precisam
  ser conferidos contra o painel real da Cloudflare antes de colar, não
  presumidos daqui. O roster de env vars da seção 2 foi levantado por
  `grep` direto do código-fonte (`getRuntimeEnv('NOME')` em `app/` e
  `lib/`), não copiado de memória nem do `.env.example` (que está
  desatualizado — não lista `VAPID_PRIVATE_KEY`/`PUSH_INTERNAL_SECRET`
  por exemplo, mesmo essas variáveis sendo lidas pelo código).

## 1. `next-app/wrangler.jsonc` — draft completo

Baseado na config mínima que a avaliação `claude/next16-opennext-eval`
already validou localmente pra build (só `main`/`compatibility_date`/
`assets`, sem environments), estendida aqui com `env.production` e
`env.preview`. **Isto SUBSTITUIRIA `next-app/wrangler.toml`** (que só
existe hoje porque o Pages/`next-on-pages` lê `pages_build_output_dir`
dali) — os dois arquivos não devem coexistir (mesmo achado da revisão do
PR #337: Wrangler resolve `wrangler.json > wrangler.jsonc > wrangler.toml`,
primeiro que existir vence, e ter os dois é a receita do quase-incidente
que levou a reverter aquele PR).

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "queroumacor-next",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-05-01",
  // "nodejs_compat" já é usado hoje (wrangler.toml atual). Avaliado na
  // branch `claude/next16-opennext-eval`: @opennextjs/cloudflare também
  // recomenda "global_fetch_strictly_public" (reduz a superfície de SSRF
  // interno do runtime — o worker não consegue mais alcançar endereços
  // internos da rede da Cloudflare por engano via fetch). Não testado a
  // fundo contra os endpoints de IA/WhatsApp/MP desta app nesta
  // avaliação — validar com o smoke test do P8 antes de confiar.
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },

  // ─── Vars públicas no nível TOP (herdadas por qualquer ambiente que
  // não as sobrescreva) — mesmas 5 que hoje vivem em
  // wrangler.toml [vars], nada muda de valor, só de arquivo/formato.
  // Isto é a superfície de RUNTIME (env.<nome>.vars / topo) — a
  // superfície de BUILD-TIME é outra, configurada no painel de Workers
  // Builds, ver seção 3.
  "vars": {
    "NEXT_PUBLIC_SUPABASE_URL": "https://uwqebaqweehiljsqkifm.supabase.co",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cWViYXF3ZWVoaWxqc3FraWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjYzMjgsImV4cCI6MjA4OTgwMjMyOH0.yp-z4iMifiOV3ftLVIHOFEQBLcMBdU8VFok7VKlSFg8",
    "NEXT_PUBLIC_SENTRY_DSN": "https://e19aa766953a6e70aeb09a52ea1046a7@o4511481806716928.ingest.us.sentry.io/4511482011189249",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY": "BGQI6K-7dVPeAEIoICoNVN3iM11WYgULjGgNc4I3_dfywulmlNmvYYKmHx99N8sREfJzVwvTy-COFSyyOHbAIdA",
    "VAPID_SUBJECT": "mailto:loja@calicolors.com.br"
  },

  "env": {
    "production": {
      // Custom Domain SÓ entra aqui depois do smoke test do P8 confirmar
      // que o Worker responde certo em endereço próprio — não antes.
      // Adicionar esta chave é o próprio ATO do corte de DNS (junto com
      // remover o Custom Domain do lado do Pages primeiro — ver runbook
      // P8, seção 4 deste documento). Deixar COMENTADO até esse momento.
      // "routes": [
      //   { "pattern": "queroumacor.com.br", "custom_domain": true },
      //   { "pattern": "www.queroumacor.com.br", "custom_domain": true }
      // ],

      // KV binding pra cache de cidades IBGE — hoje só configurado no
      // painel CF Pages (comentário em wrangler.toml), código NÃO lê
      // env.KV ainda. Migrar a declaração pra cá é melhoria (revisável em
      // PR), mas só faz sentido preencher o ID real quando/se o código
      // passar a ler `env.KV` de verdade — até lá, não incluir (evita o
      // "Error 8000022: Invalid KV namespace ID" que o wrangler.toml
      // atual já documenta ter evitado assim).
      // "kv_namespaces": [
      //   { "binding": "KV", "id": "<ID real de queroumacorapp-cidades, do painel>" }
      // ],

      // Runtime vars públicas de produção — herdadas do topo, repetidas
      // aqui só se algum dia divergirem de preview (hoje não divergem).
      "vars": {}
    },

    "preview": {
      // Preview usa as MESMAS 5 vars públicas do topo (sem sobrescrever
      // nada) — ZERO secret de produção acessível daqui. É esta seção
      // vazia, e não uma lista de secrets, que precisa continuar vazia
      // pra fronteira do STAGING.md se manter fechada no modelo novo.
      "vars": {}
    }
  }
}
```

**Secrets** (Supabase service role, chaves de IA/MP/WhatsApp/FCM — ver
roster completo na seção 2) **NÃO vão neste arquivo** — nunca ficam em
texto no config versionado. Entram via `wrangler secret put <NOME> --env
production` (um por um, interativo, nunca lidos de volta) ou pelo painel
Workers → Settings → Variables & Secrets. `.dev.vars` (gitignored, igual
`.env.local` hoje) cobre desenvolvimento local.

## 2. Roster de env vars — levantado do código-fonte real

Levantado com `grep -rhoE "getRuntimeEnv\('[A-Z_][A-Z0-9_]*'\)" app lib`
em `next-app/` (2026-09-18) — toda string literal passada pra
`getRuntimeEnv()`, a única função que o projeto usa pra ler config em
runtime (regra do `CLAUDE.md`: nunca `process.env` cru). Esta lista é
mais completa e mais confiável que `.env.example` (que ficou desatualizado
depois da rodada de push/WhatsApp de 2026-09-18 — falta `VAPID_PRIVATE_KEY`
e `PUSH_INTERNAL_SECRET`, por exemplo, apesar do código as ler).

| Variável | Classe | Onde entra |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | pública | Build vars (produção + preview) **e** Runtime vars (topo do `wrangler.jsonc`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | pública | Build vars (produção + preview) **e** Runtime vars (topo) |
| `NEXT_PUBLIC_SENTRY_DSN` | pública | Runtime vars (topo) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | pública | Runtime vars (topo) |
| `NEXT_PUBLIC_APP_VERSION` | pública, opcional | Runtime vars, se usado (feature flag de versão exibida) |
| `VAPID_SUBJECT` | pública (é um `mailto:`) | Runtime vars (topo) |
| `VAPID_PRIVATE_KEY` | secreta | Runtime secret, só `env.production` |
| `PUSH_INTERNAL_SECRET` | secreta | Runtime secret, só `env.production` |
| `SUPABASE_SERVICE_ROLE_KEY` (+ sinônimos `SUPABASE_SERVICE_KEY`/`SUPABASE_SERVICE_ROLE` que `resolveSupabaseEnv()` tenta como fallback) | secreta, crítica | Runtime secret, só `env.production` — NUNCA em preview |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | pública (par sem prefixo, lido como fallback pelo resolvedor único) | Runtime vars, só se algum caminho server-only ainda depender do par sem `NEXT_PUBLIC_` — conferir `resolveSupabaseEnv()` antes de omitir |
| `OPENAI_API_KEY` | secreta | Runtime secret, só `env.production` |
| `GEMINI_API_KEY` | secreta | Runtime secret, só `env.production` |
| `GEMINI_IMG_MODEL` | não-secreta, opcional | Runtime vars, se usada pra trocar modelo sem redeploy |
| `MP_ACCESS_TOKEN` | secreta | Runtime secret, só `env.production` |
| `MP_WEBHOOK_SECRET` | secreta | Runtime secret, só `env.production` |
| `MP_WEBHOOK_ENFORCE` | não-secreta, opcional | Runtime vars |
| `DUALHOOK_API_KEY` | secreta | Runtime secret, só `env.production` |
| `WHATSAPP_PHONE_NUMBER_ID` | não-secreta (ID público da Meta) | Runtime vars — pode ir em texto, mas mantida junto do grupo secreto por convenção do `.env.example` atual |
| `WHATSAPP_WABA_ID` | não-secreta | idem |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | secreta | Runtime secret, só `env.production` |
| `WHATSAPP_WEBHOOK_URL_SECRET` | secreta | Runtime secret, só `env.production` |
| `WHATSAPP_FOLLOWUP_URL_SECRET` | secreta | Runtime secret, só `env.production` |
| `WHATSAPP_WEBHOOK_AUTH_MODE` | não-secreta, opcional (`payload`\|`hmac`) | Runtime vars |
| `WHATSAPP_AI_MODEL` | não-secreta, opcional | Runtime vars |
| `WHATSAPP_TEMPLATE_ABORDAGEM` / `WHATSAPP_TEMPLATE_ABORDAGEM_CIDADE` | não-secreta, opcional | Runtime vars |
| `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` | secretas (service account do Firebase) | Runtime secret, só `env.production` |
| `ADMIN_EMAILS` | sensível (allowlist — não é segredo criptográfico, mas não deve vazar pra preview) | Runtime secret (ou var, mas só em `env.production`) |
| `IAP_PRODUCTION_VERIFICATION_ENABLED` | flag, alto risco se mal setada (ver `CLAUDE.md` CRIT-1) | Runtime vars, só `env.production`, e só quando a verificação real de IAP estiver implementada |
| `CF_REGION` / `VERCEL_REGION` | lidas por código de compat/diagnóstico, não configuráveis (o runtime as popula sozinho) | Não configurar manualmente |

**Preview (`env.preview`) só recebe as 5 vars públicas do topo do
`wrangler.jsonc`** (seção 1) — nenhuma linha desta tabela marcada
"secreta" ou "só `env.production`" deve ter equivalente em preview. Isso
reproduz exatamente o que `STAGING.md` já documenta e verificou pro
modelo atual (rotas que dependem de secret — admin, IA, pagamento,
WhatsApp — simplesmente não funcionam em preview, comportamento aceito).

## 3. Workers Builds — configuração do trigger (painel, não YAML)

Diferente do que a 1ª versão do ADR 0006 propunha (workflow de GitHub
Actions novo pra preview), a automação de build+deploy por push é
CONFIGURAÇÃO DE PAINEL da Cloudflare (ou API — ver exemplo de `curl` no
final desta seção), no MESMO espírito de como o Pages Git integration já
está configurado hoje (nunca foi um arquivo neste repo).

**Passo a passo (dashboard)**:

1. Criar o Worker `queroumacor-next` (se ainda não existir de um teste
   anterior) — **Workers & Pages → Create application → Import an
   existing Git repository**, apontando pro repo deste projeto,
   **root directory: `next-app`** (é um monorepo — mesma configuração de
   "working directory" que `deploy.yml` já usa hoje pro comando
   `wrangler`).
2. **Settings → Build**:
   - Build command: `npm run build:cf` (mesmo script hoje, mas apontando
     pro `open-next.config.ts`/`.open-next/` depois da migração de
     adapter — não o `@cloudflare/next-on-pages` atual).
   - Deploy command (branch de produção): `npx wrangler deploy`.
   - **Branch control**: produção = `main` (igual ao Pages hoje).
   - **Non-production branch builds**: LIGAR. Deploy command pra branch
     não-produção fica no padrão (`npx wrangler versions upload`) — não
     precisa customizar.
3. **Build Variables and Secrets** — preencher as 2 `NEXT_PUBLIC_*` da
   seção 2 (build-time). Repetir para o trigger de non-production
   branches (Cloudflare trata isso como configuração separada por
   trigger — conferir na UI se produção e non-production branches
   aparecem como abas/seções distintas, e preencher as DUAS).
4. **Settings → Variables & Secrets** (runtime) — preencher o roster
   completo da seção 2 pro ambiente de produção; preencher só as 5
   públicas pro ambiente de preview.
5. Confirmar em **Settings → Builds** que o Worker está de fato
   conectado ao repo certo, branch de produção certa, e que "Non-production
   branch builds" está ativo — sem isso, P1 (preview por branch) não
   funciona, silenciosamente (nenhum erro, só nenhuma preview URL
   aparece).

**Equivalente por API** (útil pra script de setup reprodutível, não pra
rodar às cegas — os placeholders `<...>` precisam vir de uma consulta
prévia à API, como `GET .../builds/repos` pra achar o `repo_connection_uuid`):

```bash
# Trigger de PRODUÇÃO (branch main)
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/builds/triggers" \
  --header "Authorization: Bearer <API_TOKEN>" \
  --header "Content-Type: application/json" \
  --request POST \
  --data '{
    "external_script_id": "<WORKER_TAG>",
    "repo_connection_uuid": "<REPO_CONNECTION_UUID>",
    "build_token_uuid": "<BUILD_TOKEN_UUID>",
    "trigger_name": "Deploy production",
    "build_command": "npm run build:cf",
    "deploy_command": "npx wrangler deploy",
    "root_directory": "next-app",
    "branch_includes": ["main"],
    "branch_excludes": [],
    "path_includes": ["*"],
    "path_excludes": []
  }'

# Trigger de PREVIEW (qualquer outra branch)
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/builds/triggers" \
  --header "Authorization: Bearer <API_TOKEN>" \
  --header "Content-Type: application/json" \
  --request POST \
  --data '{
    "external_script_id": "<WORKER_TAG>",
    "repo_connection_uuid": "<REPO_CONNECTION_UUID>",
    "build_token_uuid": "<BUILD_TOKEN_UUID>",
    "trigger_name": "Deploy preview branches",
    "build_command": "npm run build:cf",
    "deploy_command": "npx wrangler versions upload",
    "root_directory": "next-app",
    "branch_includes": ["*"],
    "branch_excludes": ["main"],
    "path_includes": ["*"],
    "path_excludes": []
  }'
```

(Formato confirmado na documentação oficial de API reference de Workers
Builds — `deploy_command` é o campo que distingue produção de preview:
`wrangler deploy` promove a versão pro tráfego ativo, `wrangler versions
upload` só cria a versão + preview URL, sem mover tráfego.)

## 4. `.github/workflows/deploy.yml` reescrito — caminho manual/backup

Continua existindo como o dispatch manual restrito a `main` — Workers
Builds (seção 3) cobre o automático. Reescrita direta do arquivo atual,
trocando só o que muda de mecanismo (comando `wrangler`, path do artefato,
sem passar mais `NEXT_PUBLIC_*` pro build do jeito antigo já que Workers
Builds também builda — este workflow manual precisa continuar buildando
sozinho, então as env vars do step "Build Next.js" continuam vindo de
GitHub Secrets, iguais a hoje):

```yaml
name: Deploy to Cloudflare Workers

# Disparo MANUAL apenas — caminho de backup. O deploy automático de
# produção passa a ser feito pelo Workers Builds (Git integration nativa
# da Cloudflare, configurada no painel — ver
# docs/adr/0006-workers-migration-artifacts.md seção 3), equivalente ao
# que o Pages Git integration fazia antes da migração.
on:
  workflow_dispatch:

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    # Mesmo guard de sempre — auditoria de segurança CI/CD, 2026-09-13.
    if: github.ref == 'refs/heads/main'
    defaults:
      run:
        working-directory: next-app
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          persist-credentials: false

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: next-app/package-lock.json

      - name: Install deps
        run: npm ci

      # Mesma regra de sempre: só NEXT_PUBLIC_* aqui — SUPABASE_SERVICE_ROLE_KEY
      # e o resto do roster runtime nunca passam por build-time, ficam só
      # nas Runtime Variables & Secrets do Worker (seção 2/3 deste anexo).
      - name: Build Next.js
        run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}

      - name: Build Cloudflare Worker output
        run: npm run build:cf   # aponta pra .open-next/assets depois da migração de adapter

      - name: Scan artifact for stray source maps / secrets
        run: |
          set -e
          MAPS=$(find .open-next/assets -iname '*.map' | wc -l)
          if [ "$MAPS" -ne 0 ]; then
            echo "::error::$MAPS arquivo(s) .map encontrados no artefato publicado."
            find .open-next/assets -iname '*.map'
            exit 1
          fi
          if find .open-next/assets -iname '.env*' | grep -q .; then
            echo "::error::arquivo .env encontrado no artefato publicado."
            exit 1
          fi

      # Mesmo SHA pinado que já está em produção hoje — trocar comando
      # `pages deploy` por `deploy`, mesma action.
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd # v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: next-app
          command: deploy --env production
```

Diffs concretos em relação ao `deploy.yml` de hoje: nome do workflow,
comentário de topo, `MAPS=$(find .vercel/output/static ...)` →
`.open-next/assets`, `command: pages deploy .vercel/output/static
--project-name=queroumacor-next --branch=main --commit-dirty=true` →
`command: deploy --env production`. Tudo o resto (checkout,
`persist-credentials: false`, `npm ci`, guard de branch, SHA pinado da
action) é idêntico, propositalmente — nenhuma dessas proteções é
específica de Pages.

## 5. Runbook de corte de DNS (P8) — passo a passo com comandos

Pré-requisitos antes de começar: P1-P7 completos e validados (Workers
Builds publicando `main` com sucesso pro endereço `*.workers.dev`, sem
tocar no domínio ainda), `env.production` com o roster completo da seção
2 conferido, ADR 0006 com status "Accepted" e data da janela combinada
com o mantenedor.

### 5.1. Antes da janela (sem risco, pode ser feito com antecedência)

```bash
# Confirma que o Worker de produção responde certo no endereço próprio,
# ANTES de qualquer coisa tocar em queroumacor.com.br.
curl -sI https://queroumacor-next.<subdominio-da-conta>.workers.dev/ | head -5

# Lista as versões publicadas — anota o version-id ATUAL antes do corte,
# pra ter o alvo exato de um `wrangler rollback` se precisar.
npx wrangler deployments list --name queroumacor-next
```

Checklist de smoke test manual (não só `curl` — usar o app de verdade
contra o endereço `*.workers.dev`):

- [ ] Login por e-mail e por OAuth (Google/Apple) — Supabase Auth.
- [ ] `/api/whatsapp/webhook` — GET de verificação (handshake) e um POST
      de teste (se o Dualhook permitir apontar temporariamente pra esse
      endereço, ou simular a assinatura à mão).
- [ ] `/api/mp-webhook` — HMAC válido aceito, inválido rejeitado (mesmo
      teste que `__tests__` já cobre, mas contra o Worker real).
- [ ] `/api/checkout` — fluxo completo de criação de preferência MP.
- [ ] Publicar um post com upload de mídia (Storage do Supabase).
- [ ] Ler o feed logado (RLS aplicando corretamente).
- [ ] Uma chamada de IA (chat-ai ou moderate) — confirma que
      `SUPABASE_SERVICE_ROLE_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`
      chegam certos em runtime.
- [ ] Push (se aplicável no momento do teste) — FCM/VAPID.

Qualquer item falhando aqui é bloqueante — não prosseguir pro corte de
DNS até os 8 passarem.

### 5.2. Durante a janela (produção ao vivo, minimizar o tempo entre os dois comandos)

```bash
# 1. Remove o Custom Domain do lado do PAGES primeiro (apaga o CNAME
#    dele). A partir daqui, queroumacor.com.br para de resolver até o
#    passo 2 — janela real, manter curta.
#    (comando via API; o dashboard tem o mesmo botão em
#    Pages project → Custom domains → Remove)
curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/pages/projects/queroumacor-next/domains/queroumacor.com.br" \
  --header "Authorization: Bearer <API_TOKEN>"

curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/pages/projects/queroumacor-next/domains/www.queroumacor.com.br" \
  --header "Authorization: Bearer <API_TOKEN>"

# 2. Adiciona o Custom Domain no WORKER novo — imediatamente em seguida.
npx wrangler deploy --env production   # garante que routes do wrangler.jsonc
                                         # (seção 1, agora descomentadas) sejam aplicadas
```

Ou, se preferir não editar `wrangler.jsonc` e reaplicar por deploy,
adicionar direto pelo dashboard (**Worker → Settings → Domains & Routes
→ Add → Custom Domain**, uma vez pra `queroumacor.com.br` e outra pra
`www.queroumacor.com.br`) — o efeito é o mesmo, e pode ser mais rápido
manualmente do que esperar um `wrangler deploy` completo no meio da
janela.

### 5.3. Depois do corte

```bash
# Confirma resolução e que quem responde agora é o Worker (não mais Pages).
dig +short queroumacor.com.br
curl -sI https://queroumacor.com.br/ | head -5

# Repetir o checklist de smoke test da seção 5.1, agora contra o domínio
# real — é a prova final, não só o endereço workers.dev.
```

Manter o Pages project (`queroumacor-next` no produto Pages) **vivo, sem
deletar**, por pelo menos algumas semanas.

### 5.4. Rollback

- **Algo quebrou no Worker, DNS ainda não foi tocado** (falhou no smoke
  test da seção 5.1): não faz nada em produção — o Pages project seguiu
  servindo o tempo todo. Corrigir e repetir 5.1.
- **Algo quebrou DEPOIS do corte, o Worker é o problema (não o
  domínio)**: `npx wrangler rollback <version-id-anotado-em-5.1> --name
  queroumacor-next --env production` — reverte o Worker pra uma versão
  anterior sem tocar em DNS/Custom Domain nenhum. Mais rápido que reverter
  domínio.
- **Algo quebrou de um jeito que só reverter o domínio resolve** (ex.:
  suspeita de que o modelo Workers em si tem uma incompatibilidade que
  `wrangler rollback` não cobre): repetir a sequência da seção 5.2 na
  direção contrária — remover o Custom Domain do Worker, recriar o Custom
  Domain no Pages project (ele não foi deletado, só perdeu o domínio).
  Mesma janela curta de indisponibilidade que o corte original teve.

## Referências

- `docs/adr/0006-opennext-cloudflare-deploy-pipeline.md` — ADR principal,
  contexto completo da decisão e P1-P8 em prosa.
- Documentação Cloudflare consultada nesta revisão (2026-09-18):
  `/workers/ci-cd/builds/`, `/workers/ci-cd/builds/build-branches/`,
  `/workers/ci-cd/builds/configuration/`, `/workers/ci-cd/builds/api-reference/`,
  `/workers/versions-and-deployments/preview-urls/`,
  `/workers/configuration/routing/custom-domains/`,
  `/workers/static-assets/migration-guides/migrate-from-pages/`.
