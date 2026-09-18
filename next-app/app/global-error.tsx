'use client';

import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { agendarRetomada } from '@/lib/utils/autoRetry';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  // Antes esta tela dizia "recarregue a página" e parava por aí. No celular,
  // depois de um tempo fechado, o Android mata o processo do WebView e é
  // exatamente aqui que a pessoa cai ao reabrir — tendo que recarregar na
  // mão. Agora o app tenta sozinho, com o mesmo freio da página
  // "Reconectando…" do service worker.
  const [tentando, setTentando] = useState(false);

  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'global-error' } });
  }, [error]);

  useEffect(() => {
    // Sincroniza com sistema externo: agenda um retry via setTimeout
    // (agendarRetomada) e espelha se ele foi de fato armado — não é
    // derivável no render, depende do freio compartilhado com o SW.
    const { agendado, cancelar } = agendarRetomada(() => window.location.reload());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    setTentando(agendado);
    return cancelar;
  }, []);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fdfbf7',
          color: '#1a1a2e',
          font: '400 15px/1.6 system-ui, -apple-system, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📶</div>
          <h1 style={{ fontSize: 19, margin: '0 0 8px' }}>
            {tentando ? 'Reconectando…' : 'QueroUmaCor'}
          </h1>
          <p style={{ margin: '0 0 20px', color: '#6b6b7b', maxWidth: 280 }}>
            {tentando
              ? 'O app teve uma instabilidade ao abrir. Vou tentar de novo sozinho em instantes.'
              : 'Não consegui abrir o app depois de várias tentativas. Toque no botão pra tentar de novo.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0,
              borderRadius: 10,
              background: '#ff6b35',
              color: '#fff',
              font: '700 15px system-ui',
              padding: '12px 26px',
            }}
          >
            Tentar agora
          </button>
          {error.digest && (
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#9a9aa8', marginTop: 20 }}>
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
