'use client';
// EditEspecialidadesForm — porta o modal `#edit-specs-modal` do vanilla
// (openEditEspecialidades + saveEspecialidades em modules/profile-edit.js)
// pra um picker de chips multi-select baseado no role do usuário.
//
// Diferenças vs vanilla:
//  - lista de especialidades vem do service getEspecialidadesByRole (não da
//    global _roleSpecs);
//  - state local (Set) em vez de mutação de className nos chips DOM;
//  - role `cliente`/`admin` esconde o picker inteiro com mensagem explicativa
//    (vanilla simplesmente não mostra o modal mas a UX fica confusa).
//
// O `profiles.specialties` é uma string CSV ("Residencial, Comercial, ...") —
// mantemos esse contrato pra interop com o vanilla que ainda lê do mesmo lugar.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { getEspecialidadesByRole } from '@/lib/services/profile';

export function EditEspecialidadesForm() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading, error, update, isUpdating } = useProfile();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [touched, setTouched] = useState(false);

  // Role efetiva — `role` é a coluna oficial; `user_type` é o legado pré-SQL
  // que algumas rows velhas ainda têm. Fallback pra metadata e por fim
  // 'pintor' (mesma escada do vanilla openEditEspecialidades linha 165).
  const role = useMemo(() => {
    return (
      profile?.role ||
      profile?.user_type ||
      (user?.user_metadata?.user_type as string | undefined) ||
      (user?.user_metadata?.role as string | undefined) ||
      'pintor'
    );
  }, [profile?.role, profile?.user_type, user?.user_metadata]);

  const options = useMemo(() => getEspecialidadesByRole(role), [role]);

  // Quando o profile carrega, popula o Set local com as specs já salvas.
  // Só roda uma vez (touched=false) pra não sobrescrever edições do usuário.
  useEffect(() => {
    if (!profile || touched) return;
    const csv = profile.specialties || '';
    const arr = csv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setSelected(new Set(arr));
  }, [profile, touched]);

  function toggle(spec: string) {
    setTouched(true);
    setSubmitSuccess(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(spec)) next.delete(spec);
      else next.add(spec);
      return next;
    });
  }

  async function handleSave() {
    if (selected.size === 0) {
      setSubmitError('Selecione pelo menos uma especialidade');
      return;
    }
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      const csv = [...selected].join(', ');
      await update({ specialties: csv });
      setSubmitSuccess(true);
      setTouched(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  if (authLoading || loading) {
    return (
      <div className="space-y-2 animate-pulse" aria-label="Carregando">
        <div className="h-8 bg-[color:var(--color-border)] rounded" />
        <div className="h-8 bg-[color:var(--color-border)] rounded w-3/4" />
      </div>
    );
  }

  if (!user) {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">
        Entre pra editar suas especialidades.
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-[color:var(--color-danger)]">
        Não foi possível carregar especialidades.
      </p>
    );
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">
        Especialidades estão disponíveis apenas para perfis profissionais
        (pintor, grafiteiro, automotivo).
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-[color:var(--color-muted)] mb-3">
        Toque pra selecionar/desmarcar.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Especialidades">
        {options.map((spec) => {
          const isSelected = selected.has(spec);
          return (
            <button
              key={spec}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => toggle(spec)}
              className={
                'px-3 py-2 rounded-full text-xs font-semibold border transition-colors ' +
                (isSelected
                  ? 'bg-[color:var(--color-ink)] text-white border-[color:var(--color-ink)]'
                  : 'bg-white text-[color:var(--color-ink)] border-[color:var(--color-border)] hover:bg-[color:var(--color-bg)]')
              }
            >
              {spec}
            </button>
          );
        })}
      </div>

      {submitError && (
        <p className="text-sm text-[color:var(--color-danger)] mt-3" role="alert">
          {submitError}
        </p>
      )}
      {submitSuccess && (
        <p className="text-sm text-[color:var(--color-p1)] mt-3" role="status">
          Especialidades salvas!
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={isUpdating || !touched}
        className="mt-4 w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {isUpdating ? 'Salvando...' : 'Salvar especialidades'}
      </button>
    </div>
  );
}
