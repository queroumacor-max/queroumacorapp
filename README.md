# QueroUmaCor

PWA brasileira que conecta clientes a pintores, grafiteiros e profissionais automotivos. Cadastro por convite, orçamentos por foto, chat em tempo real, loja de tintas Cali Colors e gateway de assinatura PRO.

## Stack

- **Frontend**: Vanilla JS + HTML + CSS (SPA mobile-first). React + Babel só no portal admin.
- **Backend**: Cloudflare Pages Functions (`/functions/api/*.js`, V8 isolates).
- **Banco**: Supabase (Postgres + Auth + Storage + RLS + Realtime).
- **PWA**: Service Worker (`sw.js`), manifest, offline fallback.
- **IA**: OpenAI + Gemini (fallback automático) para chat, sugestão de cor, art generation, moderação.

## Arquitetura

```
queroumacorapp/
├── index.html              # SPA principal (~2300 linhas)
├── app.js                  # Lógica da SPA (~8000 linhas, vanilla)
├── head.js                 # Auth/Supabase/helpers globais
├── styles.css              # Tudo de estilo
├── supabase.js             # Supabase JS UMD self-hosted (SRI)
├── jspdf.umd.min.js        # jsPDF self-hosted
├── leaflet.js/css          # Mapa self-hosted
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker
├── _headers                # Headers Cloudflare Pages (CSP, HSTS, cache)
├── robots.txt + sitemap.xml
├── offline.html            # Fallback PWA offline
├── icon-{192,512}.png      # Ícones PWA
├── img/                    # WebP estáticos
├── products/               # Catálogo loja
├── functions/api/          # Cloudflare Pages Functions
│   ├── _security.js        # auth + rate limit + helpers
│   ├── _ai.js              # OpenAI ↔ Gemini fallback
│   └── (~20 endpoints)
├── portal/                 # Admin React (acesso restrito)
│   ├── index.html          # JSX inline + Babel standalone
│   ├── react.production.min.js + react-dom.production.min.js
│   └── babel.min.js
├── supabase_init.sql       # Source-of-truth do schema (~2000 linhas)
└── tests/                  # Vitest
```

## Desenvolvimento local

Requisitos: Node 18+ pra rodar testes (deploy não precisa de build).

```bash
# Testes
npm install
npm test
```

Para preview do app, sirva o root estático:
```bash
npx serve .
# ou
python3 -m http.server 8000
```

## Deploy

Cloudflare Pages, automático a partir do branch `main`. Não há build step.

Branch de trabalho: `claude/new-session-V0v78`. Após cada mudança, merge para `main` dispara deploy.

## Cache-busting

`index.html` carrega `head.js` e `app.js` com `?v=AAAAMMDD<letra>` (ex.: `?v=20260526h`). SEMPRE que mudar `app.js` ou `head.js`, bump esse `?v=` nas duas tags `<script>`.

## Variáveis de ambiente (Cloudflare Pages)

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE` (NUNCA exponha no client)
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ADMIN_EMAILS` (lista separada por vírgula)

## Banco de dados

`supabase_init.sql` é o source-of-truth. Para rodar do zero em um Supabase novo:
1. Crie o projeto
2. Copie e rode o SQL no SQL Editor

Mudanças incrementais: cole o SQL no chat e rode manualmente (não há ferramenta de migration ativa).

## Segurança

- CSP rigorosa (nenhuma CDN terceira além de Google Fonts e Turnstile)
- SRI em todos os scripts externos self-hosted
- RLS em todas as tabelas mutáveis pelo client
- Service-role key isolada no backend (`functions/api/_security.js`)
- LGPD: política, contato DPO `loja@calicolors.com.br`, RPC `request_account_deletion`, exportação `/api/me-export`

## Contato

WhatsApp: (11) 95976-5031 · loja@calicolors.com.br
