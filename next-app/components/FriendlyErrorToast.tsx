// FriendlyErrorToast — componente padrão pra mostrar um FriendlyError com
// botão de ação opcional. Pode ser usado standalone (controlado) ou via
// hook que enfileira toasts (não implementado aqui pra manter o componente
// leve — caller controla isOpen).
//
// Acessibilidade: role="alert" + aria-live="assertive" pra leitor de tela
// anunciar imediatamente. Botão "Fechar" sempre presente.

'use client';

import { useEffect } from 'react';
import type { FriendlyError } from '@/lib/errors-friendly';

export interface FriendlyErrorToastProps {
  error: FriendlyError | null;
  /** Callback ao fechar (X ou auto-dismiss). */
  onClose: () => void;
  /** Callback opcional ao clicar no botão actionable. */
  onAction?: () => void;
  /** Auto-dismiss em ms. Default: nunca (precisa fechar manualmente). */
  autoCloseMs?: number;
}

export function FriendlyErrorToast({
  error,
  onClose,
  onAction,
  autoCloseMs,
}: FriendlyErrorToastProps) {
  useEffect(() => {
    if (!error || !autoCloseMs) return;
    const t = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(t);
  }, [error, autoCloseMs, onClose]);

  if (!error) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] max-w-md w-[calc(100%-2rem)] bg-white border border-red-200 rounded-xl shadow-xl p-4 flex items-start gap-3"
    >
      <div className="text-2xl leading-none" aria-hidden="true">
        ⚠️
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-sm text-[color:var(--color-ink,#222)]">
          {error.title}
        </h3>
        <p className="text-sm text-gray-600 mt-0.5">{error.message}</p>
        {error.actionable && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-2 text-sm font-semibold text-[color:var(--color-p1,#2563eb)] hover:underline"
          >
            {error.actionable}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso"
        className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}
