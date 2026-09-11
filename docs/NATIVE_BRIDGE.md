# Fronteira nativa — `next-app/lib/native/`

Decisão (2026-09-03, pós-auditoria de arquitetura): a casca mobile continua
**Capacitor** (não React Native) — o app web é o produto; o nativo entra como
capacidades (câmera, push, OAuth via browser do sistema, share), nunca como
segunda UI. RN+Expo fica arquivado como opção futura, reaberta apenas se o
roadmap pedir telas nativas de verdade.

## Regras do contrato

1. **Componentes/hooks importam SÓ `@/lib/native`** (objeto `native`). Nunca
   `@capacitor/*` nem `window.Capacitor` direto. Lint futuro deve travar isso.
2. **O bundle web não carrega dependência nativa.** A casca injeta
   `window.Capacitor` (site vem de `server.url`); `lib/native/platform.ts`
   acessa por esse global. Plugin ausente = feature-detection falha =
   fallback web. A MESMA página serve browser, PWA, casca velha e casca nova.
3. **Toda espera tem timeout** (lição do WebView: promessa pendurada não
   rejeita). OAuth: 5 min; registro de push: 15 s.
4. **Cancelamento ≠ indisponível.** `takePhotoNative` distingue
   `cancelled` (usuário desistiu no prompt nativo → NÃO abrir fallback web)
   de `unavailable` (sem plugin → fallback web).
5. Se a casca um dia virar RN/Expo, **reimplementa-se só este diretório** —
   o resto do app não muda.

## OAuth nativo (fluxo A) — como funciona

`lib/native/auth.ts`: um cliente Supabase DEDICADO (`flowType: 'pkce'`, sem
persistência) gera a URL com `signInWithOAuth({ skipBrowserRedirect: true })`
→ `Browser.open()` (Custom Tab / ASWebAuthenticationSession) → login no
domínio do Supabase num browser REAL (sem `disallowed_useragent`) → Supabase
redireciona pro deep link `br.com.queroumacor.app://auth/callback?code=…` →
plugin App dispara `appUrlOpen` na WebView → `exchangeCodeForSession(code)`
(exige o `code_verifier` que nunca saiu da WebView) → `setSession()` no
cliente principal → `/completar-perfil`. Integrado no `AuthProvider` com
feature-detection; browser/PWA seguem no fluxo web intocado.

**Por que PKCE e não o implicit de antes (auditoria de autenticação,
2026-09-11):** o deep link é custom scheme, sem verificação de domínio — no
Android qualquer app pode registrar `br.com.queroumacor.app://` e receber o
callback. No implicit ele recebia `access_token` + `refresh_token` (a sessão
inteira), e um link forjado com o token do atacante logava a vítima na conta
dele. Com PKCE o callback só carrega um `code` de uso único, inútil sem o
verifier. **Token no fragment/query do deep link é ignorado de propósito**
(`parseAuthCallbackUrl` só devolve `code`); há teste travando isso
(`__tests__/native-oauth-pkce.test.ts`). O cliente principal continua
`implicit` porque o link de recuperação de senha abre em OUTRO navegador, sem
verifier — PKCE ali quebraria o "esqueci a senha".

## Pendências pra ativar de verdade (lado da casca / painel)

- [ ] **Supabase → Auth → URL Configuration**: `br.com.queroumacor.app://auth/callback`
      já está nas Redirect URLs (2026-09-03). ATENÇÃO ao esquema no Android:
      o applicationId do Play é `br.com.queroumacor` (SEM `.app`), então o
      intent-filter do deep link na casca Android tem que registrar
      explicitamente o esquema `br.com.queroumacor.app` (o que `auth.ts`
      usa) — NÃO deixar o Capacitor derivar do package, senão o callback
      vira `br.com.queroumacor://auth/callback` e não bate. Se optar por
      derivar, adicionar `br.com.queroumacor://auth/callback` como 2ª
      Redirect URL e ajustar `NATIVE_OAUTH_REDIRECT`. iOS já está certo
      (scheme = bundle `br.com.queroumacor.app`).
- [x] Deps dos plugins no `package.json` da raiz: `@capacitor/browser`,
      `app`, `camera`, `share`, `@capacitor/android`, e — pro push —
      **`@capacitor-firebase/messaging`** (NÃO `@capacitor/push-notifications`,
      ver nota abaixo). Falta rodar na MÁQUINA DE BUILD (Android SDK/Xcode):
      `npm install` → `npx cap add android` → `npx cap sync`.
- [x] Envio FCM server-side FEITO (`lib/api/_services/fcm.ts`, canal nativo
      do `/api/push-notify`). Cliente: `lib/native/push.ts`. Falta a config.

> **Por que `@capacitor-firebase/messaging` e não `@capacitor/push-notifications`:**
> no iOS o `@capacitor/push-notifications` devolve o token do **APNs**, mas o
> `fcm.ts` envia por **FCM HTTP v1**, que espera um token **FCM**. O
> `@capacitor-firebase/messaging` devolve token FCM nos DOIS sistemas (no iOS
> o Firebase faz a ponte FCM→APNs via a APNs Auth Key), então um sender só
> cobre Android e iPhone. `push.ts` usa o global `FirebaseMessaging`.

## Push nativo — o que falta ligar (config, não código)

O envio já manda pros DOIS canais — Web Push (VAPID) e FCM (novo), cada um
independente. Passo-a-passo do Firebase:

### 1. Projeto + apps
- console.firebase.google.com → **Adicionar projeto** (ou usar um existente).
- **App Android**: pacote `br.com.queroumacor` (o do Play, SEM `.app`) →
  baixar `google-services.json` → vai em `android/app/` após `cap add android`.
- **App iOS**: bundle `br.com.queroumacor.app` (o do Info.plist, COM `.app`) →
  baixar `GoogleService-Info.plist` → vai em `ios/App/App/` (adicionar ao
  target no Xcode).

### 2. APNs (obrigatório pro push chegar no iPhone)
- Apple Developer → Keys → criar Key com **APNs** habilitado → baixar `.p8`
  (só baixa uma vez); anotar **Key ID** e **Team ID**.
- Firebase → ⚙️ Configurações → **Cloud Messaging** → app iOS → **APNs
  Authentication Key** → upload do `.p8` + Key ID + Team ID.

### 3. Service account → 3 envs no CF Pages (Secret)
- Firebase → ⚙️ Configurações → **Contas de serviço** → **Gerar nova chave
  privada** → baixa um JSON. Mapeia:
  - `project_id`  → `FCM_PROJECT_ID`
  - `client_email` → `FCM_CLIENT_EMAIL`
  - `private_key`  → `FCM_PRIVATE_KEY` (cola com os `\n` literais; `fcm.ts`
    normaliza)
- Marcar as 3 como **Secret** (Production) e **redeploy** (envs só entram no
  build/runtime novo). Sem elas o canal nativo fica inerte e o web push segue
  igual (nenhum 503 novo).
- O **FCM API V1** já vem habilitado; NÃO precisa da "Server Key"/API Legacy.

### 4. Teste ponta a ponta
Com as envs + um device registrado: `POST /api/push-notify` (header
`x-internal-secret`) → resposta `{"native":{"sent":N,...}}`.

## Android — intent-filter do deep link do OAuth (após `cap add android`)

O `cap add android` gera `android/app/src/main/AndroidManifest.xml`. Como o
`applicationId` é `br.com.queroumacor` mas o esquema do callback é
`br.com.queroumacor.app` (o que `lib/native/auth.ts` usa), o intent-filter
tem que declarar o esquema EXPLICITAMENTE dentro da `<activity>` principal:

```xml
<intent-filter android:autoVerify="false">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="br.com.queroumacor.app" android:host="auth" />
</intent-filter>
```

(Alternativa sem editar manifest: usar o esquema derivado do package
`br.com.queroumacor://auth/callback` e adicionar essa 2ª URL nas Redirect
URLs do Supabase + trocar `NATIVE_OAUTH_REDIRECT` — os dois caminhos
funcionam, escolha um.)
- [ ] Fluxo B (SDKs nativos + `signInWithIdToken`, one-tap): exige client
      OAuth por plataforma (iOS client ID; Android com SHA-256 do keystore) —
      fazer junto da unificação de applicationId (achado C4 da auditoria).

## Build Android (Capacitor) — valores exatos

Após `npx cap add android`, ajustar no `android/app/build.gradle`
(o `cap add` deriva do `appId` do capacitor.config, que é o BUNDLE do iOS):
- `applicationId "br.com.queroumacor"` ← trocar (o config tem `.app`, que é iOS)
- `versionCode 10200` (o build atual do Play é 10100; subir)
- `minSdk 24`, `compileSdk 36`

Firebase no Gradle:
- root `build.gradle`: `classpath 'com.google.gms:google-services:4.5.0'`
- `app/build.gradle`: `apply plugin: 'com.google.gms.google-services'`
- `google-services.json` em `android/app/` (não é segredo; vai no APK)
- `POST_NOTIFICATIONS` no Manifest (Android 13+); a permissão em runtime já
  é pedida pelo plugin (`registerNativePush` → `requestPermissions`)

Assinatura: `my-release-key.jks` (confere com a upload key do Play). O `.jks`,
`key.properties` e senhas ficam FORA do repo (`.gitignore`) — no CI entram
como secure file / secret. Validar App Links só a partir de um build da
Internal Testing (o cert local pode não bater com o `assetlinks.json`).

O `server.url` da casca é `https://www.queroumacor.com.br` (www — canônico e
host do deep link).

## Testar a config FCM ANTES do AAB (sem device token)

O caminho de envio real só autentica no FCM quando há device token — então,
sem app instalado, não dá pra saber se as 3 envs FCM estão certas. Pra isso
existe o diagnóstico (mesmo gate `x-internal-secret`, não envia nada):

```
curl -X POST https://www.queroumacor.com.br/api/push-notify \
  -H "x-internal-secret: <PUSH_INTERNAL_SECRET do painel CF>" \
  -H "content-type: application/json" \
  -d '{"diagnose":"fcm"}'
```

Respostas: `{"ok":true,"diagnose":"fcm","configured":true}` = service account
válida e FCM aceitou a troca de token (pode gerar AAB). `configured:false` =
alguma das 3 envs falta. `ok:false` = envs presentes mas a private key não
assina / API não habilitada.

## Testes

`__tests__/native.test.ts` trava o contrato do bridge (fallback fora da casca,
detecção, câmera, parser do deep link, rota do toque). `__tests__/api/fcm.test.ts`
cobre as partes puras do sender + `verifyFcmCredentials`.
