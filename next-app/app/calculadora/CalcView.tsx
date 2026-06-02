// CalcView — client component da /calculadora.
// Fórmula vanilla (modules/calc.js linha 25):
//   litros = ceil(area * fator * demaos / 11 * 1.1)
//   latas3.6L = ceil(litros / 3.6); galao18L = ceil(litros / 18)
'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { canSeeProFeature } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { showToast } from '@/lib/toast';

const SURFACE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Parede nova / massa corrida' },
  { value: 1.2, label: 'Parede antiga (1 demão extra)' },
  { value: 1.5, label: 'Concreto ou tijolo aparente' },
  { value: 0.8, label: 'Teto liso' },
];

export function CalcView() {
  const [area, setArea] = useState('');
  const [fator, setFator] = useState(1);
  const [demaos, setDemaos] = useState(2);
  const [estimating, setEstimating] = useState(false);
  const policyUser = usePolicyUser();
  const isPro = canSeeProFeature(policyUser);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Estimar metragem por foto (vanilla modules/calc.js estimarAreaPorFoto).
  // Gate PRO + envia FormData pra /api/area-from-photo. Resposta: area_m2 +
  // justification. Popula o input automaticamente.
  async function handleEstimar() {
    if (!isPro) {
      showToast('Recurso PRO — assine para liberar', 'info');
      return;
    }
    fileRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast('Foto acima de 8MB — tente uma menor', 'error');
      return;
    }
    setEstimating(true);
    showToast('Analisando foto…', 'info');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/area-from-photo', { method: 'POST', body: fd });
      const data = (await res.json()) as {
        area_m2?: number;
        justification?: string;
        error?: string;
      };
      if (!res.ok) {
        showToast(data.error || 'Erro ao analisar foto', 'error');
        return;
      }
      const m2 = Number(data.area_m2);
      if (!isFinite(m2) || m2 <= 0) {
        showToast('Não foi possível estimar essa foto', 'error');
        return;
      }
      const rounded = Math.round(m2 * 10) / 10;
      setArea(String(rounded));
      showToast(
        `Estimativa: ${rounded} m²` +
          (data.justification ? ` · ${data.justification}` : ''),
        'success',
      );
    } catch (err) {
      showToast((err as Error).message || 'Erro ao analisar foto', 'error');
    } finally {
      setEstimating(false);
    }
  }

  const result = useMemo(() => {
    const a = parseFloat(area);
    if (!isFinite(a) || a <= 0) return null;
    const litros = Math.ceil((a * fator * demaos) / 11 * 1.1);
    const latas = Math.ceil(litros / 3.6);
    const galoes = Math.ceil(litros / 18);
    return { litros, latas, galoes };
  }, [area, fator, demaos]);

  return (
    <div className="px-3.5 pt-4 pb-8">
      <h1
        className="font-extrabold"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          marginBottom: 14,
          color: 'var(--color-ink)',
        }}
      >
        🖌️ Calculadora de Tinta
      </h1>

      <div
        className="text-white"
        style={{
          background: 'var(--color-ink)',
          borderRadius: 18,
          padding: 18,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: 'rgba(255,255,255,.5)',
            marginBottom: 14,
            textTransform: 'uppercase',
            letterSpacing: '.05em',
          }}
        >
          Em parceria com a Cali Colors
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="number"
            inputMode="decimal"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Área total em m²"
            className="w-full text-white outline-none"
            style={{
              padding: 12,
              borderRadius: 12,
              border: '1.5px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.07)',
              fontSize: 16,
            }}
          />

          {/* 📷 Estimar metragem por foto (PRO) — vanilla calc.js linha 34.
              Botão gradient roxo→laranja, abre input de foto, manda pro
              /api/area-from-photo, popula a área automaticamente. */}
          <button
            type="button"
            onClick={handleEstimar}
            disabled={estimating}
            className="text-white font-bold flex items-center justify-center gap-2"
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              border: 'none',
              fontSize: 14,
              background: 'linear-gradient(135deg, #8338ec, var(--color-p1))',
              boxShadow: '0 4px 12px rgba(131,56,236,.3)',
              cursor: estimating ? 'wait' : 'pointer',
              opacity: estimating ? 0.7 : 1,
            }}
          >
            {estimating ? 'Analisando…' : '📷 Estimar metragem por foto'}
            {!isPro ? (
              <span
                className="text-white font-extrabold"
                style={{
                  background: 'rgba(255,255,255,.25)',
                  fontSize: 9,
                  padding: '2px 7px',
                  borderRadius: 10,
                  letterSpacing: '.05em',
                }}
              >
                PRO
              </span>
            ) : null}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <select
            value={fator}
            onChange={(e) => setFator(parseFloat(e.target.value))}
            className="w-full text-white outline-none"
            style={{
              padding: 12,
              borderRadius: 12,
              border: '1.5px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.07)',
              fontSize: 14,
            }}
          >
            {SURFACE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} style={{ color: 'var(--color-ink)' }}>
                {o.label}
              </option>
            ))}
          </select>

          <div>
            <div
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,.5)',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '.05em',
              }}
            >
              Nº de demãos
            </div>
            <div className="flex gap-2">
              {[1, 2, 3].map((n) => {
                const active = demaos === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDemaos(n)}
                    className="flex-1 font-bold"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      fontSize: 13,
                      background: active ? 'var(--color-p1)' : 'rgba(255,255,255,.07)',
                      color: active ? '#fff' : 'rgba(255,255,255,.7)',
                      border: active
                        ? '1.5px solid var(--color-p1)'
                        : '1.5px solid rgba(255,255,255,.14)',
                      cursor: 'pointer',
                    }}
                  >
                    {n} demão{n > 1 ? 's' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {result ? (
        <div
          className="text-white text-center"
          style={{
            background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
            borderRadius: 18,
            padding: 22,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.7 }}>VOCÊ VAI PRECISAR DE</div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
            }}
          >
            {result.litros} L
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>litros de tinta</div>
          <div style={{ fontSize: 13, marginTop: 10, opacity: 0.95 }}>
            ≈ {result.latas} latas 3,6L &nbsp;ou&nbsp; {result.galoes} galão 18L
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2" style={{ marginBottom: 14 }}>
        {[
          ['💡', 'Rendimento médio: 1L cobre ~10–12m² com 2 demãos em superfície lisa.'],
          ['🛒', 'Compre 10% a mais para retoques futuros.'],
        ].map(([icon, text]) => (
          <div
            key={text}
            className="bg-white flex gap-2.5"
            style={{
              borderRadius: 14,
              padding: 13,
              fontSize: 13,
              color: '#555',
              boxShadow: '0 2px 8px rgba(0,0,0,.05)',
            }}
          >
            <span style={{ fontSize: 18 }}>{icon}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>

      <Link
        href="/loja"
        className="block w-full text-center text-white font-bold"
        style={{
          padding: 14,
          background: 'var(--color-p1)',
          borderRadius: 14,
          fontSize: 14,
        }}
      >
        Comprar na Cali Colors
      </Link>
    </div>
  );
}
