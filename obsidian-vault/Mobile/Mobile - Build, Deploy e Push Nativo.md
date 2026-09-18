---
tags: [mobile, capacitor, android, ios, codemagic, push]
---

# Mobile — Build, Deploy (Capacitor/Codemagic) e Push Nativo

> **🚫 WebIntoApp está morto — não citar como referência.** Decisão do usuário em 2026-09-04. As DUAS lojas saem de **Codemagic + Capacitor**, deste mesmo repo.

## Arquitetura
`next-app/lib/native/` é a ÚNICA fronteira do web com a casca (acessa `window.Capacitor`, nunca importa `@capacitor/*` no bundle). Componente novo nunca importa plugin direto — só `@/lib/native`.

## Android
- `android/` scaffoldado via `npx cap add android`. `applicationId br.com.queroumacor`, minSdk 24, compileSdk/targetSdk 36.
- Build pelo **Codemagic** (`codemagic.yaml`, workflow `android-aab`), não GitHub Actions (descartado). Assinatura via `key.properties` (gitignored) montado pelo Codemagic a partir do keystore no painel.
- Deploy automático pra faixa **`internal`** (Internal Testing) — produção é manual. `versionCode` automático via `google-play get-latest-build-number` +1.
- **R8 quebrou o boot e foi REVERTIDO** (`minifyEnabled false`) — app não passava da splash. **Regra: nunca publicar R8 nem mudança de boot da casca sem instalar o AAB e abrir antes.**

## iOS
- Workflow `ios-ipa` no Codemagic, sobe no TestFlight. Projeto Xcode **versionado na `main`** (gerado por `cap add ios`, curado) — build roda `npx cap sync ios`, **NUNCA `cap add ios` de novo** (sobrescreveria os arquivos curados). O workflow antigo `.github/workflows/ios-build.yml` faz `rm -rf ios && cap add ios` — **não usar**, é a armadilha.
- Bundle `br.com.queroumacor.app`, Apple ID `6784256495` (mesma ficha do WebIntoApp).
- APNs `.p8` (Key ID `2R6FW9F2F6`) e `App.entitlements` com `aps-environment: production` — **lado Apple do push COMPLETO** (capability Push Notifications ligada e salva em 2026-09-05).
- `Certificates (0)` na tela do App ID é o CERTO — usamos Auth Key `.p8` (não expira), não o caminho antigo de certificado por ano. **Não criar certificado ali.**
- Build iniciada ANTES do Save da capability precisa rodar de novo (provisioning profile gerado durante a build).
- **Builds já feitas, em review na Apple** (2026-09-05, confirmado pelo usuário) — não listar "disparar build iOS" como pendência.

## Push nativo (FCM)
Projeto Firebase `queroumacor-245ef`. `push_device_tokens` (Wave 39, RLS user-owned) + `lib/api/_services/fcm.ts` (FCM HTTP v1, RS256 JWT no edge). RPC `upsert_push_device_token` corrige o sequestro cross-user (ver [[Segurança - Firebase FCM e Push]]). **Corrente provada em produção (2026-09-05)**: push nativo chegou no aparelho.
- Web Push (VAPID) é canal INDEPENDENTE do nativo — precisa de `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/`PUSH_INTERNAL_SECRET` no CF Pages. iOS só funciona 16.4+ em modo PWA.
- WebView (app empacotado) NÃO tem Web Push nem iOS nem Android — `<PushOptIn>` some quando ambiente não suporta.

## OAuth mobile (Fluxo A)
`skipBrowserRedirect` → `Browser.open` (navegador do sistema) → deep link `br.com.queroumacor.app://auth/callback` → `appUrlOpen` → parse do fragment → `setSession`. Resolve `disallowed_useragent` do Google e App-Bound Domains do iOS. **Migrou pra PKCE em 2026-09-15** (ver [[Auth - OAuth, Cadastro e RLS de Sessão]]).

## Capacidades nativas (Ondas A/B/C, 2026-09-04)
Onda A: haptics, status bar, splash, keyboard. Onda B: câmera nativa (getPhoto), picker nativo de galeria (`pickImages`, só-imagem), filesystem (salvar). Onda C: network, clipboard, browser (Custom Tab), device, badge (`@capawesome/capacitor-badge`), `<OfflineBanner>`, `<NativeBadge>`. **Onda D não será feita (decisão do usuário).**
Todos com fallback web (feature-detected). Só valem no aparelho com AAB novo.

## Firebase — pendências fechadas
`google-services.json`/`GoogleService-Info.plist` baixados e commitados via env base64 no Codemagic (`GOOGLE_SERVICES_JSON`, grupo `firebase`).

---
## Ver também
[[Segurança - Mobile (Capacitor Android iOS)]] · [[Segurança - Firebase FCM e Push]] · [[Mobile - Bugs de WebView e Picker]] · [[Auth - OAuth, Cadastro e RLS de Sessão]]
