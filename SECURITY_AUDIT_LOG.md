# Security Audit Log

## ⚠️ Sessão 13-15/09/2026 — Auditoria Mobile (Capacitor/Android/iOS)

Branch `claude/mobile-security-audit-b36g38` (commits `af59a79`, `30c4ae9`),
pushada, **sem PR aberto e sem merge na `main`**. Suíte completa verde (163
arquivos / 2115 testes), typecheck e `next build` limpos. Escopo: Capacitor,
Android, iOS, WebView, bridge nativa, plugins, OAuth mobile, deep links,
storage de token, permissões, Firebase/FCM, câmera, filesystem, uploads,
networking, logs, backups, clipboard, exported components, release build.

### CRÍTICO — CONTIDO, NÃO CORRIGIDO

- **CVE-2025-66478 / CVE-2025-55182** (RCE, CVSS 10.0) em `next@15.5.2` —
  desserialização do protocolo Flight via header `Next-Action`, alcançável
  em qualquer rota do App Router.
- **Causa da versão presa:** `@cloudflare/next-on-pages@1.13.16` (o adapter
  que gera o deploy no Cloudflare Pages) tem peer range `next: >=14.3.0 &&
  <=15.5.2` — teto EXATO na versão vulnerável — e está **descontinuado pelo
  próprio mantenedor** (recomenda migrar pro OpenNext). Não existe versão
  dele que destrave um Next corrigido (15.5.7+).
- **Mitigação aplicada** (`next-app/middleware.ts`): qualquer requisição com
  o header `Next-Action` é barrada com 404 antes de qualquer processamento.
  Seguro porque o app não declara NENHUMA Server Action (`'use server'` —
  zero ocorrências, conferido por grep no repo inteiro).
- ⚠️ **AÇÃO PENDENTE (arquitetural, fora desta sessão):** migrar o adapter de
  deploy (ex.: OpenNext-Cloudflare) e só depois subir o Next pra 15.5.7+.
  Precisa de teste contra o Cloudflare real — não fiz deploy nesta sessão.

### CORRIGIDO

- **Android `allowBackup` true→false** — a sessão do Supabase (localStorage/
  cookies da WebView) não entra mais no Auto Backup/`adb backup`.
- **Push nativo (FCM) sem cleanup no logout** — em aparelho compartilhado,
  trocar de conta deixava quem saiu recebendo notificação até a próxima
  conta sobrescrever o mesmo token. `currentNativePushToken()` (lê sem abrir
  prompt) + `clearDeviceTokenOnLogout()` no `AuthProvider.signOut`; badge do
  ícone zera ao desmontar.
- **Drift de CSP entre `_headers` (raiz) e `next.config.mjs`** — `media-src`
  sem `https://*.supabase.co` num dos dois podia bloquear `<video>`/`<audio>`
  do Supabase Storage em página estática pré-renderizada. Ficaram idênticos
  + teste de paridade (`cspHeadersParidade.test.ts`).

### PENDENTE, não corrigido de propósito

- **M1 — OAuth mobile em implicit flow** (`lib/supabase.ts` sem
  `flowType:'pkce'`): tokens no fragment da URL do deep link
  `br.com.queroumacor.app://auth/callback#...`, que o Android loga no
  Logcat. Risco baixo (exige acesso físico/adb); não mexido porque afeta
  fluxo web + nativo ao mesmo tempo e este app já teve múltiplos incidentes
  de OAuth quebrado. Fazer como tarefa própria, com teste em aparelho real.

### NOT VERIFIED

- ⏳ **Build nativo real (`.aab`/`.apk`/`.ipa`)** — ambiente sem Android SDK
  e sem macOS/Xcode. Só revisão de código/config; rodar no Codemagic (ou
  local com SDK/Xcode) antes de confiar cegamente nas mudanças de
  manifest/config.

### Achados baixos, sem ação necessária

- `.well-known/assetlinks.json` é resto de uma versão TWA anterior ao
  Capacitor — sem efeito hoje (sem intent-filter `autoVerify` no manifest
  atual).
- `FileProvider` (`file_paths.xml`) com `path="."` mais amplo que o
  necessário, mas não exportado e é o template padrão do plugin de câmera —
  não mexido pra não arriscar quebrar o contrato do plugin.
- Sem Universal Links/Android App Links verificados (só o custom scheme do
  OAuth) — funcional pro que existe hoje.

### Arquivos alterados

`_headers`, `android/app/src/main/AndroidManifest.xml`,
`next-app/middleware.ts`, `next-app/components/{AuthProvider,
NativeBadge}.tsx`, `next-app/lib/native/{index,push}.ts`,
`next-app/lib/services/pushTokens.ts` + 6 arquivos de teste (3 novos:
`androidManifestSecurity`, `capacitorWebviewSecurity`, `cspHeadersParidade`).

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
