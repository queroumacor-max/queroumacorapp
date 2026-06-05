'use client';
// AliceFab — botão flutuante na /loja que leva pra /alice. Visível só
// pra cliente (e admin). Renderiza balão de fala "Posso ajudar?" ao lado
// do avatar pra convidar interação — antes era só badge "IA" que não
// comunicava nada.

import Link from 'next/link';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { isAdmin } from '@/lib/policies';

export function AliceFab() {
  const policyUser = usePolicyUser();
  const role = (policyUser?.role || '').toLowerCase();
  const visible = isAdmin(policyUser) || role === 'cliente';
  if (!visible) return null;

  return (
    <Link
      href="/alice"
      aria-label="Posso ajudar? Conversar com a Alice"
      title="Conversar com a Alice"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        textDecoration: 'none',
      }}
    >
      {/* Balão de fala — Alice convidando ("Posso ajudar?"). Tail apontando
          pro avatar à direita. Fica posicionado pra esquerda do círculo. */}
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          background: '#fff',
          color: '#7c3aed',
          fontWeight: 700,
          fontSize: 13,
          padding: '8px 14px',
          borderRadius: 18,
          boxShadow: '0 4px 12px rgba(0,0,0,.12), 0 1px 3px rgba(0,0,0,.08)',
          border: '1.5px solid rgba(124,58,237,.15)',
          whiteSpace: 'nowrap',
          fontFamily: 'var(--font-display)',
        }}
      >
        Posso ajudar?
        {/* Tail triangular apontando pra direita (pro avatar) */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '50%',
            right: -6,
            transform: 'translateY(-50%)',
            width: 0,
            height: 0,
            borderTop: '6px solid transparent',
            borderBottom: '6px solid transparent',
            borderLeft: '7px solid #fff',
            filter: 'drop-shadow(1px 0 0 rgba(124,58,237,.15))',
          }}
        />
      </span>

      {/* Círculo com avatar da Alice */}
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
          boxShadow: '0 6px 20px rgba(124,58,237,.4), 0 2px 6px rgba(0,0,0,.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '3px solid #fff',
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/img/alice.webp"
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
      </span>
    </Link>
  );
}
