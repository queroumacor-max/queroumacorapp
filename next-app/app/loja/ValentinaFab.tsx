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
        textDecoration: 'none',
        border: '3px solid #fff',
        overflow: 'visible',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/img/valentina.webp"
        alt=""
        width={50}
        height={50}
        loading="lazy"
        style={{
          width: 50,
          height: 50,
          borderRadius: '50%',
          objectFit: 'cover',
          objectPosition: 'center top',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -6,
          right: -6,
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
