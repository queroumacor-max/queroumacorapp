# Backlog — Melhorias e features pendentes

Lista de melhorias identificadas em auditorias mas ainda não atacadas. Priorize daqui.

---

## 🔧 Recursos do plano Pro ainda não ativados

Configuração no dashboard, sem código. Ganho de perf/segurança imediato.

| # | Recurso | Onde ativar | Ganho |
|---|---|---|---|
| 1 | **Cloudflare Polish (lossy)** | Dashboard CF → Speed → Optimization | Comprime imagens no edge ~30-40% sem mexer no código |
| 2 | **Cloudflare Mirage** | Speed → Optimization | Lazy-load + downsizing por device. Combina com PWA |
| 3 | **Image Resizing (CF)** | Usar URL `/cdn-cgi/image/?width=400&quality=80&format=webp` ao buscar avatars/posts | Reduz avatars/posts do feed (1024 → 400) sem novo upload |
| 4 | **WAF Managed Rules (OWASP)** | Security → WAF → Managed Rules | Filtra SQLi/XSS comuns no edge antes de chegar no app |
| 5 | **Cloudflare Cache Reserve** | Caching → Cache Reserve | Cache de longo prazo para `/img/*`, reduz origin requests |
| 6 | **Cloudflare Rate Limiting** | Security → Rate Limiting Rules | Rate limit em `/api/*` no edge (complementa `rate_limits` no DB) |
| 7 | **Argo Smart Routing** | Traffic → Argo | Roteia tráfego pelo backbone Cloudflare. ~30% mais rápido em geografias distantes |

---

## 📱 Features sociais (estilo IG) faltando

Mapa feito em 26/05/2026. Funcionalidades não-implementadas.

### Quick wins (faço rápido, valor real)

| # | Feature | Esforço | Notas |
|---|---|---|---|
| S1 | **Badge "Verified" ✓** na UI | Trivial | Coluna `profiles.verified` já existe, só falta render |
| S2 | **Sugestões de quem seguir** | Pequeno | Query top pintores não-seguidos ordenados por rating + região |
| S3 | **Editar caption do post** | Pequeno | Hoje só apaga. Padrão IG. Validar moderação na edição |
| S4 | **Links externos no perfil** | Pequeno | Adicionar colunas `profiles.instagram_url`, `website_url` + UI no editar-perfil |
| S5 | **Story com `link_url`** | Pequeno | Story com botão "ver mais" linkando externamente |

### Médio prazo

| # | Feature | Esforço | Notas |
|---|---|---|---|
| S6 | **Bloquear usuário** | Médio | Nova tabela `blocks(blocker_id, blocked_id)` + filtros em feed/busca/chat/notif |
| S7 | **Menções `@user`** clicáveis | Médio | Parser regex em posts/comentários/chat. Renderiza como link ao perfil |
| S8 | **Hashtags `#tag`** | Médio | Parser + tela de busca por tag + ordem trending |
| S9 | **Carousel de múltiplas fotos no post** | Médio | Hoje 1 foto por post; precisa array de media |
| S10 | **Antes/Depois real em posts** | Médio | Hoje só funciona em perfil mock. Coluna `posts.before_after_pair` ou par de posts |
| S11 | **Post boost / pinned (PRO only)** | Médio | Coluna `promoted_until` + ordenação prioritária no feed |
| S12 | **Explore real (feed de descoberta)** | Médio | Hoje `/explore` é só mapa de profissionais; pode ter trending posts |
| S13 | **Modo escuro** | Pequeno-Médio | Variáveis CSS já existem, falta toggle + persistência |

### Esforço grande

| # | Feature | Esforço | Notas |
|---|---|---|---|
| S14 | **Web Push Notifications** | Grande | VAPID + service worker handler. Hoje notif é só in-app |
| S15 | **Reels / vídeos curtos verticais** | Grande | UI nova com swipe vertical. Posts já aceitam vídeo |
| S16 | **Story editor (texto/stickers/desenho)** | Grande | UI nova estilo IG |
| S17 | **Compartilhar story de outro (regram)** | Médio | Padrão IG: repostar story de quem te marcou |

---

## 🚀 Performance / arquitetura (do audit anterior)

| # | Item | Esforço | Notas |
|---|---|---|---|
| P1 | **Code-splitting `app.js`** | Grande | Quebrar monólito de 8000 linhas em módulos (CRM, IA, PDF, mapa, chat). Espera dados de Web Vitals antes |
| P2 | **Cursor-based pagination no feed** | Médio | Hoje é `.offset()` — escala mal e perde estado ao voltar |
| P3 | **Lazy-load Leaflet** | Pequeno | Hoje carrega 163KB em toda navegação; só usado em `/explore`. Carregar on-click |
| P4 | **`<img width height>` em posts dinâmicos** | Médio | Hoje sem dimensões → CLS alto. Precisa salvar W/H no upload |

---

## 🔍 Observability / dados

| # | Item | Notas |
|---|---|---|
| O1 | **Sentry / PostHog** (escolher vendor) | Crash reports + funil. `/api/log-error` já coleta crashes/Web Vitals em CF logs (retenção 7 dias) |
| O2 | **Dashboard interno de `feature_interest`** | Tabela já criada. Falta UI no portal admin para ver quem clicou "tenho interesse na Maquininha" |
| O3 | **Dashboard de `reports` no portal** | Tabela já criada. UI lista denúncias pendentes, admin marca como `reviewed`/`resolved`/`dismissed` |

---

## 🛡️ Segurança / config externa (não-código)

| # | Item | Quando |
|---|---|---|
| X1 | **HSTS preload** | ~07/07/2026 (6 semanas após 25/05). Adicionar `preload` no header HSTS + submeter em https://hstspreload.org |
| X2 | **DMARC em `calicolors.com.br`** | Adicionar no GoDaddy DNS: TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:dpo@calicolors.com.br` |
| X3 | **Submeter sitemap ao Google Search Console** | https://search.google.com/search-console — `https://queroumacor.com.br/sitemap.xml` |
| X4 | **Testar restore de backup Supabase** | Criar projeto staging, restaurar PITR, validar dados |
| X5 | **Pentest externo** | Quando crescer (>10k usuários ou faturamento sério) |
| X6 | **Validar Turnstile server-side** | Hoje carrega o widget mas nenhum endpoint chama `siteverify`. Decisão deferida |
