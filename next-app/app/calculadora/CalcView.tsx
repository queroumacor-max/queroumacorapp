// CalcView — client component da /calculadora.
// Fórmula vanilla (modules/calc.js linha 25):
//   litros = ceil(area * fator * demaos / 11 * 1.1)
//   latas3.6L = ceil(litros / 3.6); galao18L = ceil(litros / 18)
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

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
