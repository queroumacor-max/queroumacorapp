# RELEASE AUDIT — QueroUmaCor

**Data:** 2026-06-11
**Escopo:** Auditoria profunda 5 setores em paralelo — paridade IG/TikTok, Apple App Store, Google Play, segurança/abuso/moderação, polish UX/UI.
**Antecessor:** `LAUNCH_AUDIT.md` (production-readiness) — fechou 5/5 blockers críticos. Este aqui mira **release nas lojas**.

---

## 0. EXECUTIVE SUMMARY

**Estado consolidado:** **6.5/10 — não publicar nas lojas sem resolver 9 blockers críticos.**

A base funcional do app está **sólida** (LAUNCH_AUDIT.md fechou as falhas de RLS, vanilla deletado, LGPD endpoint). Mas pra publicar nas lojas Apple e Google, sobram **3 frentes de blockers**:

1. **Compliance de pagamentos** — PRO via Mercado Pago viola Apple Guideline 3.1.1 (rejeição certa) e tem risco médio na Google Play (depende de análise jurídica).
2. **Segurança de menores e UGC** — sem age gate, sem CSAM scanning, sem email verification enforçado. Bloqueia ambas lojas + risco LGPD-K.
3. **Wrapper nativo** — Capacitor (iOS/Android) inexistente; PWA não publica direto nas lojas.

Além disso, **gaps de retenção social** (sem push notifications, sem feed algorítmico, sem double-tap to like, sem animação de like) — app social morre na semana 2 sem isso.

### Tempo estimado pra ficar pronto

- **Apple Store**: 3-4 semanas (StoreKit + Privacy Manifest + Capacitor + age gate + CSAM)
- **Google Play**: 2-3 semanas (Bubblewrap + Data Safety + age gate + CSAM + Play Billing review)
- **UX polish + retention**: 2-4 semanas paralelo

### Recomendação estratégica

1. **Lançar primeiro no Google Play** (TWA mais barato que Capacitor iOS, política Play Billing menos rígida que Apple IAP).
2. **Apple Store em segunda fase** (depois de StoreKit pronto, ~6-8 semanas).
3. **Roadmap social paralelo** — push notifications + feed algorítmico nas primeiras 2 sprints.

---

## 1. CRITICAL BLOCKERS — PRIORIZADOS 🔴

| # | Blocker | Loja afetada | Esforço | Risco se ignorar |
|---|---|---|---|---|
| **C1** | **PRO via Mercado Pago viola IAP** | Apple (rejeita certo); Google (risco médio) | 1-2 semanas | Rejeição Apple Store; aviso Google Play |
| **C2** | **Capacitor/wrapper iOS inexistente** | Apple | 2-3 dias | Impossível publicar |
| **C3** | **AAB bundle setup inexistente** | Google | 2-3 dias | Impossível publicar |
| **C4** | **CSAM scanning (PhotoDNA) ausente** | Apple + Google | 1 semana | Rejeição certa; risco regulatório CSAM-NCMEC |
| **C5** | **Age gate inexistente** | Apple (1.6) + Google (Family Policy) + LGPD-K | 2-3 dias | Rejeição; multa LGPD; Sentry vira ilegal |
| **C6** | **Email verification não enforçado** | Compliance UGC ambas | 1 dia | Spam massivo + bot accounts + LGPD |
| **C7** | **Privacy Manifest iOS (.xcprivacy)** | Apple (Dec 2024+) | 1 dia | Rejeição review |
| **C8** | **Push notifications ausentes** | Retention (não bloqueia loja mas mata app) | 1 semana | Churn 2x na semana 2 |
| **C9** | **Account deletion web URL pra users desinstalados** | Google Play Policy | 4h | Aviso Google |

---

## 2. APPLE APP STORE

### 🔴 Bloqueia review
- **C1 — Subscription PRO via Mercado Pago**: Apple Guideline 3.1.1 obriga StoreKit/IAP pra conteúdo digital. Apple cobra 30% (15% após 1 ano).
  - **Fix**: integrar StoreKit 2 no wrapper Capacitor pra `com.calicolors.queroumacor.pro.monthly`. Manter Mercado Pago só pra loja física (tinta/camiseta).
- **C2 — Capacitor não configurado**: sem `capacitor.config.json`, sem pasta `ios/`. PWA não publica direto.
  - **Fix**: `npx cap init` + `npx cap add ios` + projeto Xcode.
- **C7 — Privacy Manifest** (`PrivacyInfo.xcprivacy`) obrigatório desde Dec 2024.
  - **Fix**: criar arquivo declarando NSUserDefaults, NSCameraUsageDescription, NSMicrophoneUsageDescription, NSLocationUsageDescription. Templates prontos no relatório.

### 🟡 Necessário antes da submissão
- Age gate <13 (Guideline 1.6) — também C5 abaixo
- Info.plist com `NSCameraUsageDescription`, etc.
- App Store metadata (nome ≤30 chars, subtitle ≤30, screenshots 6.7" iPhone 14 Pro Max + 5.5" + iPad)
- Conta Apple Developer ($99/ano)

### 🟢 OK / já tem
- Privacy Policy `/info/privacidade` ✓ (com CNPJ Cali Colors)
- Account Deletion in-app (Guideline 5.1.1(v)) — endpoint `/api/delete-account` ✓
- Moderation/Reporting/Blocking (Guideline 1.2) — Wave 18 + Wave 21 ✓
- Sign in with Apple — não precisa (email-only auth) ✓
- App Tracking Transparency (ATT) — não precisa (Sentry é só error logging) ✓
- Safe Area + Status Bar — `appleWebApp.statusBarStyle: 'black-translucent'` ✓
- Splash screen via manifest ✓

### Metadata ready-to-paste
```
Nome (30): QueroUmaCor: Pintores PRO
Subtitle (30): Orçamento, IA e Agenda
Categoria 1ª: Business
Categoria 2ª: Productivity
Age rating: 12+ (UGC moderado)
Privacy Policy URL: https://queroumacor.com.br/info/privacidade
Support URL: https://queroumacor.com.br/info/ajuda
```

---

## 3. GOOGLE PLAY (via TWA + Bubblewrap)

### 🔴 Bloqueia review
- **C1 — Play Billing vs Mercado Pago**: Google Play exige Play Billing pra "conteúdo digital exclusivo do app". PRO subscription cai nessa categoria → 15% commission.
  - **Fix**: análise jurídica primeiro. Recomendação: oferecer Play Billing no Android E manter Mercado Pago como fallback na web. Loja física segue com MP (exceção explícita).
- **C3 — AAB bundle setup**: sem wrapper Android (Bubblewrap, Capacitor).
  - **Fix**: `npm install -g @bubblewrap/cli` + `bubblewrap init` (alimenta manifest + assetlinks).
- **C5 — Age gate ausente**: `birth_date` coletado mas sem validação. Family Policy aplica se 13- usar → Sentry vira proibido.
- **C9 — Web URL pra account deletion**: pra users que desinstalaram o app. Hoje só funciona logado in-app.
  - **Fix**: criar página `/delete-account` com formulário de email + magic link.

### 🟡 Necessário antes da submissão
- Data Safety Form preenchido **completo**:
  - **Faltando declarar**: `birth_date`, `address`, áudio (transcribe), Sentry Web Vitals
  - **Listar**: photos (uploads), messages (DM), app activity (analytics), device IDs
- assetlinks.json com SHA-256 **real** (atual é placeholder)
- Content rating IARC (formular no Play Console)
- Target API 34+ configurado no wrapper
- Screenshots (8 telas, 1024x500) — já tem feature-graphic.svg
- Feature graphic PNG 1024x500 — converter de SVG
- Conta Google Play Developer ($25 one-time)

### 🟢 OK / já tem
- assetlinks.json em `/.well-known/` ✓
- Manifest webmanifest (display standalone, icons 192/512 + maskable, share_target) ✓
- Privacy Policy URL ✓
- UGC moderation (Wave 18 reports + Gemini moderate) ✓
- Sentry LGPD safe ✓
- HSTS preload submetido ✓

---

## 4. SEGURANÇA / ABUSO / MODERAÇÃO

### 🔴 Críticos
- **C4 — CSAM scanning**: `/api/moderate` usa Gemini com rubric textual mas SEM hash matching contra NCMEC/PhotoDNA. Apple/Google **agora obrigatórios** pra UGC com upload.
  - **Fix**: integrar **Cloudflare CSAM Scanning Tool** (gratuito, já estamos em CF Pages Pro) OU Microsoft PhotoDNA. Hash todos uploads. Bloquear + report automático.
- **C5 — Age gate**: hard block <16 OU consentimento parental.
  - **Fix**: validar `birth_date` no signup, calcular idade, throw ValidationError se <16.
- **C6 — Email verification não enforçado**: Supabase Auth tem `email_confirmed_at` mas não bloqueia ações. User pode postar/comentar/DM sem confirmar.
  - **Fix**: gate em RLS + frontend pra POST de post, comment, message.

### 🟡 Importantes
- **Rate limit signup**: Turnstile carregado mas **não validado server-side** (decisão antiga). Bots livres.
  - **Fix**: validar token Turnstile via `siteverify` em `/api/auth-rate-check`.
- **Rate limit DM**: sem limite de mensagens/min.
  - **Fix**: max 10 DMs/min por user via Postgres rate limit.
- **Block incomplete**: blocked user ainda vê perfil/posts do blocker se acessar URL direto.
  - **Fix**: RLS adicional em `profiles_public` e `posts` filtrando blocks bidirecional.

### 🟢 OK / já tem
- Reports (Wave 18) — table + admin dashboard `/admin/reports` ✓
- Blocks (Wave 21) — feed filtering server-side ✓
- Consent log populado no signup (Wave M2) ✓
- Moderation API (Gemini) — text + image + video ✓
- Profile phone/email não expostos em `profiles_public` view ✓

---

## 5. PARIDADE IG/TIKTOK (UX SOCIAL)

### 🔴 Críticos pra retenção
- **C8 — Push notifications**: Web Push API + FCM NÃO implementado. App social morre na semana 2.
  - **Fix**: integrar `PushManager.subscribe()` + edge function que dispara push em like/comment/follow.
- **Algorithmic feed ranking**: `get_feed_v2` ordena só por `boosted_until + created_at`. Sem signals tipo time-spent, saves, similar users.
  - **Fix**: Sprint 2 — coletar view_duration via beacon, criar score = 0.4×likes + 0.3×comments + 0.2×saves + 0.1×view_time.

### 🟡 Importantes
- Double-tap to like (gesture IG/TikTok universal)
- Threaded comment replies (sem `parent_comment_id`)
- Mention notifications (trigger ao @user em comment)
- Story highlights (collections destacadas no perfil)
- Story replies (botão "Responder" → DM)
- Typing indicator em chat
- Reels tab dedicado pra vídeos verticais

### 🟢 Já tem (top-tier)
- Stories com tap zones, swipe-down close, progress bar segmentado ✓
- Feed infinite scroll com cursor pagination ✓
- Search FTS (Wave 6) ✓
- Trending Explore (Wave 22 — score = likes + 3×comments) ✓
- Rich text (@mention, #hashtag, URLs auto-link) ✓
- Soft delete + undo (Wave 8) ✓
- Verified badge (Wave 20) ✓
- Boost post 7-30 dias PRO (Wave 22) ✓
- Read receipts chat (Wave 24 `messages.read_at`) ✓
- Unread badge TopNav (Wave 24) ✓

---

## 6. UX POLISH

### ✅ Excelente (nível IG/TikTok)
- Story progress bar segmentado com tap zones ✓
- Skeletons consistentes com shape do conteúdo ✓
- Toast system (bottom, stack, role=status) ✓
- Empty states com emoji + CTA ✓
- Avatar fallbacks com cfImg srcset (1x/2x/3x) ✓
- BottomSheet com handle bar + Esc + backdrop dismiss ✓
- Web Share API + clipboard fallback ✓
- Message bubbles com cores estáveis por sender ✓
- Form validation com Zod + react-hook-form ✓
- Optimistic UI em like/save ✓

### 🔴 Falta polish alto impacto
- **Like animation (heart pop)** — feedback tátil ausente, app parece lento (20min fix)
- **Double-tap to like** — gesture universal IG/TikTok (30min)
- **Pull-to-refresh** — esperado em mobile (45min)
- **Number formatting "1.2k"** — count "1234 curtidas" em vez de "1.2k" (15min)

### 🟡 Polish médio
- **Read receipts visual** no chat (dot enviado/visto)
- **Long-press context menu** em posts
- **Swipe horizontal pra filtros** no feed
- **Touch targets <44x44** em alguns botões (StoryViewer X, BottomSheet X)
- **prefers-reduced-motion** não respeitado
- **Focus-visible rings** ausentes em BottomNav

### Performance percebida
- LCP estimado ~2.5s (Web Vitals RUM rodando há ~2 dias, pouco dado)
- CLS ≈ 0 ✓ (Wave 17 width/height em posts)
- FID/INP OK (mutations com isPending, IntersectionObserver não-bloqueante)
- Bundle ~150-200KB gzipped (estimativa, medir com Lighthouse)

---

## 7. CHECKLIST FINAL PRA LOJAS

### 🔴 ANTES de Apple submission
- [ ] StoreKit 2 integration pra PRO subscription
- [ ] Capacitor + iOS project
- [ ] PrivacyInfo.xcprivacy + Info.plist usage descriptions
- [ ] Age gate <13 (ou <16 mais seguro)
- [ ] CSAM scanning (Cloudflare ou PhotoDNA)
- [ ] Email verification enforçado
- [ ] Screenshots 6.7" / 5.5" / iPad
- [ ] App Store metadata + Privacy Policy URL
- [ ] Conta Apple Developer

### 🔴 ANTES de Google Play submission
- [ ] Bubblewrap (TWA) com SHA-256 real em assetlinks.json
- [ ] Data Safety Form completo (birth_date + address + audio + analytics)
- [ ] Account deletion web URL (`/delete-account`)
- [ ] Age gate
- [ ] CSAM scanning
- [ ] Email verification enforçado
- [ ] Análise jurídica Play Billing vs MP (decisão documentada)
- [ ] Content rating IARC
- [ ] Screenshots + feature graphic PNG
- [ ] Conta Google Play Developer

### 🟡 Recomendado pra retention (paralelo)
- [ ] Push notifications (Web Push + FCM)
- [ ] Like animation
- [ ] Double-tap to like
- [ ] Pull-to-refresh
- [ ] Number formatting "1.2k"
- [ ] Algorithmic feed ranking v3

### 🟢 Já fechado (LAUNCH_AUDIT.md)
- [x] Privacy Policy alinhada (CNPJ Cali Colors)
- [x] Account deletion in-app
- [x] Moderation/Reporting/Blocking
- [x] Soft delete + cleanup
- [x] RLS hardening (Wave 27)
- [x] LGPD consent_log + audit_log
- [x] HSTS preload
- [x] Sentry + Web Vitals RUM

---

## 8. ROADMAP RECOMENDADO

### Sprint 1 (2 semanas) — Compliance + safety blockers
- **Semana 1**: Age gate, email verification enforce, Turnstile server-side validation, CSAM Cloudflare integration
- **Semana 2**: Account deletion web URL, Data Safety Form completo, RLS bidirecional pra blocks

### Sprint 2 (2 semanas) — Retention core
- **Semana 1**: Push notifications (Web Push + FCM + edge function trigger)
- **Semana 2**: Like animation, double-tap, pull-to-refresh, number formatting

### Sprint 3 (2 semanas) — Wrapper Google Play
- **Semana 1**: Bubblewrap setup, SHA-256 real, AAB build, internal testing
- **Semana 2**: Screenshots, IARC, submeter Play Store closed testing

### Sprint 4 (3 semanas) — Wrapper Apple
- **Semana 1**: Capacitor iOS setup, PrivacyInfo.xcprivacy, Info.plist
- **Semana 2**: StoreKit 2 integration, SKProduct configurado
- **Semana 3**: App Store Connect submission

### Sprint 5 (2-4 semanas) — Algorithmic feed + paridade social
- Algorithmic ranking v3
- Threaded comment replies (DB migration + RPC + UI)
- Story highlights
- Mention notifications

**Total: 11-13 semanas** pra ter app em ambas as lojas com paridade social decente.

---

## 9. RISCOS RESIDUAIS

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Apple rejeita PRO via MP | 100% se submeter sem StoreKit | Critical | StoreKit ANTES de submeter |
| Google Play aviso Play Billing | 60% | High | Análise jurídica + Play Billing fallback |
| CSAM incident pré-launch | Baixa mas catastrófica | Critical | Scanning ANTES de abrir signup público |
| Family Policy violation (<13 user + Sentry) | Alta sem age gate | High | Hard block <16 |
| Bot accounts spam | Alta sem Turnstile validation | Med | Turnstile server-side |
| Capacitor build falha primeira vez | Média | Med | Testar em device real cedo |
| Retention <20% semana 4 sem push | Alta | High | Push notifications ASAP |

---

## 10. NÚMEROS

- **5 sub-auditorias paralelas** executadas
- **9 blockers críticos** identificados pra release
- **52 rotas Next.js** + 14 features de IA + Mercado Pago — fundação sólida
- **2 lojas** (Apple + Google) — Google primeiro recomendado
- **11-13 semanas** estimadas pra ambas lojas + paridade social
- **$99/ano + $25 one-time** custo de desenvolvedor (Apple + Google)

---

**Conclusão.** App está **funcionalmente pronto** (LAUNCH_AUDIT.md fechado em 9.5/10), mas **lojas exigem 3 frentes adicionais**: compliance de pagamentos (StoreKit + Play Billing), wrappers nativos (Capacitor iOS + Bubblewrap Android), e safety hardening (CSAM + age gate + email verification). Paralelo: paridade social precisa de push + feed algorítmico + 3-4 micro-interações (like animation, double-tap, pull-to-refresh) pra retenção sobreviver à semana 2.

**Lançar primeiro no Google Play (mais barato e rápido), Apple em segunda fase.**
