# iOS Build — QueroUmaCor (Capacitor wrapper)

Guia passo-a-passo para um dev iOS levar o PWA QueroUmaCor para o
TestFlight e App Store Connect. Cobre **C2 (wrapper Capacitor)** e
**C7 (Privacy Manifest)** do `RELEASE_AUDIT.md`.

> **Estado deste repo:** os arquivos versionados (`capacitor.config.ts`,
> `ios/App/App/Info.plist`, `ios/App/App/PrivacyInfo.xcprivacy`,
> `ios/App/App/AppDelegate.swift`,
> `ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`) são o
> **scaffold curado**. Eles devem ser copiados POR CIMA dos arquivos
> que `npx cap add ios` gera, porque o boilerplate Capacitor não inclui
> Privacy Manifest e usa Info.plist genérico.

---

## 1. Pré-requisitos (uma vez)

| Item | Como obter |
|---|---|
| macOS 14+ | Hardware Apple ou VM macOS legal |
| Xcode 15+ | Mac App Store (gratuito) |
| CocoaPods | `sudo gem install cocoapods` |
| Node.js 20+ | `nvm install 20` |
| Conta Apple Developer ($99/ano) | https://developer.apple.com/programs/ |
| Bundle ID registrado | Apple Developer → Certificates, Identifiers & Profiles → Identifiers → `+` → App IDs → Bundle ID `com.calicolors.queroumacor`. Habilitar **Push Notifications** capability. |
| APNs Key (.p8) | Apple Developer → Keys → `+` → "Apple Push Notifications service (APNs)". Baixar o `.p8` UMA VEZ e guardar — não dá pra rebaixar. Anotar o Key ID e o Team ID. |

---

## 2. Setup do projeto (clone fresco)

```bash
# 1. Clonar e instalar deps base
git clone https://github.com/calicolors/queroumacorapp.git
cd queroumacorapp

# 2. Instalar Capacitor + plugins necessários
npm install \
  @capacitor/core@^6 \
  @capacitor/cli@^6 \
  @capacitor/ios@^6 \
  @capacitor/push-notifications@^6 \
  @capacitor/status-bar@^6 \
  @capacitor/splash-screen@^6 \
  @capacitor/app@^6

# 3. Gerar boilerplate do projeto iOS
#    Lê capacitor.config.ts e cria ios/App/App.xcworkspace + Pods.
npx cap add ios
```

> **Nota:** se for a primeira vez no host, o `cap add ios` roda `pod
> install` automaticamente — pode demorar 5-10 minutos.

---

## 3. Aplicar arquivos curados POR CIMA do boilerplate

O `cap add ios` sobrescreve com versões genéricas. Restaure os arquivos
do repo:

```bash
# Estes ARQUIVOS já existem no git — restaurar caso o cap add os tenha
# sobrescrito:
git checkout HEAD -- \
  ios/App/App/Info.plist \
  ios/App/App/PrivacyInfo.xcprivacy \
  ios/App/App/AppDelegate.swift \
  ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json
```

---

## 4. Gerar ícones e splash

O `next-app/public/icon-512.png` já está versionado. Use o
`@capacitor/assets` pra gerar todos os tamanhos esperados pela
Apple:

```bash
npm install --save-dev @capacitor/assets

# A partir da raiz do repo:
npx @capacitor/assets generate \
  --iconBackgroundColor='#1a1a2e' \
  --iconBackgroundColorDark='#1a1a2e' \
  --splashBackgroundColor='#1a1a2e' \
  --splashBackgroundColorDark='#1a1a2e' \
  --assetPath next-app/public
```

> O comando lê `next-app/public/icon-512.png` e popula
> `ios/App/App/Assets.xcassets/AppIcon.appiconset/*.png` nos 18 tamanhos
> mapeados em `Contents.json`. Se você renomeou os arquivos, atualize o
> `Contents.json` ou rode o comando com `--logoSourceImage`.

---

## 5. Configurar Signing & Capabilities

1. Abra o workspace:
   ```bash
   open ios/App/App.xcworkspace
   ```
2. No Xcode → selecione o target **App** → **Signing & Capabilities**.
3. **Team:** selecione o Apple Developer Team da Cali Colors.
4. **Bundle Identifier:** confirme que é `com.calicolors.queroumacor`.
5. Clique **+ Capability** e adicione:
   - **Push Notifications**
   - **Background Modes** → habilite **Remote notifications**
6. Configure o APNs no servidor de push (Supabase Edge Function ou
   Cloudflare Worker — sprint C8 pendente). Variáveis necessárias:
   - `APNS_TEAM_ID`
   - `APNS_KEY_ID`
   - `APNS_PRIVATE_KEY` (conteúdo do `.p8` em formato PEM)
   - `APNS_BUNDLE_ID=com.calicolors.queroumacor`
   - `APNS_PRODUCTION=true` (uma vez em TestFlight)

---

## 6. Sincronizar mudanças do JS (cada vez que o JS muda)

Como a app é PWA hosted, **não precisamos rebuildar nativo a cada
mudança no Next** — o WebView carrega `https://queroumacor.com.br`
direto. Mas se você mudar `capacitor.config.ts`, plugin nativo, ou
qualquer arquivo em `ios/`:

```bash
npx cap sync ios
```

Isso reinstala Pods, atualiza configs, e regenera o
`capacitor.config.json` que o nativo lê em runtime.

---

## 7. Build local pra simulator

No Xcode:

1. Selecione um simulator no scheme picker (ex.: **iPhone 15 Pro**).
2. **Cmd+R** — compila e roda.
3. O WebView abre `https://queroumacor.com.br` (não `localhost`).

Pra testar push notifications no simulator, use Xcode → Devices &
Simulators → arraste um JSON de payload APNs pro device window.

---

## 8. Archive & TestFlight

1. Selecione **Any iOS Device (arm64)** no scheme picker (NÃO um
   simulator).
2. **Product → Archive**.
3. Quando o Organizer abrir, clique **Distribute App** →
   **App Store Connect** → **Upload**.
4. Aguarde o processing (~10-30 min). O build aparece em
   App Store Connect → TestFlight.
5. Adicione testers internos (até 100 emails da equipe Cali Colors)
   ou criar grupo de beta externo (review prévio Apple ~24h).

---

## 9. Submissão App Store

Metadata pronto pra colar (vide `RELEASE_AUDIT.md` seção 2):

```
Nome (≤30 chars):     QueroUmaCor: Pintores PRO
Subtítulo (≤30):      Orçamento, IA e Agenda
Categoria primária:   Business
Categoria secundária: Productivity
Faixa etária:         12+ (UGC moderado)
Privacy Policy:       https://queroumacor.com.br/info/privacidade
Support URL:          https://queroumacor.com.br/info/ajuda
Marketing URL:        https://queroumacor.com.br
Copyright:            © 2026 CALICOLORS TINTAS LTDA
CNPJ controlador:     47.677.346/0001-92
```

Screenshots obrigatórias (App Store Connect → App Information):

| Device | Resolução | Mínimo |
|---|---|---|
| iPhone 6.7" (14/15/16 Pro Max) | 1290×2796 | 3 telas |
| iPhone 5.5" (8 Plus) | 1242×2208 | 3 telas (legado) |
| iPad Pro 12.9" | 2048×2732 | 3 telas |

Use o simulator de cada device + **Cmd+S** pra capturar.

---

## 10. StoreKit para PRO subscription (C1 — sprint separada)

Pra integrar Apple IAP da subscription PRO (R$ 9,90/mês), seguir o
documento **`docs/BILLING_STRATEGY.md`** (sendo escrito em paralelo).
Esse guia AQUI cobre só wrapper + Privacy Manifest. StoreKit envolve:

- Criar produto `com.calicolors.queroumacor.pro.monthly` em App Store
  Connect → Subscriptions
- Subscription Group: "PRO QueroUmaCor"
- Plugin `@capacitor-community/in-app-purchases` ou nativo
  StoreKit 2 via custom Swift bridge
- Servidor de validação de receipt (Supabase Edge Function)
- Webhook `App Store Server Notifications V2` apontando pra
  `/api/apple-iap-webhook`

**Não submeta sem StoreKit — Apple rejeita certo se PRO continuar via
Mercado Pago no wrapper iOS** (Guideline 3.1.1).

---

## 11. Troubleshooting

### "I have an iPad but no developer account"
A conta Apple Developer ($99/ano) é **obrigatória** pra instalar build
custom em device físico fora do simulator E pra submeter na App Store.
Sem conta paga, só simulator funciona, e nada vai pra TestFlight.

### "Push doesn't work in simulator"
Simulator iOS 16+ suporta push notifications, mas usa o ambiente APNs
**sandbox** (`api.sandbox.push.apple.com`). Garanta que o servidor de
push detecta o ambiente certo:
- Build de Debug → sandbox
- Build de Release (TestFlight + App Store) → produção

A flag `APNS_PRODUCTION` deve refletir isso. Se mandar payload sandbox
pra ambiente prod (ou vice-versa), APNs retorna `BadDeviceToken` e o
push some.

### "App rejected for IAP" (Guideline 3.1.1)
PRO subscription via Mercado Pago NO WRAPPER iOS é rejeição certa. Veja
`docs/BILLING_STRATEGY.md`. A web (`queroumacor.com.br` no Safari) pode
continuar com MP — só o wrapper nativo iOS precisa de StoreKit.

### "App rejected: missing PrivacyInfo.xcprivacy"
Confirme que `ios/App/App/PrivacyInfo.xcprivacy` está no target App
no Xcode (Build Phases → Copy Bundle Resources). O `cap add ios` NÃO
adiciona automaticamente — precisa arrastar pro Xcode na primeira vez,
ou adicionar via `File → Add Files to "App"...`.

### "WKWebView travado em tela branca"
Provavelmente Cloudflare bloqueou o user-agent ou a HSTS preload pin
não bate. Cheque o console Safari (Develop → Simulator → JSContext):
- Se vier `net::ERR_BLOCKED_BY_CLIENT`, verifique CSP do site.
- Se vier `App Bound Domain mismatch`, confirme que `WKAppBoundDomains`
  no Info.plist inclui o domínio que o webview tentou abrir (deep
  link externo conta).

### "Pod install falhou: SDK version mismatch"
```bash
cd ios/App
pod deintegrate
pod install --repo-update
```

Se persistir, atualize Xcode CLI tools:
```bash
sudo xcode-select --install
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

### "App Transport Security blocked"
Algum recurso (imagem, API) está sendo carregado via HTTP. Confirme
que tudo é HTTPS — não adicione exceções em `NSAppTransportSecurity`
sem necessidade absoluta (Apple revisa).

---

## 12. Checklist final pré-submissão

- [ ] `Info.plist` com TODAS as usage descriptions populadas
- [ ] `PrivacyInfo.xcprivacy` com data types corretos (revisar a cada
      feature nova que coleta dado)
- [ ] AppIcon: 18 PNGs gerados pelo `@capacitor/assets`
- [ ] LaunchScreen.storyboard com background `#1a1a2e` (Capacitor
      gera por padrão)
- [ ] Push capability adicionada no target App
- [ ] StoreKit configurado (subscription `pro.monthly` em ASC)
- [ ] Receipt validation server live (`/api/apple-iap-webhook`)
- [ ] Privacy Policy URL respondendo 200 em
      `https://queroumacor.com.br/info/privacidade`
- [ ] Support URL respondendo 200 em
      `https://queroumacor.com.br/info/ajuda`
- [ ] Screenshots 6.7" + 5.5" + iPad
- [ ] Conta Apple Developer ativa ($99/ano em dia)
- [ ] Build #1.0.0 (1) testado em TestFlight pelo menos 1 dispositivo
      físico
- [ ] Age gate validado: hard block para usuários <16 (sprint C5)
- [ ] CSAM scanning ativo no upload (sprint C4)
- [ ] Email verification enforçado (sprint C6)

---

## 13. Estimativa de tempo até primeira build TestFlight

Assumindo dev iOS experiente:

| Tarefa | Tempo |
|---|---|
| Criar conta Apple Developer + esperar aprovação | 1-2 dias |
| Setup Xcode + CocoaPods + clone | 1h |
| `npx cap add ios` + ajustes de signing | 1h |
| Aplicar arquivos curados deste repo | 30min |
| Gerar ícones + splash | 30min |
| Push capability + APNs key + servidor | 4h (excl. server) |
| Primeira build Debug em simulator | 30min |
| Primeira Archive + upload TestFlight | 1h |
| Apple processing | 10-30min |
| Testar em device físico via TestFlight | 1h |
| **TOTAL excluindo StoreKit** | **~2 dias úteis** |

Adicionar **+1 semana** se for incluir StoreKit (subscription PRO),
**+1 semana** se for incluir CSAM scanning e age gate. Submissão App
Store Review costuma levar 1-3 dias.
