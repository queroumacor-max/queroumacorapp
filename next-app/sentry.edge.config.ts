import * as Sentry from '@sentry/nextjs';

// Edge runtime: roda em Cloudflare Workers / Vercel Edge. Sem APIs Node.
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'preview',
  tracesSampleRate: 0.1,
});
