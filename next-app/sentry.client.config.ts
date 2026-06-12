import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend } from '@/lib/sentry-helpers';

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    'https://e19aa766953a6e70aeb09a52ea1046a7@o4511481806716928.ingest.us.sentry.io/4511482011189249',
  environment:
    typeof window !== 'undefined' &&
    /(?:^|\.)queroumacor\.com\.br$/i.test(window.location.hostname)
      ? 'production'
      : 'preview',
  replaysSessionSampleRate: 0.0,
  replaysOnErrorSampleRate: 1.0,
  beforeSend: sentryBeforeSend,
  integrations: [
    // browserTracingIntegration auto-captura Web Vitals (LCP, INP, CLS,
    // FCP, TTFB) e route changes. Sem isso, otimizações de perf são
    // cegas — não tem como saber se a mudança moveu a agulha em prod.
    Sentry.browserTracingIntegration(),
    // R-H4: replays com PII bloqueado por default. maskAllText mascara
    // qualquer texto na sessão; blockAllMedia esconde <img>/<video>/etc.
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  // Sample 100% das transactions só pra ter Web Vitals em todas as
  // navegações. Volume é baixo (app interno, mobile-first). Se virar
  // problema de quota, baixa pra 0.5.
  tracesSampleRate: 1.0,
  tracePropagationTargets: [
    /^https:\/\/(?:.*\.)?queroumacor\.com\.br/,
    /^https:\/\/uwqebaqweehiljsqkifm\.supabase\.co/,
  ],
});
