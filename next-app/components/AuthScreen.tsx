// AuthScreen — wrapper visual das telas de autenticação (/login, /signup).
// Replica EXATO o `.auth-screen` do vanilla (styles.css linha 388+):
//   - fundo ink ocupando TODA a viewport (não só os 430px do mobile shell);
//   - `auth-top`: área dark com logo + tagline (60px topo, 32px base);
//   - `auth-body`: cream com border-radius 28px 28px 0 0, ocupa o resto;
//   - sem TopNav, sem BottomNav (vanilla esconde — modules/nav.js noNav).
//
// Estrutura: outer div full-bleed dark + inner 430px com conteúdo. O outer
// garante que em desktop o dark não fique como "card flutuante" no meio da
// tela com cream em volta.
import type { ReactNode } from 'react';

interface AuthScreenProps {
  /** Tagline mostrada abaixo do logo. Pode quebrar com <br>. */
  tagline: ReactNode;
  /** Conteúdo do card cream (form, título, etc.). */
  children: ReactNode;
}

export function AuthScreen({ tagline, children }: AuthScreenProps) {
  return (
    // Outer: viewport inteira em dark, sem max-width
    <div
      className="w-full relative overflow-hidden"
      style={{
        background: 'var(--color-ink)',
        minHeight: '100dvh',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Blobs decorativos (vanilla auth-bg-blob) — relativos à viewport */}
      <div
        aria-hidden="true"
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 280,
          height: 280,
          background: 'rgba(255,107,53,.12)',
          top: -80,
          right: -60,
        }}
      />
      <div
        aria-hidden="true"
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 180,
          height: 180,
          background: 'rgba(46,196,182,.08)',
          bottom: 200,
          left: -50,
        }}
      />

      {/* Inner — max-w 430 só pra constrain do conteúdo (mobile-first), o
          dark do outer ocupa o resto da tela em desktop */}
      <div
        className="flex flex-col mx-auto relative"
        style={{ maxWidth: 430, minHeight: '100dvh' }}
      >
        {/* auth-top — área dark com logo + tagline */}
        <div className="relative z-10 flex-shrink-0" style={{ padding: '60px 20px 32px' }}>
          <div
            className="font-extrabold text-white whitespace-nowrap"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(22px, 6.5vw, 30px)',
              letterSpacing: '-1px',
            }}
          >
            Quero<span style={{ color: 'var(--color-p1)' }}>Uma</span>Cor
          </div>
          <div
            className="mt-1.5"
            style={{
              fontSize: 15,
              color: 'rgba(255,255,255,.5)',
              lineHeight: 1.5,
            }}
          >
            {tagline}
          </div>
        </div>

        {/* auth-body — cream com top arredondado, flex-1 pra empurrar até o
            fim da tela */}
        <div
          className="relative z-10 flex-1"
          style={{
            background: 'var(--color-cream, #f7f3ed)',
            borderRadius: '28px 28px 0 0',
            padding: '28px 24px 40px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
