# Security Audit Log

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
