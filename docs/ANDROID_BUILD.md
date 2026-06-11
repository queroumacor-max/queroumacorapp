# Android Build Guide (TWA via Bubblewrap)

Guia passo-a-passo para empacotar o QueroUmaCor como app Android via
**Trusted Web Activity (TWA)** usando Bubblewrap, publicar no Google Play e
manter atualizado.

> **Estado atual (2026-06-11):** Scaffold pronto. Falta: criar conta Google
> Play Developer, gerar keystore, atualizar SHA-256 nos 3 arquivos abaixo,
> rodar `bubblewrap build` numa máquina com Android SDK + JDK 17. Estimativa
> até primeiro upload no internal testing: **~4-6h de trabalho do operador**
> (a maior parte é espera de propagação DNS/assetlinks + review Google).

---

## Pré-requisitos

- **JDK 17+** (recomendado: Temurin 17 LTS)
- **Android SDK** (via Android Studio Hedgehog+ ou cmdline-tools)
- **Bubblewrap CLI**: `npm install -g @bubblewrap/cli`
- **Node 18+** (Bubblewrap exige)
- **Conta Google Play Developer** ($25 one-time — pago pela Cali Colors)
- **Cofre de senhas** pra guardar a keystore + senha (sem ela, app fica órfão
  no Play Store e ninguém consegue atualizar nunca mais)

---

## Setup inicial

### Opção A — `bubblewrap init` puxando do manifest publicado

```bash
bubblewrap init --manifest=https://queroumacor.com.br/manifest.webmanifest
```

- Quando perguntar `Application ID`, confirme `com.calicolors.queroumacor`.
- Aceite os defaults exceto onde diverge de `twa-manifest.json` deste repo
  (cores, ícones, shortcuts — copiar manualmente dos valores do JSON).

### Opção B (preferida) — importar `twa-manifest.json` deste repo

1. `mkdir ~/queroumacor-android && cd ~/queroumacor-android`
2. Copie `twa-manifest.json` deste repo pra dentro da pasta.
3. Rode `bubblewrap update` — Bubblewrap detecta o manifest e gera o projeto
   Android (Gradle, Kotlin, resources) a partir dele.

> A Opção B é determinística: o JSON deste repo é a fonte da verdade,
> qualquer dev faz um build idêntico.

### Gerar keystore

```bash
bubblewrap build
```

- Vai pedir senha de keystore (mínimo 6 chars) + senha de alias.
- Cria `android.keystore` na pasta do projeto.

> **CRÍTICO:** Suba o `android.keystore` + as duas senhas pro cofre da
> Cali Colors (1Password / Bitwarden / o que estiverem usando). Anote
> também:
>
> - alias: `android` (default do Bubblewrap)
> - keystore type: PKCS12
> - validade: 25+ anos
>
> Sem keystore, o Play Store recusa atualizações (assinatura não bate) e
> o app vira tijolo. Considere também ativar **Play App Signing**
> (Google guarda a chave de upload e re-assina com a chave do Play —
> mais seguro que keystore manual).

---

## Extrair SHA-256 e atualizar `assetlinks.json`

1. Extraia o fingerprint:

   ```bash
   keytool -list -v -keystore android.keystore -alias android
   ```

   Digite a senha. Procure a linha:

   ```
   SHA256: XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX
   ```

2. **Substitua em TRÊS arquivos do repo** (PR único, merge pra `main`,
   espere o deploy do Cloudflare Pages):

   - `/.well-known/assetlinks.json` (raiz — servido por Cloudflare Pages
     na rota especial)
   - `/next-app/public/.well-known/assetlinks.json` (Next serve daqui)
   - `/twa-manifest.json` (campo `fingerprints[0].value`)

3. **Os 2 primeiros assetlinks também precisam ter o `package_name`
   trocado** de `br.com.queroumacor` (placeholder atual, NÃO é o bundle
   ID oficial) pra `com.calicolors.queroumacor`. Se ainda não foi feito,
   esse PR é a hora.

4. Deploy `main` → Cloudflare Pages publica → aguarde ~90s.

5. Verifique se o `assetlinks.json` está servido em
   `https://queroumacor.com.br/.well-known/assetlinks.json` com
   `Content-Type: application/json` (Cloudflare Pages serve estático
   direto; não precisa rewrite). Se vier 404, ver `_headers` /
   `_redirects` pra garantir que `.well-known/` não está sendo
   bloqueado.

6. Re-rode `bubblewrap build` → gera `app-release-bundle.aab` pronto pra
   upload.

> **DESTAQUE:** O `assetlinks.json` atualmente comitado no repo tem
> **2 valores placeholder que vão bloquear o app de abrir como TWA**:
>
> 1. `package_name: br.com.queroumacor` (errado — o bundle ID oficial é
>    `com.calicolors.queroumacor`)
> 2. `sha256_cert_fingerprints[0]` está com um hash placeholder
>    (`D5:0E:E0:09:...:39`) que não corresponde a nenhuma keystore real
>
> **Ambos precisam ser substituídos pelos valores reais antes do
> primeiro build de production.** Sem isso, o Chrome abre o app em
> Custom Tab (com barra de URL visível) em vez de TWA fullscreen, e o
> Play Console pode rejeitar a verificação Digital Asset Links.

---

## Validar Digital Asset Links

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://queroumacor.com.br&relation=delegate_permission/common.handle_all_urls
```

Resposta esperada:

```json
{
  "statements": [
    {
      "source": {
        "web": { "site": "https://queroumacor.com.br" }
      },
      "relation": "delegate_permission/common.handle_all_urls",
      "target": {
        "androidApp": {
          "packageName": "com.calicolors.queroumacor",
          "certificate": {
            "sha256Fingerprint": "XX:XX:..."
          }
        }
      }
    }
  ]
}
```

Se vier `"statements": []`, o assetlinks ainda não propagou ou está
inválido — espere até 24h e re-verifique.

---

## Google Play Console — Internal testing track

1. **Criar app**: Play Console → All apps → Create app → nome
   `QueroUmaCor`, idioma default `pt-BR`, app, free.
2. **Setup → Pricing & distribution**:
   - Free
   - Países: começar com **Brasil** apenas (depois expandir conforme
     vocês escalarem suporte)
3. **Setup → App content** (preenchimento obrigatório antes de qualquer
   release):
   - **Privacy policy**: `https://queroumacor.com.br/info/privacidade`
   - **Account deletion**: `https://queroumacor.com.br/delete-account`
     (página específica pra LGPD — Google exige link direto, não pode
     ser parte da privacy policy)
   - **Ads**: nenhum
   - **App access**: marcar "All functionality is available without
     restrictions" se a maior parte do feed é público; senão, criar
     conta dummy de teste e informar credenciais
   - **Content rating**: preencher questionário IARC. Para QueroUmaCor:
     UGC moderado (chat + posts com moderação), sem violência/sexo
     explícito, sem álcool/drogas → tende a sair **Livre / 10+**
   - **Target audience and content**: 16+ (justificativa: cadastro de
     CPF + transações financeiras + plataforma profissional)
   - **News app**: não
   - **Data safety**: preencher conforme `RELEASE_AUDIT.md` seção
     "Google Play Data Safety". Resumo: coletamos email, nome, foto,
     localização aprox., dados de pagamento (via Mercado Pago, não
     armazenados); criptografia em trânsito (HTTPS) e em repouso
     (Supabase); user pode deletar conta (linkar `/delete-account`)
4. **Internal testing** → Create new release:
   - Upload `app-release-bundle.aab`
   - Release name: `1.0.0 (1)` (matches `appVersion`/`appVersionCode`)
   - Release notes: "Primeira versão. Feed, orçamento IA, perfil de
     pintor, chat."
5. **Testers**: criar lista de email (até 100 nesta track) — convidar
   internamente Cali Colors team + amigos pintores pra dogfood.
6. **Review**: Google revisa internal testing em **1-3h** (vs. 1-7
   dias pra production). Status fica em "Pending publication" depois
   "Published".
7. **Distribuição**: tester pega o link especial (gerado em "How
   testers join your test"), instala via Play Store no celular, app
   abre como TWA (sem barra de URL).

---

## Promoção para Production

Trajeto: **Internal → Closed → Open → Production**.

- **Closed testing**: testers via email/Google Group, até 100 por
  grupo, vários grupos permitidos.
- **Open testing**: público via opt-in (link público), tester aparece
  como "Early Access" na Play Store.
- **Production**: visível pra todo mundo no Brasil/mundo.

Cada step requer Google review:
- Internal: 1-3h
- Closed/Open: 1-3 dias
- Production: 1-7 dias (primeira vez) / horas (atualizações)

**Pre-launch report**: Google roda o app em ~20 devices reais (Pixel,
Samsung, Xiaomi etc.) antes de aprovar production. Vão checar crashes,
performance, ANRs. Resultado em "Pre-launch report" no console. Se
falhar, **dá pra promover mesmo assim** se o crash for em device
exótico, mas avisa pendência.

---

## Play Billing (C1 do RELEASE_AUDIT.md)

- TWA suporta **Google Play Billing** via **Digital Goods API** desde
  que `packageId` casa entre TWA e PWA, e que a página
  `https://queroumacor.com.br/manifest.webmanifest` tenha
  `related_applications` apontando pro app Android.
- Feature flag `playBilling.enabled: true` já está em
  `twa-manifest.json`.
- Detalhes da estratégia de cobrança (Mercado Pago vs. Play Billing,
  qual usar onde) vão estar em `docs/BILLING_STRATEGY.md` (outro
  trabalho em paralelo).
- **Importante:** Google **exige** Play Billing pra cobrança de
  "digital goods" consumidos dentro do app (assinatura PRO, créditos
  de IA, boosts). Cobrança de "serviços físicos" (orçamento de
  pintura) **pode** continuar via MP. Ler a [política de
  pagamentos](https://support.google.com/googleplay/android-developer/answer/9858738)
  com atenção — descumprir = app removido.

---

## Scripts npm sugeridos (opcional)

Não estão adicionados ao `package.json` deste repo por enquanto (é
decisão de tooling local — quem desenvolve Android local prefere alias
diferente). Sugestão de scripts:

```json
{
  "scripts": {
    "android:init": "bubblewrap init --manifest=https://queroumacor.com.br/manifest.webmanifest",
    "android:update": "bubblewrap update",
    "android:build": "bubblewrap build",
    "android:install": "bubblewrap install"
  }
}
```

Adicione no repo Android (pasta separada do PWA) se for útil. Esse
repo (PWA Next.js) não roda Bubblewrap.

---

## Troubleshooting

### "App opens in browser instead of TWA"
- Digital Asset Links não validou. Re-verifique:
  - `assetlinks.json` retorna 200 + JSON válido em
    `https://queroumacor.com.br/.well-known/assetlinks.json`
  - `package_name` no JSON = `com.calicolors.queroumacor`
  - Fingerprint no JSON = `keytool -list` output (case insensitive,
    com `:` separadores)
- Aguarde 24h pra Chrome cachear de novo.
- Limpe storage do Chrome no device: Settings → Apps → Chrome →
  Storage → Clear cache.

### "Push notifications not arriving"
- TWA herda Push API do Chrome. User precisa estar logado no Chrome
  com o mesmo perfil onde concedeu permissão de push.
- Se virar problema sistêmico, considerar migrar pra FCM nativo via
  TWA notification delegation (mais complexo, requer Firebase project).

### "Build fails: keystore not found"
- Confirme `android.keystore` na raiz do projeto Bubblewrap
  (~/queroumacor-android/, não no repo do site).
- Re-rode `bubblewrap build` com `--signingKeyPath=./android.keystore
  --signingKeyAlias=android`.

### "Build fails: SDK location not found"
- Defina `ANDROID_HOME` ou crie `local.properties` com
  `sdk.dir=/path/to/android-sdk`.

### "Google Play rejects AAB: SHA-256 mismatch"
- O assetlinks ainda tem o fingerprint placeholder. Re-suba o
  assetlinks corrigido **antes** de rebuilder e re-uploader.

### "Play Console: this release is signed with the wrong key"
- Você gerou um keystore novo sem ativar Play App Signing. Não dá pra
  recuperar — ou rola Play App Signing key reset (Google permite **1
  vez** por app, com prova de identidade), ou cria app novo no
  console.

---

## Checklist final antes de ir pro Production

- [ ] Keystore guardada em cofre (com senha)
- [ ] Play App Signing ativado
- [ ] SHA-256 real em `assetlinks.json` (raiz + `next-app/public/`) +
      `twa-manifest.json`
- [ ] `package_name` em ambos `assetlinks.json` está
      `com.calicolors.queroumacor` (não o placeholder
      `br.com.queroumacor`)
- [ ] Digital Asset Links validador retorna statement válido
- [ ] Privacy policy + delete account URL respondem 200
- [ ] Data safety form preenchido completo
- [ ] Content rating IARC concluído
- [ ] Ícones 192/512/maskable/monochrome existem nos paths do manifest
- [ ] Internal testing track rodou por pelo menos 1 semana sem crash
      crítico
- [ ] Pre-launch report sem ANRs
- [ ] Versão semantic: bumpou `appVersion` + `appVersionCode` no
      `twa-manifest.json`
- [ ] Release notes em pt-BR escritas
