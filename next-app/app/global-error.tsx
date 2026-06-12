'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'global-error' } });
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
        <h1>QueroUmaCor</h1>
        <p>Erro fatal ao carregar o app. Recarregue a página.</p>
        {error.digest && <p style={{ fontFamily: 'monospace', fontSize: 12 }}>{error.digest}</p>}
      </body>
    </html>
  );
}
