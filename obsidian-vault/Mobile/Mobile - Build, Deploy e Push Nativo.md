---
tags: [mobile, capacitor, android, ios, codemagic, push]
---

# Mobile — Build, Deploy (Capacitor/Codemagic) e Push Nativo

> **🚫 WebIntoApp está morto — não citar como referência.** Decisão do usuário em 2026-09-04. As DUAS lojas saem de **Codemagic + Capacitor**, deste mesmo repo. Menções a WebIntoApp abaixo são registro histórico de incidentes já resolvidos, não orientação atual.

## Fronteira nativa `lib/native/` (2026-09-03)
Decisão de arquitetura: casca mobile continua **CAPACITOR** (não React Native) — nativo entra como capacidade, não como segunda UI; RN+Expo arquivado até o dia em que o roadmap pedir telas nativas. `next-app/lib/native/` é a ÚNICA fronteira do web com a casca (acessa `window.Capacitor` injetado, NUNCA importa `@capacitor/*` no bundle): módulos:
- `platform` (detecção)
- `auth` (fluxo A de OAuth: `skipBrowserRedirect` → `Browser.open` no navegador do sistema → deep link `br.com.queroumacor.app://auth/callback` → `appUrlOpen` → parse do fragment → `setSession` — resolve o `disallowed_useragent` do Google e o App-Bound Domains do iOS)
- `camera` (base64→File; `cancelled` ≠ `unavailable`)
- `share`
- `push` (só registro/token na 1ª versão; persistência+FCM veio depois, ver abaixo)

Tudo com timeout (promessa pendurada em WebView não rejeita). 12 testes em `__tests__/native.test.ts`. Doc: `docs/NATIVE_BRIDGE.md`.

**Regra: componente novo NUNCA importa plugin/`window.Capacitor` direto — só `@/lib/native`.**

Pendente na época (painel/casca, não código), hoje resolvido pela mudança pra Capacitor: (1) adicionar `br.com.queroumacor.app://auth/callback` nas Redirect URLs do Supabase (sem isso o callback cai no Site URL e o login nativo não completa); (2) instalar `@capacitor/{browser,app,camera,share}` + **`@capacitor-firebase/messaging`** (NÃO `@capacitor/push-notifications`: no iOS aquele devolve token APNs, e o `fcm.ts` envia por FCM v1 que quer token FCM; `@capacitor-firebase/messaging` devolve FCM nos dois SOs) + `npx cap sync`; (3) config do Firebase + 3 envs FCM.

## Direção mobile mudou: AGORA É CAPACITOR (2026-09-03)
A regra antiga ("NÃO EXISTE BUILD NATIVO / WebIntoApp empacota / Capacitor fora de escopo") está **SUPERADA** por decisão do usuário. Foi VERIFICADO (não presumido) que a casca WebIntoApp é **WebView pura, sem Capacitor** — então `lib/native/` (câmera, push, OAuth pelo browser do sistema) NÃO funciona nela, e push nativo é impossível ali. O AAB DEFINITIVO passa a sair do **Capacitor**. `capacitor.config.ts` (raiz) deixou de ser "resto abandonado" e é o config vigente da casca.

**Firebase (feito 2026-09-03)**: projeto `queroumacor-245ef`; app Android `br.com.queroumacor` + Apple `br.com.queroumacor.app` registrados; `google-services.json`/`GoogleService-Info.plist` baixados; FCM API V1 Enabled. 3 secrets FCM setados no CF Pages + redeploy.

**Fatos do build real (verificados)**: `applicationId br.com.queroumacor`, `versionCode 10100`, `minSdk 24`; app em produção (release 1.1, ~19 instalados) sob a conta **`queroumacor@gmail.com`** (NÃO `jackson.guerra@`); Play App Signing ativo; upload key (`my-release-key.jks`) confere com o Play (NÃO precisa resetar). O host do deep link (App Links) é **`www.queroumacor.com.br` COM www**.

**Pegadinha**: a pasta `deeplinks/` que o WebIntoApp deixou tem `assetlinks.json` com o fingerprint ERRADO — ignorar. O válido é o de `next-app/public/.well-known/assetlinks.json` (package `br.com.queroumacor`, SHA-256 do App Signing Key), que é o servido em produção.

`capacitor.config.ts` carrega o APEX `https://queroumacor.com.br` (sem www), mas o deep link é `www.*`. `allowNavigation` cobre `*.queroumacor.com.br`, então navegar não quebra; se a casca DEVE carregar o www, trocar `server.url` — confirmar antes do build.

Plano nativo pendente na casca (build machine) na época: capability de Push + `AppDelegate.swift` (iOS), plugin `google-services` no Gradle (Android), permissão `POST_NOTIFICATIONS` (Android 13+, o plugin pede via `requestPermissions`), intent-filter do scheme `br.com.queroumacor.app` pro OAuth. Doc: `docs/NATIVE_BRIDGE.md`.

### Casca Android já no repo (PR #171, 2026-09-03)
`android/` scaffoldado (`npx cap add android`), `applicationId br.com.queroumacor`, versionCode 10200, minSdk 24, compileSdk/targetSdk 36, deep link OAuth + `POST_NOTIFICATIONS` no Manifest, 5 plugins (incl. `@capacitor-firebase/messaging`). `assets/public` e config JSONs gerados ficam GITIGNORED (o app carrega de `server.url`).

### AAB gerado pelo Codemagic, não GitHub Actions (2026-09-03)
`codemagic.yaml` na raiz (workflow `android-aab`, disparo manual). Assinatura via `signingConfig` CONDICIONAL no `android/app/build.gradle` que lê `android/key.properties` (gitignored) — o Codemagic monta esse arquivo do keystore do painel (`CM_KEYSTORE_*`, reference `queroumacor_keystore`); build local sem o arquivo sai não-assinado, sem quebrar. `google-services.json` entra por env `GOOGLE_SERVICES_JSON` (base64) do grupo `firebase`. **GitHub Actions foi DESCARTADO pra build de AAB** (PR #172 fechado sem merge) — Codemagic é melhor pra mobile (iOS/macOS + assinatura Apple no mesmo lugar). Doc: `docs/ANDROID_AAB_CODEMAGIC.md`.

### Deploy automático na Play (PR #182, 2026-09-04)
`publishing.google_play` sobe o AAB direto na faixa **`internal`** (Internal Testing); produção continua MANUAL (regra do projeto). Credencial no grupo `google_credentials` (`GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`, JSON da service account — lido automaticamente pelo CLI). **`versionCode` virou automático**: 1º step roda `google-play get-latest-build-number --package-name br.com.queroumacor` (maior de todas as tracks) +1, com fallback pra `ANDROID_VERSION_CODE`/10202 se o CLI falhar (nunca derruba a build). O AAB SEGUE saindo por e-mail + artifact também. Lado Play (não-código): a service account precisa de permissão de Releases no app + Google Play Android Developer API habilitada.

### iOS agora sai do Codemagic (Capacitor), não do GitHub Actions (verificado na `main`)
`codemagic.yaml` ganhou o workflow **`ios-ipa` ("iOS IPA (Capacitor)")** — `app_store_connect: codemagic` (a mesma integração que o repo `queroumacor-ios` já usa), `ios_signing` `distribution_type: app_store`, sobe no **TestFlight**. O **projeto Xcode está VERSIONADO na `main`** (`ios/App/App.xcodeproj`, `.xcworkspace`, `Podfile`, `App.xcscheme`, Assets com ícone 512 + splash 2732²) — gerado por `npx cap add ios` e commitado; a build roda `npx cap sync ios` (NUNCA `cap add ios` de novo — sobrescreveria os arquivos curados). **NÃO usar o `.github/workflows/ios-build.yml`** (GitHub Actions): é o pipeline antigo, superado, e roda `rm -rf ios && npx cap add ios` (a armadilha que apaga os curados) — pendente de deleção.

**Numeração iOS**: `CFBundleShortVersionString` (versão, ex.: `1.2.0`) é à mão no `Info.plist`; **build number é automático** (Codemagic pergunta o último à App Store +1) — o último do WebIntoApp foi 9, então a 1ª build Capacitor sai como **10**. Segredos em painel do Codemagic: `GOOGLE_SERVICE_INFO_PLIST`/`GOOGLE_SERVICES_JSON` (grupo `firebase`), integração App Store Connect (`codemagic`). Identidade: bundle `br.com.queroumacor.app`, Apple ID `6784256495` (mesma ficha do WebIntoApp — um substitui o outro, não vira app novo).

**Pendências iOS (revisado em 2026-09-05) — todas FECHADAS**: APNs `.p8` ✓ FEITO (Key ID `2R6FW9F2F6`, Sandbox & Production, nos dois slots do Firebase) e `App.entitlements` ✓ EXISTE com `aps-environment: production`, referenciado no projeto Xcode — e a capability Push Notifications no App ID `br.com.queroumacor.app` ✓ LIGADA E SALVA (2026-09-05). **O lado Apple do push está COMPLETO.**

**`Certificates (0)` nessa tela é o CERTO — não "consertar".** O botão "Configure" ali abre "Apple Push Notification service SSL Certificates", que é o caminho ANTIGO do APNs (um certificado por App ID, vence todo ano, renovação manual). Usamos a Auth Key `.p8`, que não expira e é team-scoped, então a contagem fica em 0 pra sempre. **NÃO criar certificado ali**: viraria uma credencial paralela que ninguém usa e que, ao vencer em 12 meses, faria alguém concluir que o push quebrou quando não quebrou.

**Build iOS que tenha COMEÇADO antes desse Save precisa rodar de novo**: o provisioning profile é gerado durante a build, e o dela não carrega o direito. Falha visível = `entitlement not supported` na assinatura; falha TRAIÇOEIRA = a build passa e o app no TestFlight simplesmente nunca recebe push.

Antes da review: esconder compra do PRO no iOS ✓ JÁ SATISFEITO (`startProCheckout` existe em `lib/services/billing-platform.ts` mas **não tem call site de UI nenhum**; `ProView` oferece o WhatsApp da loja — não há compra dentro do app pra esconder); fallback offline ✓ FEITO (PR #201). "Tirar a sessão do Supabase do `localStorage`" — FECHADO como NÃO SE APLICA (ver [[Auth - OAuth, Cadastro e RLS de Sessão]]: o `hybridAuthStorage` já resolveu o problema que motivou o pedido, e tirar do localStorage só melhoraria a segurança se a sessão fosse pra um cookie httpOnly — e o supabase-js no client precisa ler o token em JavaScript de qualquer forma, mesma exposição a XSS trocando seis por meia dúzia; a Apple não exige nada disso). `docs/IOS_BUILD.md` está DESATUALIZADO (bundle/repo/fluxo Xcode manual errados) — reescrever com esta realidade.

**Builds já feitas, EM REVIEW NA APPLE (2026-09-05, confirmado pelo usuário)** — não listar "disparar build iOS" como pendência.

### R8 quebrou o boot — REVERTIDO (PR #183, 2026-09-04)
O R8 ligado no PR #179 (`minifyEnabled`/`shrinkResources true`) fez o app **não passar da splash** no Internal Testing: apesar das keep-rules, removeu classe(s) que o Capacitor registra por reflexão e a WebView nunca carregou. Agravado pela splash `launchAutoHide:false` da Onda A — quando a WebView não carrega, a splash fica CONGELADA pra sempre (o `launchShowDuration` é ignorado com autoHide false). Reversão: `minifyEnabled false`/`shrinkResources false` (as keep-rules ficam pro dia de reativar COM smoke-test de aparelho) + `SplashScreen.launchAutoHide:true` + `launchShowDuration:2500` (a splash SEMPRE some, mesmo se o site demorar/falhar). **Regra: nunca publicar R8 (nem mudança de boot da casca) sem instalar o AAB e ABRIR antes.** Num app WebView o ganho do R8 é modesto e não vale o risco.

## P0 da auditoria de arquitetura FECHADOS no código (2026-09-03)
Ver `ARCHITECTURE_AUDIT_2026-08-26.md`. Status:
- **C1 ✓** `gateProAI`/`gateProAIForm` agora retornam 401 pra anônimo/token inválido (antes: requisição SEM token chegava na IA sem PRO, rate limit nem cota). 6 testes de regressão em `__tests__/api/gate-anon.test.ts`.
- **C2 ✓** CSP validada em produção — ver [[Segurança - Cloudflare]] e [[Infraestrutura - Cloudflare, Env Vars e Deploy]].
- **C3/A-D1 ✓** SQL de RLS/`is_portal_admin()` — ver [[Segurança - Auditoria Supabase (RLS e Banco)]].
- **C4 ✓ — resolvido por PR #163 (2026-09-03).** Identidades são DISTINTAS e corretas assim: **Android package = `br.com.queroumacor`** (Play Console, `twa-manifest.json`, `.well-known/assetlinks.json` — SHA-256 real do App Signing Key já bate); **iOS bundle + scheme de deep link = `br.com.queroumacor.app`** (Info.plist, `br.com.queroumacor.app://auth/callback`). NÃO tentar "unificar" os dois — são de stores diferentes. O product ID de billing segue `com.calicolors.queroumacor.pro.monthly` (configurado nas stores; não renomear sem mexer lá).
- **C5 ✓ FECHADO** — ver [[Convenções Gerais de Desenvolvimento]] (branch protection, job `validate`).
- **C6 ✓** jspdf 2→4.2.1 (CRITICAL eliminada); next pinado — ver [[Infraestrutura - Cloudflare, Env Vars e Deploy]].

**SQL Wave 39 — JÁ EXECUTADO no Supabase**: tabela `push_device_tokens` (RLS user-owned, canal FCM/APNs separado do web push). Rodado em 3 blocos de linha única — o editor do Supabase mutila quebras de linha em paste grande (mesma pegadinha 42601 da Wave 26 de RLS); pra SQLs futuros, preferir statements em linha única no chat. Client grava via `lib/services/pushTokens.ts` + `<NativePushOptIn>` no ProfileFooter (só aparece na casca com plugin). O ENVIO server-side via FCM AGORA EXISTE em código: `lib/api/_services/fcm.ts` (FCM HTTP v1, RS256 JWT no edge, zero deps) plugado no `/api/push-notify` como canal NATIVO independente do web push (VAPID) — cada canal envia sozinho, sem 503 se um faltar. Faltava só CONFIG (não código): projeto Firebase + `google-services.json`/`GoogleService-Info.plist` no nativo + 3 envs Secret no CF Pages (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`) + APNs Auth Key no Firebase pra iOS. Ver `docs/NATIVE_BRIDGE.md`. Deps dos plugins Capacitor já no package.json da raiz; `npx cap add android`/`cap sync` é na máquina de build (SDK nativo, não roda no remoto).

### Onda A de capacidades nativas (2026-09-04, PR #178) — "parar de parecer site"
4 plugins novos na RAIZ (`@capacitor/{haptics,status-bar,splash-screen,keyboard}`, acessados só via `window.Capacitor`, nunca importados no bundle web) + wrappers em `lib/native/` (`haptics`/`statusBar`/`splash`/`keyboard`/`appState`) + componente `<NativeChrome>` montado no `AppShell` (inicializa StatusBar temática, Keyboard `resize:native`, esconde a splash no 1º frame, reaplica StatusBar no `resume`). Háptico fiado em: trocar aba (BottomNav), curtir e salvar (`usePostInteractions` onMutate), publicar (`usePublishPost` onSuccess). Config de Splash/Keyboard no `capacitor.config.ts`. Tudo feature-detected com fallback web (`navigator.vibrate` p/ haptics; no-op p/ o resto) — 12 testes novos em `__tests__/native.test.ts`. **Só vale no aparelho com AAB novo** (plugin entra no bundle nativo). Doc: `docs/NATIVE_BRIDGE.md`.

### Onda B de capacidades nativas (2026-09-04, PR #180) — mídia robusta
Câmera NATIVA (`@capacitor/camera` getPhoto source CAMERA) vira o caminho PRINCIPAL do botão "tirar foto" em 3 telas (MediaUploader do publicar, EditProfileForm, SignupStep2) — pede a permissão real (aparece nos ajustes do app) e corrige EXIF/qualidade; `CameraCapture` (getUserMedia) fica de fallback quando o plugin não existe. `pickImagesNative` (novo em `lib/native/camera.ts`, plugin `pickImages`) = picker nativo de galeria, fiado nos fluxos SÓ-IMAGEM (avatar do editar/signup) via `onClick` do label com `preventDefault`+fallback pro `<input>`; **NÃO** no dropzone do composer porque `pickImages` é só-imagem e o composer aceita vídeo (regressão). Novo `lib/native/filesystem.ts` (`saveFileNative`+`blobToBase64`, plugin `Filesystem`→Documents) plugado no `shareOrDownloadImage` como caminho confiável de salvar imagem na WebView (antes do anchor que falha lá). PDF de orçamento é print-to-PDF (sem blob), então filesystem não se aplica a ele. `@capacitor/filesystem` novo na raiz; sem permissão nova no Manifest (pickImages usa o Photo Picker do sistema; Filesystem grava app-scoped). 9 testes novos; suíte 1492/1492. Só vale no aparelho com AAB novo.

### Onda C de capacidades nativas (2026-09-04, PR #181) — utilidades
Wrappers novos em `lib/native/`: `network` (plugin Network + eventos web), `clipboard` (plugin Clipboard → Web Clipboard → execCommand), `browser` (`openExternal` via plugin Browser/Custom Tab — DIFERENTE de `lib/utils/openInBrowser`, que é o escape-hatch `intent:` pra sair pro Chrome), `device` (`getDeviceInfo` de Device+App) e `badge` (`setAppBadge` via `@capawesome/capacitor-badge`). Componentes novos no `AppShell`: `<OfflineBanner>` (faixa "sem conexão") e `<NativeBadge>` (nº no ícone = não-lidas de aviso+mensagem). `PostActions` passou a compartilhar/copiar pelos wrappers (share nativo → Web Share → copiar). `DiagView` mostra modelo/OS/versão/build nativos. Plugins novos na raiz: `@capacitor/{network, clipboard, device}` + `@capawesome/capacitor-badge`. Sem permissão nova no Manifest. 16 testes novos; suíte 1502/1502. Só vale no aparelho com AAB novo. **Onda D NÃO será feita (decisão do usuário).**

### Boot logado quebrou — assinatura realtime duplicada (2026-09-04, PR #184)
Depois da Onda C, todo usuário LOGADO caía em "Algo deu errado" (error boundary), no app E no Chrome; incognito também. Causa: o `<NativeBadge>` (Onda C) usa `useUnreadMessageCount` + `useUnreadNotificationCount`, mas o **TopNav já usava** o de mensagem e o **BottomNav já usava** o de notificação. O Supabase **deduplica canais realtime pelo NOME** (`msg-count:<uid>` / `notif-count:<uid>`): o 2º consumidor chamava `.on()` num canal já `subscribe()`-ado e estourava `cannot add postgres_changes callbacks after subscribe()`, que sobe pelo React até o error boundary. Fix: **nome de canal ÚNICO por instância** do hook (`useId()` no sufixo) — os dois hooks agora são reutilizáveis por N componentes. **REGRA: hook com canal realtime = nome único por instância** (`useId`), senão dois consumidores colidem. `next build`/tsc/vitest NÃO pegam (o mock de supabase não deduplica canal); só o console do navegador com o supabase real. Achado lendo o console (F12); `error.tsx` passou a gravar `render-error` na tabela `errors` p/ o próximo caso aparecer no /admin/errors sem depender do Sentry.

Câmera no fluxo de publicar: usa o sistema do `MediaUploader` já existente no main (`CameraCapture` + `useOfereceCamera` + recuperação de galeria) — NÃO o botão `native.camera` que a auditoria tinha proposto (superado). `lib/native/camera` fica como primitivo do bridge (testado), disponível pra outros usos.

## Apple rejeitou a build 17 (2.1 App Completeness) — tela "Sem conexão" no login social (2026-09-07)
No iPad da revisão, tocar em "Continuar com Apple" pintava o `offline.html` em tela cheia, com a internet funcionando. Não era alerta nativo nem falha de rede: era a `errorPath` da casca.

**O MECANISMO, lido no fonte do Capacitor (não deduzido):** `WebViewDelegationHandler.swift` → `decidePolicyFor` vê navegação de TOPO pra host fora de `server.allowNavigation`, entrega a URL ao sistema (`UIApplication.shared.open`) **e CANCELA** a navegação. O cancelamento chega em `didFailProvisionalNavigation`, e ali o Capacitor carrega a `errorPath` — o nosso `offline.html`. Ou seja: **toda navegação de topo pra fora do app vira "Sem conexão" na casca**, com internet perfeita.

**REGRA: dentro da casca, `window.location.href = <url externa>` é PROIBIDO.** O caminho seguro é `window.open(url,'_blank')`, que passa por `createWebViewWith` e abre no sistema SEM cancelar navegação nenhuma. Helper único: `abrirLinkExterno` em `lib/native/browser.ts`.
- **PEGADINHA: nesse caminho o `window.open` devolve `null` MESMO DANDO CERTO** (o delegate abre no sistema e retorna `nil` pro WebKit). Ler esse null como falha faz o app mostrar erro em cima de link que abriu — por isso o helper ignora o retorno quando é casca, e só confia nele no browser (onde null é bloqueio de pop-up de verdade).

**O gatilho no login:** `signInWithOAuth` caía pro fluxo web do supabase-js (que navega a própria WebView pro provedor) sempre que o fluxo nativo dizia `unavailable` — comentado no código como "corrida rara". Agora **não existe fallback dentro da casca**: ou o fluxo nativo funciona, ou a pessoa recebe uma frase acionável. 4 testes em `__tests__/components/AuthOAuthNativo.test.tsx`; 2 deles falham se o fallback voltar.

**A varredura achou o mesmo padrão em mais 4 lugares**, todos corrigidos: `mailto:` do orçamento (2 telas), o `if (!aba) location.href = wa.me` do PDF de orçamento e do `abrirDestino` — este último era gatilho GARANTIDO, porque na casca o `window.open` sempre devolve null — e o redirect do checkout do Mercado Pago (sem call site de UI hoje, corrigido do mesmo jeito).

**CASO FECHADO EM 2026-09-07, confirmado NO APARELHO pelo usuário** ("já funcionou"): login social entra e sair da conta não pinta mais a tela.

**Correção do diagnóstico anterior — quem consertou foi outra PR, não a que corrigiu o fallback web.** Se o login agora completa, o fluxo NATIVO estava disponível naquele iPad o tempo todo (com ele indisponível o app mostraria a frase de erro, não a tela de "Sem conexão"). Logo o velho código nunca chegou ao fallback web: o que quebrava era o PASSO SEGUINTE ao login dar certo — o `window.location.assign('/completar-perfil')`, navegação de DOCUMENTO, o mesmo buraco de sair da conta. **Uma causa só para os dois sintomas.** A regra da correção anterior continua valendo (fluxo web na casca É um perigo real, mecanismo lido no fonte do Capacitor), mas ela não era o gatilho deste caso. Registrado porque a próxima sessão precisa saber qual das duas correções carregou a correção de verdade.

A instrumentação FICA (`native.plugins()`, a linha "Login social nativo" no `/diag`, o tipo `oauth-fail` no `/admin/errors`): foi ela que permitiria distinguir os dois casos em um print, em vez de dedução. Da próxima rejeição, é o primeiro lugar a olhar.

### Sair da conta caía no mesmo buraco (2026-09-07) — a lição é maior que o login
O relato "acontece ao sair da conta também" MATOU a explicação de que o problema era URL externa: `/login` é o MESMO domínio. O que os dois casos têm em comum é serem navegação de DOCUMENTO, e na casca qualquer navegação de documento que falhe OU seja cancelada faz o Capacitor pintar a `errorPath`. Não é preciso saber POR QUE aquela navegação falhou pra saber que não fazê-la resolve.
- Telas agora trocam de tela por `router.push/replace` (SPA, não recarrega nada). Convertidos: os dois "Sair da conta", a exclusão de conta, os dois "enviar pelo chat" e o pouso do OAuth nativo em `/completar-perfil` (este era cruel: a pessoa concluía o login e via "Sem conexão").
- **O `queryClient.clear()` no logout NÃO é enfeite**: a recarga garantia de graça que nada em cache do dono anterior sobrevivia pro próximo login. Tirar a recarga sem isso seria trocar um bug por um vazamento.
- **REGRA, com teste que varre `app/` e `components/`** (`__tests__/lib/navegacao-documento.test.ts`): tela não escreve em `window.location`. Os usos legítimos vivem em `lib/` (o `intent:` do Android, o download do PDF por URL assinada, e o fallback web do `abrirLinkExterno`).

A correção NÃO precisa de build nova: o app carrega o site de `server.url`, então o deploy do Cloudflare Pages já entrega. Build nova só seria preciso se o defeito estivesse na casca.

## Microfone negado com a permissão ativa — faltava MODIFY_AUDIO_SETTINGS (2026-09-04, PR #204)
O Seu Zé dizia "Permissão de microfone negada" com o microfone CONCEDIDO na tela de permissões do Android. O `BridgeWebChromeClient` do Capacitor 6, ao receber `onPermissionRequest` de `AUDIO_CAPTURE`, pede **DUAS** permissões de uma vez — `MODIFY_AUDIO_SETTINGS` **e** `RECORD_AUDIO` — e só chama `request.grant()` se TODAS voltarem concedidas (o callback faz um AND sobre o Map de resultados). Permissão não declarada no Manifest o sistema nega na hora, **sem diálogo**: o AND dava false, a WebView recusava, e o `getUserMedia` rejeitava com `NotAllowedError`.

**REGRA: permissão que a WebView usa vem em PAR — conferir o que o Capacitor pede, não o que parece óbvio.** Ler `node_modules/@capacitor/android/.../BridgeWebChromeClient.java` antes de concluir que o Manifest está completo. `MODIFY_AUDIO_SETTINGS` é NORMAL: não abre diálogo, só precisa existir.

O `catch {}` mudo virou `mensagemDeMicrofone(e)` (lê o `name` do DOMException): bloqueio ≠ sem hardware ≠ ocupado por outro app. A frase de bloqueio NÃO afirma mais que a permissão está negada — ela pode estar concedida e quem recusou ser a WebView. Manifest tem 8 permissões e o teste `__tests__/microfone.test.ts` trava o par. **Só vale com AAB novo.**

## Push com o app fechado — TUDO codado, NADA ligado (2026-08-22)
Service worker (`public/sw.js`, handlers `push` + `notificationclick`), rota `/api/push-notify` e o componente `PushOptIn` já existem. O que faltava era configuração, em 4 passos: (1) gerar VAPID (`npx web-push generate-vapid-keys`); (2) 4 envs no CF Pages Production — `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (**plain text**, é lida no build), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_INTERNAL_SECRET` — e refazer o deploy; (3) rodar `/migrations/2026-06-11-push-subscriptions.sql` + os 2 inserts em `app_settings` (`push_notify_url`, `push_internal_secret`, este igual ao do CF); (4) cada aparelho toca "Ativar notificações" no perfil. **Sem a env pública o `PushOptIn` retorna null** — é por isso que a opção "não aparece" no celular.

**SQL Wave 36 — JÁ EXECUTADA** (verificado em 2026-08-29: trigger `trg_notify_on_message` existe e `notif_actor_label` também). O gatilho de push escuta `notifications`, e só `likes`/`comments` criavam linha lá: **mensagem de chat não gerava notificação nenhuma**, então nunca viraria push. Migration em `/migrations/2026-08-22-notify-on-message.sql` cria `trg_notify_on_message` (agrupa rajada: pula se já há aviso não lido do mesmo remetente nos últimos 5 min; `EXCEPTION WHEN OTHERS` pra falha em notificar nunca derrubar o INSERT da mensagem) e recria `dispatch_push_on_notification` mandando `type='message'` pro `/chat`.

iOS: só 16.4+ e **só em modo PWA** (Adicionar à Tela de Início).

**WebView não tem Web Push — nem iOS nem Android (2026-08-22).** O app empacotado (Capacitor) roda em WebView, então TODO o caminho web push acima só vale pra quem usa pelo navegador/PWA. O `PushOptIn` agora **some** quando o ambiente não suporta, em vez de mostrar "instale como app na tela inicial" — dica sem sentido pra quem já está num app instalado. Push no app das lojas exige push NATIVO (plugin `@capacitor/push-notifications` + FCM/APNs, tabela de tokens e envio via FCM no servidor); foi entregue logo depois (ver Wave 39 acima). Backend web push validado ponta a ponta em 2026-08-22: `{"ok":true,"sent":0,"total":0}` (200, sem inscritos).

## Logos do app aparecem no /portal (Camisetas) — 2026-08-22
Antes, o que o pintor gerava com o Seu Zé ("Gerar Logo") era uma **data URL base64** de ~1.5MB que só existia no state da tela; as 2 variantes não escolhidas sumiam e a loja não tinha como saber qual arte estampar. Agora `/api/generate-logo` materializa cada imagem no bucket `posts` (`<userId>/logos/<uuid>.png`, via service_role) e grava uma linha em `brand_logos` com dono + prompt. O upload "Já tenho meu logo" faz o mesmo pelo cliente (`lib/services/brandLogos.ts`) e o path deixou de ser fixo (`business_logo.<ext>` com upsert apagava o arquivo antigo e invalidava o histórico).
- **Persistir é best-effort**: se o storage/insert falhar, a rota devolve as data URLs da IA como antes — nunca custar ao pintor o logo recém-gerado.
- No app, a tela Camisetas ganhou "🗂️ Meus logos" — o mesmo histórico, tocar aplica o logo no perfil.
- **SQL Wave 37 — JÁ EXECUTADO no Supabase (2026-08-22)**: `/migrations/2026-08-22-brand-logos.sql`. Cria `brand_logos` (RLS owner + `is_portal_admin()` pra SELECT), índice único `(user_id, md5(image_url))` pra retry não duplicar, backfill do `business_logo_url` atual e **recria `cleanup_orphan_media()`** — a versão da Wave 5 considerava órfão TODO arquivo do bucket `posts` sem post, o que incluía os logos.
- Detalhe completo do lado galeria/portal (busca, badge IA/Enviado, "★ logo atual", "Usar na camiseta") em [[Portal - Pessoas, Produtos e Ferramentas]].

---
## Ver também
[[Segurança - Mobile (Capacitor Android iOS)]] · [[Segurança - Firebase FCM e Push]] · [[Mobile - Bugs de WebView e Picker]] · [[Auth - OAuth, Cadastro e RLS de Sessão]] · [[Portal - Pessoas, Produtos e Ferramentas]]
