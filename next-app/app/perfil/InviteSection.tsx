'use client';
// InviteSection — convite por LINK de perfil (sem mais código QUC-XXXXX).
//
// O cadastro do app é invite-only: alguém já cadastrado precisa compartilhar
// o próprio perfil; o link tem ?ref=<userId> que o ReferralCapture captura
// e o SignupFlow libera a criação de conta. Aqui é só o CTA de share.

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { showToast } from '@/lib/toast';

export function InviteSection() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [busy, setBusy] = useState(false);

  async function handleShare() {
    if (!user || busy) return;
    setBusy(true);
    try {
      const slug = user.id || (profile as { tag?: string | null } | null)?.tag;
      if (!slug) {
        showToast('Configure o perfil antes de compartilhar', 'info');
        return;
      }
      const url = `${window.location.origin}/perfil/${slug}?ref=${encodeURIComponent(user.id)}`;
      const name =
        (profile as { name?: string | null } | null)?.name ?? 'um pintor';
      const text =
        `Te indica! Conhece ${name} no QueroUmaCor — o app dos pintores profissionais. O link libera o cadastro:`;
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ title: 'QueroUmaCor', text, url });
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
        }
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(`${text} ${url}`);
        showToast('Link copiado! Manda pro amigo no WhatsApp.', 'success');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="bg-white"
      style={{
        borderRadius: 14,
        padding: 16,
        boxShadow: '0 2px 8px rgba(0,0,0,.05)',
      }}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          aria-hidden="true"
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
            fontSize: 20,
          }}
        >
          🤝
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="font-bold"
            style={{
              fontSize: 14,
              color: 'var(--color-ink)',
            }}
          >
            Convide pintores e clientes
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-muted)',
              marginTop: 2,
              lineHeight: 1.5,
            }}
          >
            Cadastro é por convite. Compartilha seu perfil — o link já libera
            a criação de conta automaticamente, sem código nenhum.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={handleShare}
        disabled={!user || busy}
        className="w-full text-white font-bold"
        style={{
          padding: 12,
          borderRadius: 10,
          fontSize: 13,
          background: 'var(--color-ink)',
          border: 'none',
          cursor: !user || busy ? 'not-allowed' : 'pointer',
          opacity: !user || busy ? 0.5 : 1,
        }}
      >
        ↗ Compartilhar meu perfil
      </button>
      <p
        className="text-[11px]"
        style={{
          color: 'var(--color-muted)',
          marginTop: 8,
          textAlign: 'center',
          lineHeight: 1.4,
        }}
      >
        Cada amigo que se cadastrar pelo seu link = <strong>+1 ponto</strong> pra você.
      </p>
    </div>
  );
}
