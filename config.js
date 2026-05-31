// @ts-check
// config.js — agrupa constantes de configuração em window.Config.
// Igual db.js: vive em paralelo a app.js/head.js, sem deps; as call sites
// continuam usando as constantes top-level originais. Migração gradual.
// IMPORTANTE: este arquivo COPIA literais — não importa nem referencia
// globais (pode carregar ANTES de app.js).
(function(){
  'use strict';

  window.Config = {
    // Feed (origem: app.js)
    feed: {
      // app.js:7183 — `const FEED_PAGE = 30`
      PAGE: 30,
      // app.js:7161 — `const POST_COLS = '...'` (também espelhado em db.js:21)
      POST_COLS: 'id, user_id, caption, media_url, media_type, status, for_sale, price, art_type, created_at'
    },

    // Stories (origem: app.js)
    stories: {
      // app.js:7987 — `const STORY_DURATION = 5000` (5s por story, estilo IG)
      DURATION_MS: 5000
    },

    // Suporte / atendimento Cali Colors (origem: app.js:608 — `const SUPPORT`)
    support: {
      // E-mail de contato / LGPD
      email: 'loja@calicolors.com.br',
      // WhatsApp (DDI+DDD+número só dígitos) — (11) 95976-5031
      whatsapp: '5511959765031'
    },

    // Timeouts de rede usados em withTimeout(...) (origem: head.js / app.js).
    // head.js:487 define default 15000 quando ms cai em undefined.
    api: {
      // head.js:487 — default interno do withTimeout
      TIMEOUT_DEFAULT_MS: 15000,
      // head.js:514 — getMyProfile
      TIMEOUT_PROFILE_MS: 12000,
      // app.js:7263 — followingIds
      TIMEOUT_FOLLOWING_MS: 10000,
      // app.js:7270 — loadFeed (stories + posts em paralelo)
      TIMEOUT_FEED_MS: 15000,
      // app.js:7503 — query de posts
      TIMEOUT_POSTS_MS: 12000,
      // app.js:7540, 8006, 9092 — counts genéricos, stories, invite-insert
      TIMEOUT_GENERIC_MS: 8000,
      // app.js:8026 — story-profiles
      TIMEOUT_STORY_PROFILES_MS: 6000,
      // app.js:7602, 9071 — comment-profiles / getSession
      TIMEOUT_SHORT_MS: 5000
    },

    // Cache-busting de assets (origem: index.html:57,63,71,2564 — `?v=...`).
    // Bumpar este valor SEMPRE que app.js/head.js mudarem (formato AAAAMMDD<letra>).
    cache: {
      ASSET_VERSION: '20260531d'
    },

    // Supabase (origem: head.js:1-2). Mantido aqui só pra referência; head.js
    // continua a fonte de verdade pro client real. Não importar daqui pra
    // criar client — usar getSupabase() (head.js).
    supabase: {
      URL: 'https://uwqebaqweehiljsqkifm.supabase.co'
    },

    // Mensagens de erro padronizadas (origem: head.js:442 — `const ERR`).
    // Espelhadas aqui pra futura migração; window.ERR segue sendo a referência.
    errors: {
      NETWORK: 'Sem conexão. Verifique sua internet e tente de novo.',
      AUTH: 'Sessão expirada. Faça login novamente.',
      PERMISSION: 'Você não tem permissão pra essa ação.',
      RATE_LIMIT: 'Muitas tentativas. Aguarde um minuto.',
      GENERIC: 'Algo deu errado. Tente de novo em instantes.'
    }
  };
})();
