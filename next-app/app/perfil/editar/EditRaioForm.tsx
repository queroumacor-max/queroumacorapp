'use client';
// EditRaioForm — porta o modal `#edit-radius-modal` do vanilla
// (openEditRaio + saveRaio em modules/profile-edit.js) pra um slider de
// km (1..500) + opção "sem limite" (estado inteiro).
//
// `service_radius` no banco é integer; null = "sem limite" / "atende todo o
// estado". Mesma semântica do vanilla (saveRaio linha 221) — UI traduz pra
// um checkbox separado pra ficar mais explícito que slider==null.
//
// Por que slider e não select?
//  - vanilla usava <select> com valores discretos (5, 10, 25, 50, 100, 200,
//    'estado'). Slider dá granularidade fina (1km) sem complicar a UI; o
//    estado=null fica como toggle separado embaixo do slider.

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';

const MIN_KM = 1;
const MAX_KM = 500;
const DEFAULT_KM = 25;

export function EditRaioForm() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading, error, update, isUpdating } = useProfile();

  const [km, setKm] = useState<number>(DEFAULT_KM);
  const [unlimited, setUnlimited] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Hidrata do profile assim que chega. null no banco → unlimited=true.
  useEffect(() => {
    if (!profile || touched) return;
    if (profile.service_radius == null) {
      setUnlimited(true);
      setKm(DEFAULT_KM);
    } else {
      setUnlimited(false);
      setKm(profile.service_radius);
    }
  }, [profile, touched]);

  async function handleSave() {
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      await update({ service_radius: unlimited ? null : km });
      setSubmitSuccess(true);
      setTouched(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  if (authLoading || loading) {
    return (
      <div className="space-y-2 animate-pulse" aria-label="Carregando">
        <div className="h-4 bg-[color:var(--color-border)] rounded w-1/2" />
        <div className="h-8 bg-[color:var(--color-border)] rounded" />
      </div>
    );
  }

  if (!user) {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">
        Entre pra editar seu raio de atendimento.
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-[color:var(--color-danger)]">
        Não foi possível carregar suas preferências.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-[color:var(--color-muted)] mb-3">
        Distância máxima que você aceita atender (a partir da sua cidade).
      </p>

      <div className={unlimited ? 'opacity-40 pointer-events-none' : ''}>
        <label htmlFor="radius-slider" className="block text-sm font-semibold mb-2">
          Raio: <span className="text-[color:var(--color-p1)]">{km} km</span>
        </label>
        <input
          id="radius-slider"
          type="range"
          min={MIN_KM}
          max={MAX_KM}
          step={1}
          value={km}
          onChange={(e) => {
            setTouched(true);
            setSubmitSuccess(false);
            setKm(parseInt(e.target.value, 10));
          }}
          disabled={unlimited}
          className="w-full"
          aria-valuemin={MIN_KM}
          aria-valuemax={MAX_KM}
          aria-valuenow={km}
        />
        <div className="flex justify-between text-xs text-[color:var(--color-muted)] mt-1">
          <span>{MIN_KM} km</span>
          <span>{MAX_KM} km</span>
        </div>
      </div>

      <label className="flex items-center gap-2 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={unlimited}
          onChange={(e) => {
            setTouched(true);
            setSubmitSuccess(false);
            setUnlimited(e.target.checked);
          }}
          className="w-4 h-4 accent-[color:var(--color-p1)]"
        />
        <span className="text-sm">
          Sem limite — atendo em qualquer cidade do estado
        </span>
      </label>

      {submitError && (
        <p className="text-sm text-[color:var(--color-danger)] mt-3" role="alert">
          {submitError}
        </p>
      )}
      {submitSuccess && (
        <p className="text-sm text-[color:var(--color-p1)] mt-3" role="status">
          Raio salvo!
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={isUpdating || !touched}
        className="mt-4 w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {isUpdating ? 'Salvando...' : 'Salvar raio'}
      </button>
    </div>
  );
}
