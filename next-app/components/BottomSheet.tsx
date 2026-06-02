// BottomSheet — modal "janela que sobe" estilo vanilla (`.overlay` +
// `.sheet`). Click no backdrop ou tecla Esc fecha. X pequeno no
// canto superior direito do sheet. Body scroll lock enquanto aberto.
// Conteúdo scrolla sem barra visível (.hide-scrollbar global).
'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}

export function BottomSheet({ open, onClose, children, ariaLabel }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-end justify-center"
      style={{
        background: 'rgba(0,0,0,.55)',
        animation: 'bsFade 160ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full mx-auto bg-white hide-scrollbar"
        style={{
          maxWidth: 430,
          maxHeight: '92vh',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 30px rgba(0,0,0,.3)',
          animation: 'bsSlideUp 220ms cubic-bezier(.32,.72,0,1)',
          overflowY: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Handle bar fino + X pequeno no canto superior direito.
            Vanilla mostra só a barrinha; aqui adicionamos o X discreto
            pra acessibilidade (Esc + click backdrop também fecham). */}
        <div
          aria-hidden="true"
          className="sticky top-0 z-10 flex items-center justify-center"
          style={{
            background: '#fff',
            padding: '10px 14px 6px',
          }}
        >
          <span
            className="rounded-full"
            style={{
              width: 40,
              height: 4,
              background: 'rgba(0,0,0,.18)',
            }}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute z-20"
          style={{
            top: 10,
            right: 12,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(0,0,0,.07)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--color-ink)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="6" y1="18" x2="18" y2="6" />
          </svg>
        </button>

        <div style={{ padding: '4px 18px 24px' }}>{children}</div>
      </div>
      <style>{`
        @keyframes bsFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bsSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
