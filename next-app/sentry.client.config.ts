import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    'https://e19aa766953a6e70aeb09a52ea1046a7@o4511481806716928.ingest.us.sentry.io/4511482011189249',
  environment:
    typeof window !== 'undefined' &&
    /(?:^|\.)queroumacor\.com\.br$/i.test(window.location.hostname)
      ? 'production'
      : 'preview',
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],
});
