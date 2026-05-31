// UndoSnackbar — snackbar global que aparece após soft-delete, com botão
// "Desfazer" e countdown visual. Default 10s. Auto-dismiss ao fim do
// countdown ou quando o caller fecha (setState).
//
// Estado controlado externamente: o caller (hook useUndoable / página)
// gerencia `message`/`onUndo` via state; passa null pra esconder. Pattern
// segue FriendlyErrorToast (mesma família: bottom-center, z-50, role alert).
//
// A11y:
//   - role="status" + aria-live="polite" — não é erro, é confirmação.
//     "polite" pra não interromper anúncios em curso do leitor de tela.
//   - Botão "Desfazer" tem aria-label completo incluindo o countdown.

'use client';

import { useEffect, useState, useRef } from 'react';

export interface UndoSnackbarProps {
  /** Texto mostrado à esquerda. Null/undefined = snackbar escondida. */
  message: string | null;
  /** Callback ao clicar "Desfazer". Caller deve fechar o snackbar (passar null). */
  onUndo: () => void;
  /** Callback ao expirar o countdown (ou fechar manualmente). */
  onDismiss?: () => void;
  /** Duração em ms. Default 10s — mesma janela do Gmail/IG undo. */
  durationMs?: number;
}

export function UndoSnackbar({
  message,
  onUndo,
  onDismiss,
  durationMs = 10000,
}: UndoSnackbarProps) {
  // Tick-down do countdown. Reseta toda vez que `message` muda
  // (snackbar nova aparecendo → reinicia do início).
  const [seconds, setSeconds] = useState(() =>
    Math.max(1, Math.ceil(durationMs / 1000)),
  );
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!message) return;
    // Reseta o tick e o flag de dismiss em cada novo message.
    dismissedRef.current = false;
    setSeconds(Math.max(1, Math.ceil(durationMs / 1000)));

    const interval = window.setInterval(() => {
      setSeconds((s) => {
        const next = s - 1;
        if (next <= 0) {
          window.clearInterval(interval);
          // Avisa o caller que o tempo acabou — chamar dentro do setter
          // pode reentrar; usamos flag pra garantir 1 single-fire.
          if (!dismissedRef.current) {
            dismissedRef.current = true;
            // Defer pra evitar setState durante render do React.
            queueMicrotask(() => onDismiss?.());
          }
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] max-w-md w-[calc(100%-2rem)] bg-[color:var(--color-ink,#222)] text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3"
    >
      <span className="flex-1 text-sm">{message}</span>
      <button
        type="button"
        onClick={() => {
          dismissedRef.current = true;
          onUndo();
        }}
        aria-label={`Desfazer (${seconds} segundos restantes)`}
        className="font-bold underline text-sm whitespace-nowrap hover:opacity-80"
      >
        Desfazer ({seconds}s)
      </button>
    </div>
  );
}
