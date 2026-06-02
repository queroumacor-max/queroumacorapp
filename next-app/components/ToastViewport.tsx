// ToastViewport — renderiza a stack de toasts emitidos via showToast().
// Posiciona embaixo (acima da BottomNav), centrado, max-width 430px pra
// alinhar com o shell mobile. Mount-once em RootLayout — qualquer caller
// (client ou service) só dispara showToast sem precisar de provider.
'use client';

import { useToastQueue } from '@/lib/toast';

export function ToastViewport() {
  const queue = useToastQueue();

  if (queue.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed left-1/2 -translate-x-1/2 z-[2000] flex flex-col items-center gap-2 pointer-events-none"
      style={{
        bottom: 'calc(80px + env(safe-area-inset-bottom))',
        width: 'min(calc(100vw - 24px), 400px)',
      }}
    >
      {queue.map((msg) => (
        <div
          key={msg.id}
          role="status"
          className="text-white font-bold pointer-events-auto"
          style={{
            padding: '11px 18px',
            borderRadius: 999,
            fontSize: 13,
            background:
              msg.variant === 'error'
                ? 'var(--color-danger)'
                : msg.variant === 'success'
                  ? 'var(--color-p3)'
                  : 'var(--color-ink)',
            boxShadow: '0 6px 20px rgba(0,0,0,.25)',
            maxWidth: '100%',
            textAlign: 'center',
            animation: 'toastIn 220ms cubic-bezier(.32,.72,0,1)',
          }}
        >
          {msg.text}
        </div>
      ))}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
