// BottomSheet — modal estilo "janela que sobe" do vanilla (`.overlay` +
// `.sheet` em styles.css). Click no backdrop ou tecla Esc fecha. Body
// scroll lock enquanto aberto. Trap simples: o conteúdo do sheet faz
// stopPropagation no click pra backdrop só pegar click fora.
'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Conteúdo. Use cabeçalho + corpo scrollável dentro. */
  children: ReactNode;
  /** aria-label do dialog. */
  ariaLabel?: string;
}

export function BottomSheet({ open, onClose, children, ariaLabel }: BottomSheetProps) {
  // Body scroll lock + Esc close.
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
        className="w-full mx-auto bg-white overflow-y-auto"
        style={{
          maxWidth: 430,
          maxHeight: '90vh',
          borderRadius: '20px 20px 0 0',
          padding: '14px 18px 28px',
          paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
          boxShadow: '0 -8px 30px rgba(0,0,0,.3)',
          animation: 'bsSlideUp 220ms cubic-bezier(.32,.72,0,1)',
        }}
      >
        {/* Handle bar + close (X) — vanilla mostra essa barrinha no topo */}
        <div className="flex items-center justify-between mb-2">
          <div
            aria-hidden="true"
            className="mx-auto rounded-full"
            style={{
              width: 40,
              height: 4,
              background: 'rgba(0,0,0,.2)',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="absolute"
            style={{
              top: 12,
              right: 16,
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(0,0,0,.06)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--color-ink)" strokeWidth="2.2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>
        {children}
      </div>
      <style>{`
        @keyframes bsFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes bsSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
