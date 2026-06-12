'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'route-error' } });
  }, [error]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Algo deu errado
        </h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Tivemos um problema ao carregar essa página. A equipe já foi avisada.
        </p>
        {error.digest && (
          <p className="text-xs text-[color:var(--color-muted)] font-mono">
            Código: {error.digest}
          </p>
        )}
        <div className="flex gap-2 justify-center pt-2">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'var(--color-p1)' }}
          >
            Tentar de novo
          </button>
          <a
            href="/feed"
            className="px-4 py-2 rounded-lg text-sm font-semibold border border-[color:var(--color-border)]"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </main>
  );
}
