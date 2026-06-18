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

const SURFACE_OPTIONS: Record<'parede' | 'teto', ReadonlyArray<{ value: number; label: string }>> = {
  parede: [
    { value: 1, label: 'Parede nova / massa corrida' },
    { value: 1.2, label: 'Parede antiga (1 demão extra)' },
    { value: 1.5, label: 'Concreto ou tijolo aparente' },
  ],
  teto: [
    { value: 0.8, label: 'Teto liso' },
    { value: 1, label: 'Teto com textura' },
  ],
};

// Cobertura por unidade num acabamento de ~2 demãos (base do QA):
//   quartinho 0,9L ≈ 5 m² · galão 3,6L ≈ 20 m² · lata 18L ≈ 100 m².
// Resultado SEMPRE em unidades (nunca litros), arredondando pra cima.
interface UnitQty { count: number; label: string }

function combineUnits(areaM2: number): UnitQty[] {
  let rem = Math.ceil(areaM2);
  const out: UnitQty[] = [];
  const latas = Math.floor(rem / 100);
  if (latas > 0) {
    out.push({ count: latas, label: 'lata 18L' });
    rem -= latas * 100;
  }
  if (rem > 0) {
    if (rem <= 5) out.push({ count: 1, label: 'quartinho 0,9L' });
    else if (rem <= 20) out.push({ count: 1, label: 'galão 3,6L' });
    else if (rem <= 60) out.push({ count: Math.ceil(rem / 20), label: 'galão 3,6L' });
    else out.push({ count: 1, label: 'lata 18L' }); // >60 m² → 1 lata (mais prático que 4+ galões)
  }
  if (out.length === 0) out.push({ count: 1, label: 'quartinho 0,9L' });
  // Junta labels iguais (ex.: lata do floor + lata do arredondamento) e ordena.
  const merged = new Map<string, number>();
  for (const u of out) merged.set(u.label, (merged.get(u.label) ?? 0) + u.count);
  const order = ['lata 18L', 'galão 3,6L', 'quartinho 0,9L'];
  return order.filter((l) => merged.has(l)).map((l) => ({ count: merged.get(l)!, label: l }));
}

function pluralUnit({ count, label }: UnitQty): string {
  if (count === 1) return `1 ${label}`;
  const base = label.split(' ')[0]!;
  const size = label.slice(base.length);
  const pl = base === 'galão' ? 'galões' : base === 'lata' ? 'latas' : 'quartinhos';
  return `${count} ${pl}${size}`;
}

export function CalcView() {
  const [mode, setMode] = useState<'parede' | 'teto'>('parede');
  const [area, setArea] = useState('');       // teto: direto em m²
  const [altura, setAltura] = useState('');   // parede: altura em m
  const [comp, setComp] = useState('');       // parede: comprimento em m
  const [fator, setFator] = useState(1);
  const [demaos, setDemaos] = useState(2);
  const [estimating, setEstimating] = useState(false);
  const policyUser = usePolicyUser();
  const isPro = canSeeProFeature(policyUser);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function switchMode(m: 'parede' | 'teto') {
    setMode(m);
    setArea('');
    setAltura('');
    setComp('');
    setFator(SURFACE_OPTIONS[m][0]!.value);
  }

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

  const effectiveArea = useMemo(() => {
    if (mode === 'teto') return parseFloat(area);
    const h = parseFloat(altura);
    const c = parseFloat(comp);
    return isFinite(h) && h > 0 && isFinite(c) && c > 0 ? h * c : NaN;
  }, [mode, area, altura, comp]);

  const result = useMemo(() => {
    const a = effectiveArea;
    if (!isFinite(a) || a <= 0) return null;
    // Demanda em m² ajustada pelo substrato (fator) e pelas demãos (base = 2,
    // já que a cobertura por unidade considera acabamento de 2 a 3 demãos).
    const demandM2 = a * fator * (demaos / 2);
    return { areaM2: a, demandM2, units: combineUnits(demandM2) };
  }, [effectiveArea, fator, demaos]);

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
          {/* Toggle Parede / Teto */}
          <div className="flex gap-2">
            {(['parede', 'teto'] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className="flex-1 font-bold"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    fontSize: 14,
                    background: active ? 'var(--color-p1)' : 'rgba(255,255,255,.07)',
                    color: active ? '#fff' : 'rgba(255,255,255,.6)',
                    border: active ? '1.5px solid var(--color-p1)' : '1.5px solid rgba(255,255,255,.14)',
                    cursor: 'pointer',
                  }}
                >
                  {m === 'parede' ? '🧱 Parede' : '⬜ Teto'}
                </button>
              );
            })}
          </div>

          {mode === 'teto' ? (
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
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <input
                type="number"
                inputMode="decimal"
                value={altura}
                onChange={(e) => setAltura(e.target.value)}
                placeholder="Altura (m)"
                className="w-full min-w-0 text-white outline-none"
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: '1.5px solid rgba(255,255,255,.14)',
                  background: 'rgba(255,255,255,.07)',
                  fontSize: 15,
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="number"
                inputMode="decimal"
                value={comp}
                onChange={(e) => setComp(e.target.value)}
                placeholder="Comprimento (m)"
                className="w-full min-w-0 text-white outline-none"
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: '1.5px solid rgba(255,255,255,.14)',
                  background: 'rgba(255,255,255,.07)',
                  fontSize: 15,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          {mode === 'parede' && isFinite(effectiveArea) && effectiveArea > 0 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: -6 }}>
              Área calculada: {effectiveArea.toFixed(2)} m²
            </div>
          )}

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
            {SURFACE_OPTIONS[mode].map((o) => (
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
          <div style={{ fontSize: 11, opacity: 0.7 }}>SUGERIMOS A QUANTIDADE ABAIXO</div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              lineHeight: 1.2,
              marginTop: 6,
            }}
          >
            {result.units.map(pluralUnit).join('  +  ')}
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
            pra cobrir ~{Math.ceil(result.areaM2)} m² · {demaos} {demaos === 1 ? 'demão' : 'demãos'}
            {fator !== 1 ? ` · superfície ${fator}×` : ''}
          </div>
          <div style={{ fontSize: 10.5, marginTop: 12, opacity: 0.85, lineHeight: 1.45 }}>
            Esse cálculo pode variar conforme a qualidade da tinta, o substrato e
            o modo de aplicação.
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2" style={{ marginBottom: 14 }}>
        {[
          ['💡', 'O rendimento médio pode mudar com o acabamento, substrato, aplicação e qualidade da tinta. Como base: galão 3,6L cobre ~20m² e lata 18L ~100m², em 2 a 3 demãos.'],
          ['🛒', 'Compre um pouco a mais para retoques futuros.'],
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
