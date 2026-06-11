// MaquininhaCard — banner clicável + bottom sheet pra interessados em
// maquininha de cartão (parceria futura). Loga interesse em feature_interest
// (action='click' ao abrir, action='waitlist' ao confirmar com contato).

'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { BottomSheet } from '@/components/BottomSheet';
import { showToast } from '@/lib/toast';
import { logFeatureClick, joinFeatureWaitlist } from '@/lib/services/featureInterest';

export function MaquininhaCard() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  async function handleOpen() {
    setContact((profile?.phone as string | undefined) ?? '');
    setOpen(true);
    if (user) logFeatureClick('maquininha', user.id).catch(() => {});
  }

  async function handleSubmit() {
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      await joinFeatureWaitlist('maquininha', user.id, contact.trim());
      showToast('Avisaremos quando estiver disponível!', 'success');
      setOpen(false);
      setContact('');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao registrar.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center gap-3 p-4 rounded-2xl border border-[color:var(--color-border)] text-left"
        style={{
          background: 'linear-gradient(135deg, var(--color-cream), #ffe8d6)',
        }}
        aria-label="Maquininha — em breve"
      >
        <div className="text-3xl" aria-hidden="true">💳</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-[color:var(--color-ink)]">
            Maquininha de cartão (em breve)
          </div>
          <div className="text-xs text-[color:var(--color-muted)]">
            Contrate sua maquininha com um dos parceiros
          </div>
        </div>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} ariaLabel="Maquininha">
        <h2
          className="font-bold mb-3"
          style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}
        >
          💳 Maquininha — em breve
        </h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Estamos finalizando parcerias com operadoras pra você ter taxa
          melhor que no mercado. Deixe seu contato e te chamamos quando
          estiver disponível.
        </p>
        <label htmlFor="maquininha-contato" className="text-xs text-[color:var(--color-muted)] block mb-1.5">
          Telefone / WhatsApp
        </label>
        <input
          id="maquininha-contato"
          type="tel"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="(00) 00000-0000"
          className="w-full px-3 py-2.5 text-sm border border-[color:var(--color-border)] rounded-lg mb-3 bg-[color:var(--color-white)] text-[color:var(--color-ink)]"
          autoComplete="tel"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full px-4 py-3 text-sm font-bold bg-[color:var(--color-ink)] text-white rounded-lg disabled:opacity-60"
        >
          {submitting ? 'Registrando…' : 'Entrar na lista de interesse'}
        </button>
      </BottomSheet>
    </>
  );
}
