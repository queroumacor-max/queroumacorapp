// LeadsList — client component que renderiza a lista de leads disponíveis
// pra o pintor atual. Espelha o caminho do feed "for_sale" do vanilla mas
// como tela dedicada (em vez de cards inline no feed principal).
//
// Padrão de estados, alinhado com NotificationsList:
//   - authLoading → skeleton (sessão sendo restaurada)
//   - !user → CTA pra login
//   - loading → skeleton de cards (4)
//   - error → mensagem inline (sem throw)
//   - leads.length===0 → empty state com dica
//   - default → grid de LeadCard
//
// Tratamento de comprarError: banner vermelho acima da grid quando a última
// mutation falhou. Some quando o usuário tenta de novo (TanStack reset o
// estado a cada mutate).

'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useLeads } from '@/lib/hooks/useLeads';
import { LeadCard } from '@/components/LeadCard';

// Skeleton card replica o footprint do LeadCard real (aspect 4:3 + 96px de
// metadata) pra que a transição não cause CLS quando os dados chegam.
function SkeletonCard() {
  return (
    <div
      className="bg-white rounded-2xl border border-[color:var(--color-border)] overflow-hidden animate-pulse"
      aria-hidden="true"
    >
      <div className="w-full aspect-[4/3] bg-[color:var(--color-border)]" />
      <div className="p-4 space-y-2">
        <div className="h-3 w-1/3 bg-[color:var(--color-border)] rounded" />
        <div className="h-3 w-full bg-[color:var(--color-border)] rounded" />
        <div className="h-3 w-2/3 bg-[color:var(--color-border)] rounded" />
        <div className="flex justify-between items-center pt-2">
          <div className="h-4 w-20 bg-[color:var(--color-border)] rounded" />
          <div className="h-9 w-32 bg-[color:var(--color-border)] rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Carregando leads">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function LeadsList() {
  const { user, loading: authLoading } = useAuth();
  const { leads, loading, error, comprar, isComprarando, comprarError } = useLeads();

  if (authLoading) {
    return <SkeletonGrid />;
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🎨
        </div>
        <h2 className="font-semibold mb-2">Entre pra ver os leads</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Oportunidades de obra aparecem aqui depois que você faz login.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  if (loading) {
    return <SkeletonGrid />;
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)]">
          Não foi possível carregar os leads. Tente de novo em instantes.
        </p>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          📭
        </div>
        <h2 className="font-semibold mb-2">Sem leads disponíveis no momento</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          Complete seu perfil pra receber mais oportunidades.
        </p>
      </div>
    );
  }

  return (
    <div>
      {comprarError ? (
        <div
          role="alert"
          className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {comprarError.message || 'Não foi possível comprar o lead. Tente de novo.'}
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onComprar={() => comprar(lead.id)}
            isComprarando={isComprarando}
          />
        ))}
      </div>
    </div>
  );
}
