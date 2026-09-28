# iOS Build — QueroUmaCor

Como o app iOS e construido hoje. Ele sai **deste repo**, como casca Capacitor,
pelo Codemagic. Nao precisa de Mac.

> **Historico:** ate 09/2026 o app da App Store vinha do repo privado
> `queroumacor-ios` — um wrapper WebIntoApp, WebView pura, sem camera, push ou
> OAuth nativo. A versao 1.2.0 substituiu aquele binario. O repo antigo e o
> WebIntoApp estao DESCONTINUADOS: nao sao plano B, nao buildar de la.

---

## 1. O essencial

| | |
|---|---|
| Bundle ID | `br.com.queroumacor.app` |
| Apple ID do app | `6784256495` |
| Team ID | `FBFCU5H5B5` |
| Projeto Firebase | `queroumacor-245ef` (o MESMO do Android) |
| Build | Codemagic, workflow **iOS IPA (Capacitor)** |
| Destino | TestFlight (producao continua manual) |

O app **nao embarca o site**. O `capacitor.config.ts` aponta `server.url` pra
`https://www.queroumacor.com.br`, entao mudanca no Next.js chega ao app pelo
deploy do site (workflow `deploy.yml`, disparo manual -> Worker
`queroumacor-next-production` no Cloudflare), **sem rebuild**. So rebuilde ao mexer em plugin
nativo, permissao, icone, splash ou no proprio `capacitor.config.ts`.

---

## 2. Como buildar

Codemagic -> app `queroumacorapp` -> **Start new build** -> branch `main` ->
workflow **iOS IPA (Capacitor)**.

Sem `triggering` no yaml: so roda no botao. ~4 min com cache quente. Depois a
Apple processa por 5-30 min ate a build aparecer no TestFlight.

O que o workflow faz, em ordem:

1. `npm ci`
2. escreve `ios/App/App/GoogleService-Info.plist` a partir da variavel
   `GOOGLE_SERVICE_INFO_PLIST` (base64) — falha explicito se ela estiver vazia
3. cria um `webDir` placeholder e roda `npx cap sync ios` (que roda `pod install`)
4. `xcode-project use-profiles` (assinatura)
5. `CFBundleVersion` = maior build do TestFlight + 1
6. `xcode-project build-ipa` — em caso de falha, imprime as linhas `error:` do
   log do xcodebuild direto no Codemagic
7. sobe no TestFlight e manda e-mail

---

## 3. O que e versionado e o que e gerado

O projeto Xcode **esta no repo**. Foi gerado uma vez com `npx cap add ios` e
commitado.

```
ios/App/
├── Podfile                  versionado
├── App.xcodeproj/           versionado (inclui xcshareddata/xcschemes/App.xcscheme)
├── App.xcworkspace/         versionado
└── App/
    ├── Info.plist           versionado — CURADO, nao sobrescrever
    ├── PrivacyInfo.xcprivacy versionado — CURADO
    ├── AppDelegate.swift    versionado — CURADO (ver secao 6)
    ├── Assets.xcassets/     versionado (icone 1024 + splash 2732)
    ├── Base.lproj/          versionado (Main + LaunchScreen)
    ├── GoogleService-Info.plist   NAO versionado — escrito pela build
    ├── public/                    NAO versionado — gerado por `cap sync`
    ├── capacitor.config.json      NAO versionado — gerado por `cap sync`
    └── config.xml                 NAO versionado — gerado por `cap sync`
```

**Nao rode `npx cap add ios` de novo.** Ele recusa quando `ios/` existe, e se
voce apagar a pasta pra forcar, perde os arquivos curados. Pra atualizar plugins
use `npx cap sync ios`.

Se um dia for MESMO necessario regenerar: compare cada arquivo curado com o
template antes de sobrepor. O template fica em
`node_modules/@capacitor/cli/assets/ios-pods-template.tar.gz`.

---

## 4. Configuracao fora do repo

Nada de config sensivel vive aqui. Tudo em painel:

| O que | Onde |
|---|---|
| `GOOGLE_SERVICE_INFO_PLIST` (base64) | Codemagic -> Environment variables -> grupo `firebase`, Secure |
| Assinatura + upload | Codemagic -> Integrations -> App Store Connect, integracao `codemagic` |
| Provisioning profile | Codemagic -> Personal account settings -> Code signing identities |
| Chave APNs (.p8) | Apple Developer -> Keys; subida no Firebase -> Cloud Messaging |

Mesma convencao do `google-services.json` do Android: o arquivo nao entra no
repo, a build materializa.

---

## 5. Versao e numero de build

- **Versao** (`CFBundleShortVersionString`): escrita a mao no
  `ios/App/App/Info.plist`. Suba antes de submeter uma versao nova pra loja.
- **Build number** (`CFBundleVersion`): automatico, `ultimo do TestFlight + 1`.
  Nunca repete, nem entre o app antigo e este — os dois vivem no mesmo Apple ID.

---

## 6. ARMADILHAS — leia antes de mexer

### 6.1 Nao adicione metodos de `UISceneSession` ao AppDelegate

Se o `AppDelegate` declarar `application(_:configurationForConnecting:options:)`,
o UIKit adota o ciclo de vida de scenes e **abandona** o caminho legado que cria
a janela a partir de `UIMainStoryboardFile`. Como o `Info.plist` nao tem
`UIApplicationSceneManifest` e o projeto nao tem SceneDelegate, a scene sobe sem
delegate e sem storyboard: **nenhuma janela e criada, nada e desenhado, e o app
NAO crasha**. Tela preta permanente, sem log de crash.

Foi o bug das builds 10 a 13 (04/09/2026). Sintoma exclusivo do iOS — no Android
nao existe esse conceito, e a mesma build abria normalmente la.

### 6.2 Provisioning profile guardado no Codemagic tem precedencia

Enquanto existir um perfil em **Code signing identities -> iOS provisioning
profiles** que case com o bundle ID, o passo "Set up code signing identities"
instala ELE e a API da Apple **nem e consultada**.

Consequencia: apagar, regerar ou criar um perfil novo no portal da Apple **nao
muda nada** se o guardado continuar la. Pra trocar de verdade: apagar a entrada
no Codemagic e reimportar com **Fetch profiles**.

Como reconhecer: o erro do xcodebuild cita um perfil por nome. Se esse nome nao
existe mais na Apple, o arquivo esta vindo do Codemagic.

### 6.3 Ligar capability no App ID invalida os profiles

Habilitar Push Notifications (ou qualquer capability) no App ID invalida
imediatamente todos os provisioning profiles existentes. Regenere o perfil
**antes** de rodar a build, ou ela quebra no archive com
`doesn't include the aps-environment entitlement`.

### 6.4 App-Bound Domains

`limitsNavigationsToAppBoundDomains: true` + `WKAppBoundDomains` no `Info.plist`
restringem a WebView aos dominios listados. O que fica de fora e bloqueado em
SILENCIO e chega no JS como falha de rede generica. Se uma tela reclamar de
"sem conexao" com a internet boa, o suspeito e um dominio faltando na lista.
Limite da Apple: 10 dominios.

Essa chave tambem **habilita service workers** na WKWebView — que no Android nao
rodam na casca. Ou seja, o `sw.js` roda no app do iPhone e nao no do Android.

### 6.5 Icone

Layout single-icon do Capacitor 6: um unico `AppIcon-512@2x.png`, 1024x1024,
**RGB sem canal alpha** e **sem cantos arredondados** (o iOS aplica a mascara).
PNG com transparencia e recusado no upload; cantos arredondados embutidos deixam
farelo nas quinas.

---

## 7. Quando a build falha

O passo `Build IPA assinado` imprime as linhas `error:` do xcodebuild no proprio
log do Codemagic. Comece por elas.

| Erro | Causa provavel |
|---|---|
| `doesn't include the aps-environment entitlement` | perfil desatualizado — ver 6.2 e 6.3 |
| `GOOGLE_SERVICE_INFO_PLIST vazio` | variavel nao cadastrada no grupo `firebase` |
| `Failed to archive` sem mais nada | o passo perdeu o dump de erros; restaurar o bloco `if ! xcode-project build-ipa` |

App preto no device, sem log de crash em Ajustes -> Privacidade -> Analise e
Melhorias -> Dados de Analise: quase sempre inicializacao nativa, nao o site.
Teste separando os dois — aponte a casca pra um bundle local; se nem ele pintar,
o site esta fora da conversa.

---

## 8. Regras que ja custaram review/producao

- **Navegacao de documento e proibida dentro da casca.** Toda navegacao de topo
  que falha ou e cancelada (link externo, `window.location.href = ...`, reload
  de pagina) faz o Capacitor pintar o `offline.html` em tela cheia, com a
  internet boa. Foi a rejeicao 2.1 da build 17 (07/09/2026). Tela troca de rota
  com `router.push/replace`; link externo passa por `abrirLinkExterno`
  (`lib/native/browser.ts`). O teste `__tests__/lib/navegacao-documento.test.ts`
  trava isso.
- **Login social so pelo fluxo nativo** (browser do sistema + deep link
  `br.com.queroumacor.app://auth/callback`, PKCE). Sem fallback pro fluxo web
  dentro da casca.
- **Nao ha compra dentro do app** (PRO por pontos, loja fecha a venda fora do
  app) — Guideline 3.1.1/3.1.3(e) atendidas. Se um dia voltar a vender algo
  digital no iOS, e StoreKit; ver `BILLING_STRATEGY.md`.
- Sessao do Supabase: `hybridAuthStorage` (localStorage + cookies) cobre o
  apagamento do ITP. Fallback offline: `offline.html` gerado pela build (passo 3).
