'use client';
// ValentinaFab — botão flutuante na /loja que leva pra /valentina.
// Posicionado acima do BottomNav (60px + safe-area) pra não sobrepor.
// Aparece em todas as páginas /loja (lista + detalhe + carrinho) onde
// for renderizado.

import Link from 'next/link';

export function ValentinaFab() {
  return (
    <Link
      href="/valentina"
      aria-label="Conversar com a Valentina"
      title="Conversar com a Valentina"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        zIndex: 50,
        width: 56,
        height: 56,
        borderRadius: 28,
        background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
        boxShadow: '0 6px 20px rgba(124,58,237,.4), 0 2px 6px rgba(0,0,0,.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: 22,
        color: '#fff',
        textDecoration: 'none',
        border: '2px solid rgba(255,255,255,.6)',
      }}
    >
      V
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -4,
          right: -4,
          background: '#fff',
          color: '#7c3aed',
          fontSize: 10,
          fontWeight: 800,
          borderRadius: 999,
          padding: '2px 6px',
          lineHeight: 1.2,
          boxShadow: '0 1px 4px rgba(0,0,0,.2)',
        }}
      >
        IA
      </span>
    </Link>
  );
}
