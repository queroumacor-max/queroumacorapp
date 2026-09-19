'use client';

import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { agendarRetomada } from '@/lib/utils/autoRetry';
import { reportFailure } from '@/lib/utils/reportFailure';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Tenta se recuperar sozinha antes de pedir ajuda. O caso comum não é
  // um bug da tela: é o app voltando depois de horas fechado, com a rota
  // falhando por rede. `reset()` refaz o render sem recarregar a página
  // inteira — se não bastar, o próximo agendamento recarrega. Freio
  // compartilhado com o service worker (lib/utils/autoRetry).
  const [tentando, setTentando] = useState(false);

  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'route-error' } });
    // Também grava na tabela `errors` (visível no /admin/errors, que o Sentry
    // não é daqui): mensagem + digest + URL da rota que quebrou. É o que separa
    // "algo deu errado" genérico da causa real. Best-effort, nunca lança.
    reportFailure('render-error', error, {
      ctx: error.digest ? `digest:${error.digest}` : 'client',
    });
  }, [error]);

  useEffect(() => {
    // Sincroniza com sistema externo: agenda um retry via setTimeout
    // (agendarRetomada) e espelha se ele foi de fato armado — não é
    // derivável no render, depende do freio compartilhado com o SW.
    const { agendado, cancelar } = agendarRetomada(reset);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    setTentando(agendado);
    return cancelar;
  }, [reset]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Algo deu errado
        </h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          {tentando
            ? 'Tivemos um problema ao carregar essa página. Estou tentando de novo sozinho…'
            : 'Tivemos um problema ao carregar essa página. A equipe já foi avisada.'}
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
