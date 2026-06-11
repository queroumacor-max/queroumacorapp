// DeleteAccountSection — card de exclusão de conta LGPD. Dois caminhos:
//   1. "Excluir agora" — POST /api/delete-account → anonimiza + soft-delete
//      + apaga auth.user. Redireciona pra /login.
//   2. "Pedir suporte" — link wa.me pra quem prefere humano no fluxo.
//
// Confirmação via Dialog evita clique acidental. Endpoint é idempotente.

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { showToast } from '@/lib/toast';
import { getSupabase } from '@/lib/supabase';

const SUPPORT_PHONE = '5511959765031';
const waDeleteHref =
  `https://wa.me/${SUPPORT_PHONE}?text=` +
  encodeURIComponent(
    'Olá! Quero solicitar a exclusão da minha conta no QueroUmaCor (LGPD).',
  );

export function DeleteAccountSection() {
  const { user, signOut } = useAuth();
  const dialog = useDialog();
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete() {
    if (!user) {
      showToast('Faça login pra excluir a conta.', 'info');
      return;
    }
    const ok = await dialog.confirm(
      'Vai apagar seu perfil, posts, conversas e dados pessoais. Isso não dá pra desfazer. Tem certeza?',
      { title: 'Excluir conta', okLabel: 'Excluir agora', danger: true },
    );
    if (!ok) return;

    const reconfirm = await dialog.confirm(
      'Confirma exclusão permanente?',
      { title: 'Última confirmação', okLabel: 'Sim, excluir', danger: true },
    );
    if (!reconfirm) return;

    setSubmitting(true);
    try {
      const sb = getSupabase();
      const session = (await sb.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) {
        showToast('Sessão expirou — faça login de novo.', 'error');
        setSubmitting(false);
        return;
      }
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => 'falha');
        throw new Error(msg || 'falha');
      }
      showToast('Conta excluída.', 'success');
      try {
        await signOut();
      } catch {
        /* silent — endpoint já apagou o auth.user */
      }
      window.location.href = '/login';
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao excluir.', 'error');
      setSubmitting(false);
    }
  }

  return (
    <article className="bg-white rounded-2xl p-5 shadow-sm">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl" aria-hidden="true">🗑️</span>
        <div className="flex-1">
          <h2 className="font-bold text-base mb-1 text-[color:var(--color-danger)]">
            Excluir minha conta
          </h2>
          <p className="text-sm text-[color:var(--color-muted)] leading-relaxed">
            Apaga perfil, posts, conversas, anota&ccedil;&otilde;es e
            dados pessoais. Anonimiza&ccedil;&atilde;o imediata; arquivos
            entram em fila de exclus&atilde;o (30 dias). Atende LGPD Art.
            18 VI.
          </p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleDelete}
          disabled={submitting || !user}
          className="px-3 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-60"
          style={{ background: 'var(--color-danger)' }}
        >
          {submitting ? 'Excluindo…' : 'Excluir agora'}
        </button>
        <Link
          href={waDeleteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 text-xs font-semibold rounded-lg border border-[color:var(--color-border)] text-[color:var(--color-ink)]"
        >
          Falar com suporte
        </Link>
      </div>
    </article>
  );
}
