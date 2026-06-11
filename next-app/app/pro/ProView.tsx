// ProView — cliente component da /pro. Mostra benefícios, preço e CTA.
// Estado do user (já PRO? grace period?) vem do useProfile pra trocar a
// UI quando aplicável (oculta "Assinar" se já é PRO, mostra "Estende
// assinatura" em vez).
'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { showToast } from '@/lib/toast';
import { startProCheckout } from '@/lib/services/billing-platform';

interface Feature {
  icon: string;
  label: string;
}

const FEATURES: readonly Feature[] = [
  { icon: '📥', label: 'Pedidos de orçamento ilimitados' },
  { icon: '🏆', label: 'Apareça no topo das buscas e do mapa' },
  { icon: '✓', label: 'Badge verificado no perfil' },
  { icon: '📊', label: 'Estatísticas avançadas do perfil' },
  { icon: '🎓', label: 'Acesso a cursos exclusivos' },
  { icon: '🤖', label: 'Orçamento gerado pelo Seu Zé' },
  { icon: '🐻', label: 'Seu Zé — chat e voz pra tirar dúvidas' },
  { icon: '🎨', label: 'Arte pra Instagram a partir da sua foto' },
];

export function ProView() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const isPro = !!profile?.is_pro;

  async function handleCheckout() {
    // Roteia pelo provider correto da plataforma: web → Mercado Pago,
    // iOS wrapper → Apple StoreKit IAP, Android wrapper → Google Play
    // Billing. Detalhes em `lib/services/billing-platform.ts` +
    // `docs/BILLING_STRATEGY.md`. Compliance Apple 3.1.1 / Google Play
    // 2024 exige IAP/Play Billing pra digital content.
    if (!user) {
      showToast('Faça login pra continuar', 'info');
      return;
    }
    await startProCheckout(user.id);
  }

  return (
    <div className="px-3.5 pt-4 pb-10">
      <h1
        className="font-extrabold text-center"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          color: 'var(--color-ink)',
          marginBottom: 8,
        }}
      >
        ⚡ Plano PRO
      </h1>

      {isPro ? (
        <div
          className="text-center font-bold text-white"
          style={{
            background: 'linear-gradient(135deg, var(--color-p3), var(--color-p1))',
            padding: '12px 16px',
            borderRadius: 14,
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          ✅ Você já é PRO! Continue aproveitando todas as features.
        </div>
      ) : null}

      {/* Card preço */}
      <div
        className="text-center text-white"
        style={{
          background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
          borderRadius: 18,
          padding: '20px 18px',
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontSize: 36,
            fontWeight: 800,
            fontFamily: 'var(--font-display)',
            lineHeight: 1,
          }}
        >
          R$39<span style={{ fontSize: 16, fontWeight: 400 }}>/mês</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
          Cancele quando quiser
        </div>
      </div>

      {/* Features */}
      <div className="flex flex-col gap-2.5" style={{ marginBottom: 18 }}>
        {FEATURES.map((f) => (
          <div
            key={f.label}
            className="flex items-center bg-white"
            style={{
              borderRadius: 12,
              padding: '12px 14px',
              boxShadow: '0 2px 6px rgba(0,0,0,.05)',
              fontSize: 14,
              color: 'var(--color-ink)',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 20 }}>{f.icon}</span>
            <span style={{ flex: 1 }}>{f.label}</span>
          </div>
        ))}
      </div>

      {/* CTA principal */}
      <button
        type="button"
        onClick={handleCheckout}
        disabled={isPro}
        className="w-full text-white font-bold"
        style={{
          padding: 16,
          background: isPro
            ? 'var(--color-muted)'
            : 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
          borderRadius: 14,
          fontSize: 16,
          border: 'none',
          cursor: isPro ? 'not-allowed' : 'pointer',
          marginBottom: 12,
          boxShadow: isPro
            ? 'none'
            : '0 6px 20px rgba(255,107,53,.35)',
        }}
      >
        {isPro ? 'Você já é PRO' : 'Assinar Agora'}
      </button>

      {/* Atalho pra trocar 100 pts por 1 mês PRO */}
      {!isPro ? (
        <Link
          href="/pontos"
          className="block w-full text-center font-bold"
          style={{
            padding: 14,
            background: 'transparent',
            border: '1.5px solid var(--color-border)',
            borderRadius: 14,
            fontSize: 14,
            color: 'var(--color-ink)',
            textDecoration: 'none',
          }}
        >
          🎁 Trocar 100 pontos por 1 mês PRO
        </Link>
      ) : null}

      <p
        className="text-center"
        style={{
          fontSize: 11,
          color: 'var(--color-muted)',
          marginTop: 16,
          lineHeight: 1.5,
        }}
      >
        Ao assinar, você concorda com os{' '}
        <Link
          href="/info/termos"
          style={{ color: 'var(--color-p1)', textDecoration: 'underline' }}
        >
          Termos
        </Link>{' '}
        e a{' '}
        <Link
          href="/info/privacidade"
          style={{ color: 'var(--color-p1)', textDecoration: 'underline' }}
        >
          Privacidade
        </Link>
        . Cobrança recorrente, cancele a qualquer momento.
      </p>
    </div>
  );
}
