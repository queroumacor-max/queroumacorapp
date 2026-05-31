// config.ts — port de /config.js.
// Agrupa constantes de configuração (timeouts, page size, contato, etc.).
// `as const` em tudo pra propagar literal types nos call sites.
// Env vars (Supabase URL/Anon, Sentry DSN) entram via process.env e ficam
// expostas pra que o caller decida quando estourar se faltar.

export const Config = {
  // Env-derived (lazy — não estoura no parse mesmo se vazio, decisão fica
  // com o caller que pode preferir degradação a crash).
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  // DSN público de Sentry. Default = o DSN da org já configurado no projeto;
  // sobrescrito pela env quando presente.
  sentryDsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    'https://e19aa766953a6e70aeb09a52ea1046a7@o4511481806716928.ingest.us.sentry.io/4511482011189249',

  // Feed (origem: app.js — `const FEED_PAGE = 30`, `const POST_COLS`)
  feed: {
    PAGE: 30,
    PAGE_SIZE: 30,
    POST_COLS:
      'id, user_id, caption, media_url, media_type, status, for_sale, price, art_type, created_at',
  },

  // Stories — duração de 5s por slide (estilo IG, espelha app.js).
  stories: {
    DURATION_MS: 5000,
  },

  // Suporte / atendimento Cali Colors (origem: app.js — `const SUPPORT`).
  support: {
    email: 'loja@calicolors.com.br',
    whatsapp: '5511959765031',
  },

  // Timeouts de rede usados em withTimeout(...) (origem: head.js / app.js).
  api: {
    TIMEOUT_DEFAULT_MS: 15000,
    TIMEOUT_PROFILE_MS: 12000,
    TIMEOUT_FOLLOWING_MS: 10000,
    TIMEOUT_FEED_MS: 15000,
    TIMEOUT_POSTS_MS: 12000,
    TIMEOUT_GENERIC_MS: 8000,
    TIMEOUT_STORY_PROFILES_MS: 6000,
    TIMEOUT_SHORT_MS: 5000,
  },

  // Cache-busting de assets vanilla. Mantido só pra referência — Next.js
  // resolve isso com hashing automático no build, então não é usado aqui.
  cache: {
    ASSET_VERSION: '20260531d',
  },

  // Supabase URL canônica (referência; o cliente real usa supabaseUrl acima).
  supabase: {
    URL: 'https://uwqebaqweehiljsqkifm.supabase.co',
  },

  // Mensagens de erro padronizadas pra UI (PT-BR).
  errors: {
    NETWORK: 'Sem conexão. Verifique sua internet e tente de novo.',
    AUTH: 'Sessão expirada. Faça login novamente.',
    PERMISSION: 'Você não tem permissão pra essa ação.',
    RATE_LIMIT: 'Muitas tentativas. Aguarde um minuto.',
    GENERIC: 'Algo deu errado. Tente de novo em instantes.',
  },
} as const;

export type AppConfig = typeof Config;
