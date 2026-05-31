// FlagsAdmin — client component que lista feature flags com toggle on/off
// e slider de rollout. RLS no banco já barra escrita de não-admin; o gate
// aqui é cosmético (esconde formulário pra reduzir confusão).
//
// Pattern alinhado com NotificationsList: skeleton, error state, lista. Inputs
// são "optimistic via mutation invalidation" — depois do save, a query é
// invalidada e re-busca o valor canônico do banco (sem optimistic UI manual
// porque feature flags são raramente editadas, latência aceitável).

'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useAllFlags } from '@/lib/hooks/useFeatureFlag';
import { isAdmin } from '@/lib/policies';
import type { FeatureFlag, FeatureFlagPatch } from '@/lib/services/featureFlags';

function FlagRow({
  flag,
  onUpdate,
  isUpdating,
}: {
  flag: FeatureFlag;
  onUpdate: (patch: FeatureFlagPatch) => void;
  isUpdating: boolean;
}) {
  // Estado local pra o slider (debounce visual — só dispara update no onPointerUp
  // pra não martelar o banco a cada pixel). `enabled` é toggle direto sem debounce.
  const [percent, setPercent] = useState<number>(flag.rollout_percent ?? 100);

  return (
    <div className="p-4 rounded-xl bg-white border border-[color:var(--color-border)] mb-3">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <code className="font-mono text-sm font-bold">{flag.key}</code>
            {flag.enabled ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                ON
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                OFF
              </span>
            )}
          </div>
          {flag.description ? (
            <p className="text-xs text-[color:var(--color-muted)]">{flag.description}</p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            checked={flag.enabled}
            disabled={isUpdating}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            className="w-5 h-5 accent-[color:var(--color-p1)]"
            aria-label={`Ativar ${flag.key}`}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-[color:var(--color-muted)] flex-shrink-0">
          Rollout
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          disabled={!flag.enabled || isUpdating}
          onChange={(e) => setPercent(parseInt(e.target.value, 10))}
          onPointerUp={() => {
            if (percent !== flag.rollout_percent) {
              onUpdate({ rollout_percent: percent });
            }
          }}
          onKeyUp={(e) => {
            // Acessibilidade: keyboard users dão release tab/enter ao terminar.
            if (e.key === 'Enter' && percent !== flag.rollout_percent) {
              onUpdate({ rollout_percent: percent });
            }
          }}
          className="flex-1 accent-[color:var(--color-p1)]"
          aria-label={`Rollout ${flag.key}`}
        />
        <span className="text-xs font-mono w-10 text-right">{percent}%</span>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="p-4 rounded-xl bg-white border border-[color:var(--color-border)] mb-3 animate-pulse">
      <div className="h-4 w-32 bg-[color:var(--color-border)] rounded mb-2" />
      <div className="h-3 w-2/3 bg-[color:var(--color-border)] rounded mb-3" />
      <div className="h-2 w-full bg-[color:var(--color-border)] rounded" />
    </div>
  );
}

export function FlagsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const { flags, loading, error, update, isUpdating, updateError } = useAllFlags();

  if (authLoading) {
    return (
      <div>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  // Gate client-side: checa is_admin via user_metadata. RLS no banco é o
  // gate real — se um não-admin bypassar isso, a UPDATE retorna RLS error.
  const policyUser = user
    ? {
        id: user.id,
        is_admin: (user.user_metadata?.is_admin as boolean | undefined) ?? false,
        role: (user.user_metadata?.role as string | undefined) ?? null,
      }
    : null;
  if (!isAdmin(policyUser)) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🔒
        </div>
        <h2 className="font-semibold mb-2">Acesso restrito</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          Apenas administradores podem editar feature flags.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)]">
          Não foi possível carregar as flags. Tente recarregar a página.
        </p>
      </div>
    );
  }

  if (flags.length === 0) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <p className="text-sm text-[color:var(--color-muted)]">
          Nenhuma flag cadastrada. Rode a migration de feature_flags no Supabase.
        </p>
      </div>
    );
  }

  return (
    <div>
      {updateError ? (
        <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          Falha ao salvar: {updateError.message}
        </div>
      ) : null}
      {flags.map((flag) => (
        <FlagRow
          key={flag.key}
          flag={flag}
          isUpdating={isUpdating}
          onUpdate={(patch) => {
            // Fire-and-forget: o erro vai pro `updateError` via mutation state
            // e renderiza no banner acima. Sem await aqui pra não bloquear UI.
            void update({ key: flag.key, patch });
          }}
        />
      ))}
    </div>
  );
}
