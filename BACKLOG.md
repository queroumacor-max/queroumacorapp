# Backlog — Melhorias e features pendentes

Última auditoria: 2026-06-09. Itens com ✅ foram fechados em sprints recentes (ver CLAUDE.md).

---

## 🔧 Recursos do plano Pro ainda não ativados (TOGGLE NO PAINEL CF)

Configuração no Cloudflare Dashboard, sem código. Ganho de perf/segurança imediato. Pendentes:

| # | Recurso | Onde ativar | Ganho |
|---|---|---|---|
| 1 | **Cloudflare Polish (lossy)** | Speed → Optimization | Comprime imagens no edge ~30-40% |
| 2 | **Cloudflare Mirage** | Speed → Optimization | Lazy-load + downsizing por device |
| 3 | **Image Resizing (CF)** ⚠️ | Speed → Optimization → Image Resizing **ON** + "Resize images from any origin" **ON** | **Código já deployado** (`cfImg.ts` reescreve URLs pra `/cdn-cgi/image/...`). Sem o toggle, browsers caem no `onError` e mostram placeholder |
| 4 | **WAF Managed Rules (OWASP)** | Security → WAF → Managed Rules | Filtra SQLi/XSS comuns no edge |
| 5 | **Cloudflare Cache Reserve** | Caching → Cache Reserve | Cache de longo prazo para `/img/*` |
| 6 | **Cloudflare Rate Limiting** | Security → Rate Limiting Rules | Rate limit em `/api/*` no edge |
| 7 | **Argo Smart Routing** | Traffic → Argo | ~30% mais rápido em geografias distantes |

---

## 📱 Features sociais (estilo IG) faltando

### ✅ Já feitos (Sprints 5–7)

S1 verified, S2 sugestões, S3 editar caption, S4 links externos, S5 story link, S6 bloquear, S7 menções, S8 hashtags, S11 boost, S12 explore trending, S13 modo escuro.

### Pendentes

| # | Feature | Esforço | Notas |
|---|---|---|---|
| S9 | **Carousel de múltiplas fotos no post** | Médio | Hoje 1 foto por post. Padrão IG (swipe horizontal). Schema novo: tabela `post_media` ou JSONB |
| S10 | **Antes/Depois real em posts** | Médio | Hoje só mock no perfil. Coluna `posts.before_after_pair` ou par de posts linkados |
| S14 | **Web Push Notifications** | Grande | VAPID + service worker handler. Hoje notif é só in-app. Tabela `push_subscriptions` |
| S15 | **Reels / vídeos curtos verticais** | Grande | UI nova com swipe vertical. Posts já aceitam vídeo |
| S16 | **Story editor (texto/stickers/desenho)** | Grande | UI nova estilo IG |
| S17 | **Compartilhar story de outro (regram)** | Médio | Padrão IG |

---

## 🚀 Performance / arquitetura

### ✅ Já feitos

P4 width/height (Wave 17), parte de P2 cursor-based via `get_feed_v2` (Wave 16, mas frontend ainda usa fallback legacy com offset em alguns paths).

### Pendentes

| # | Item | Esforço | Notas |
|---|---|---|---|
| P1 | **Code-splitting `app.js` vanilla** | Grande | App vanilla tem 1299 linhas + 44 módulos. Migrar pra import dinâmico por feature pra reduzir bundle inicial. Mexe na arquitetura IIFE+shim deliberada — alto risco de regressão |
| P3 | **Lazy-load Leaflet** | Pequeno | Hoje carrega 163KB em toda navegação; só usado em `/explore`. Carregar on-click no map view |
| Px | **Firmar RPC `get_feed_v2` (remover fallback legacy)** | Pequeno | Telemetria Sentry foi adicionada na Sprint 4. Depois de 2-3 semanas só `rpc_ok`, dá pra remover o caminho legacy em `feed.ts` |

---

## 🔍 Observability / dados

### ✅ Já feitos

O2 dashboard feature_interest (Sprint 4), O3 dashboard reports (Sprint 3), B7 Web Vitals RUM via Sentry (Sprint 3). Sentry GitHub integration ativa.

### Pendentes

| # | Item | Notas |
|---|---|---|
| O1 | **DSN Sentry frontend** | Hoje Sentry coleta server-side via `/api/log-error` + GitHub integration. Falta ligar DSN no browser pra capturar erros JS no cliente. Decisão deferida (ver CLAUDE.md) |

---

## 🛡️ Segurança / config externa (não-código)

### ✅ Já feitos

X1 HSTS preload submetido, X3 Search Console verificado.

### Pendentes

| # | Item | Quando |
|---|---|---|
| X2 | **DMARC em `calicolors.com.br`** | Adicionar no GoDaddy DNS: TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:dpo@calicolors.com.br` |
| X4 | **Testar restore de backup Supabase (PITR)** | Plano PRO tem 7d PITR. Criar projeto staging, restaurar, validar — pra ter confiança no DR |
| X5 | **Pentest externo** | Quando crescer (>10k usuários ou faturamento sério) |
| X6 | **Validar Turnstile server-side** | Widget no front mas nenhum endpoint chama `siteverify`. Decisão deferida (usuário deixou quieto) |
