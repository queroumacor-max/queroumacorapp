'use client';
// EmailVerifyBanner — mostra alerta amarelo no topo quando o user está
// logado mas não confirmou o email. Botão "Reenviar" usa Supabase
// `auth.resend({type:'signup'})`. Desaparece sozinho quando o user
// abre o link de confirmação (AuthProvider atualiza emailVerified pelo
// onAuthStateChange).
//
// Decisão: NÃO usa dismiss persistente em localStorage — o gate de
// publicar/comentar/DM já bloqueia em runtime, mas o banner reforça que
// o user precisa confirmar. Sumir significaria o user esquecer e a
// experiência ficar confusa quando a ação for negada.

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { showToast } from '@/lib/toast';

export function EmailVerifyBanner() {
  const { user, emailVerified, resendVerification } = useAuth();
  const [sending, setSending] = useState(false);

  if (!user || emailVerified !== false) return null;

  async function handleResend() {
    setSending(true);
    const { error } = await resendVerification();
    setSending(false);
    if (error) {
      showToast(error, 'error');
      return;
    }
    showToast('Email reenviado. Olha sua caixa de entrada.', 'success');
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: '#fff8e1',
        borderBottom: '1px solid #f0d68b',
        color: '#5a4500',
      }}
      className="px-3 py-2 text-xs flex items-center gap-2"
    >
      <span aria-hidden="true">✉️</span>
      <span className="flex-1 leading-snug">
        Confirme seu email para publicar, comentar e enviar mensagens.
      </span>
      <button
        type="button"
        onClick={handleResend}
        disabled={sending}
        className="px-2.5 py-1 rounded font-semibold text-xs disabled:opacity-60"
        style={{ background: '#5a4500', color: '#fff8e1' }}
      >
        {sending ? 'Enviando…' : 'Reenviar'}
      </button>
    </div>
  );
}
