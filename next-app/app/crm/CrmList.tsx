// CrmList — client component que orquestra a tela /crm. Espelha o output
// de `loadCrm() + renderCrm()` em modules/crm.js: header de config
// (intervalo em meses + Salvar), gating PRO, estado vazio, lista de
// CrmCard.
//
// Estados:
//   - authLoading → skeleton
//   - !user → CTA login
//   - !isPro (via canSeeProFeature) → paywall PRO
//   - loading → skeleton de cards (3)
//   - error → mensagem inline
//   - allClients.length===0 → empty state ("ainda não tem clientes")
//   - filtered.length===0 (mas tem allClients) → "nenhum no intervalo"
//   - default → header config + lista filtrada
//
// O input de intervalo é otimista: ao clicar Salvar, dispara mutation;
// o valor mostrado vem do cache (hook). Erro de salvar mostra inline.

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useCrm } from '@/lib/hooks/useCrm';
import { canSeeProFeature } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { CrmCard } from './CrmCard';

function SkeletonCard() {
  return (
    <div
      className="bg-white rounded-2xl border border-[color:var(--color-border)] p-4 animate-pulse"
      aria-hidden="true"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/3 bg-[color:var(--color-border)] rounded" />
          <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded" />
        </div>
        <div className="h-4 w-16 bg-[color:var(--color-border)] rounded-full" />
      </div>
      <div className="h-16 bg-[color:var(--color-border)] rounded-lg mb-3" />
      <div className="flex gap-2">
        <div className="h-8 flex-1 bg-[color:var(--color-border)] rounded-xl" />
        <div className="h-8 flex-1 bg-[color:var(--color-border)] rounded-xl" />
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3" aria-label="Carregando clientes">
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// Header de config — input de intervalo + botão Salvar. Mostra a contagem
// "X meses sem serviço". Erro de save aparece logo abaixo. Mantém o valor
// editado em useState local pra não interferir com o cache server.
function IntervalConfig({
  current,
  onSave,
  saving,
  error,
}: {
  current: number;
  onSave: (n: number) => void;
  saving: boolean;
  error: Error | null;
}) {
  const [draft, setDraft] = useState(String(current));

  // Sincroniza quando o valor server muda (load inicial ou save bem-sucedido).
  useEffect(() => {
    setDraft(String(current));
  }, [current]);

  const dirty = draft !== String(current);

  return (
    <section className="bg-white rounded-2xl border border-[color:var(--color-border)] p-4 mb-4">
      <h2 className="text-sm font-bold mb-2 text-[color:var(--color-ink)]">
        Lembrar clientes após
      </h2>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={120}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-20 px-2 py-2 text-sm border border-[color:var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
          aria-label="Meses sem serviço"
        />
        <span className="text-sm text-[color:var(--color-muted)]">
          meses sem serviço
        </span>
        <button
          type="button"
          onClick={() => {
            const n = Math.floor(Number(draft) || 0);
            if (n >= 1) onSave(n);
          }}
          disabled={!dirty || saving}
          className="ml-auto px-4 py-2 text-xs font-bold rounded-lg bg-[color:var(--color-p1)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error.message || 'Erro ao salvar.'}
        </p>
      ) : null}
    </section>
  );
}

export function CrmList() {
  const { user, loading: authLoading } = useAuth();
  const policyUser = usePolicyUser();
  const {
    clients,
    allClients,
    loading,
    error,
    intervalMonths,
    setIntervalMonths,
    savingInterval,
    intervalError,
    generateDraft,
    isGenerating,
    logFollowUp,
    isLogging,
    buildWaUrl,
  } = useCrm();

  if (authLoading) {
    return <SkeletonList />;
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🔁
        </div>
        <h2 className="font-semibold mb-2">Entre pra reativar clientes</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Faça login pra ver seus clientes antigos e enviar lembretes.
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

  // Gate PRO via usePolicyUser (combina profile do banco com JWT metadata).
  if (!canSeeProFeature(policyUser)) {
    return (
      <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🔁
        </div>
        <h2 className="font-bold mb-2 text-[color:var(--color-ink)]">
          Reativar clientes é PRO
        </h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4 max-w-md mx-auto">
          Recupere clientes antigos com lembretes de repintura. O Seu Zé
          escreve a mensagem, você revisa e envia pelo WhatsApp.
        </p>
        <Link
          href="/pro"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Ativar PRO
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <>
        <IntervalConfig
          current={intervalMonths}
          onSave={setIntervalMonths}
          saving={savingInterval}
          error={intervalError}
        />
        <SkeletonList />
      </>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)]">
          Não foi possível carregar os clientes. Tente de novo em instantes.
        </p>
      </div>
    );
  }

  if (allClients.length === 0) {
    return (
      <>
        <IntervalConfig
          current={intervalMonths}
          onSave={setIntervalMonths}
          saving={savingInterval}
          error={intervalError}
        />
        <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
          <div className="text-5xl mb-3" aria-hidden="true">
            👥
          </div>
          <h2 className="font-semibold mb-2">Sem clientes pra reativar</h2>
          <p className="text-sm text-[color:var(--color-muted)]">
            Conforme você fecha orçamentos e registra obras, os clientes
            aparecem aqui.
          </p>
        </div>
      </>
    );
  }

  if (clients.length === 0) {
    return (
      <>
        <IntervalConfig
          current={intervalMonths}
          onSave={setIntervalMonths}
          saving={savingInterval}
          error={intervalError}
        />
        <div className="text-center py-10 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)]">
            Nenhum cliente com {intervalMonths}+ meses sem serviço. Diminua
            o intervalo pra ver mais.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <IntervalConfig
        current={intervalMonths}
        onSave={setIntervalMonths}
        saving={savingInterval}
        error={intervalError}
      />
      <div className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
        Para contatar · {clients.length}
      </div>
      <ul className="space-y-3">
        {clients.map((c) => (
          <li key={c.id}>
            <CrmCard
              client={c}
              isGeneratingGlobal={isGenerating}
              isLoggingGlobal={isLogging}
              onDraft={generateDraft}
              onSend={logFollowUp}
              buildWaUrl={buildWaUrl}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
