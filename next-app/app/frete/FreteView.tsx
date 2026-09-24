// FreteView — calculadora de frete (custo de deslocamento até a obra).
// Pedido do usuário (2026-09-24): "calcular KM por litro vs valor litro".
// Toda a conta vive em `lib/frete.ts` (pura e testada); aqui é só a tela.
'use client';

import { useMemo, useState } from 'react';
import { calcularFrete, lerNumero } from '@/lib/frete';
import { fmtBRL } from '@/lib/utils';
import { copyToClipboard } from '@/lib/native';
import { showToast } from '@/lib/toast';

const brl = (n: number): string => `R$ ${fmtBRL(n)}`;

const fmtNum = (n: number, casas = 1) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });

interface CampoProps {
  id: string;
  label: string;
  sufixo: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inteiro?: boolean;
}

function Campo({ id, label, sufixo, value, onChange, placeholder, inteiro }: CampoProps) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-[13px] font-bold mb-1.5" style={{ color: 'var(--color-muted)' }}>
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-white)' }}>
        <input
          id={id}
          inputMode={inteiro ? 'numeric' : 'decimal'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent outline-none py-3 text-sm"
          style={{ color: 'var(--color-ink)' }}
        />
        <span className="shrink-0 text-[13px]" style={{ color: 'var(--color-muted)' }}>{sufixo}</span>
      </div>
    </div>
  );
}

export function FreteView() {
  const [km, setKm] = useState('');
  const [idaEVolta, setIdaEVolta] = useState(true);
  const [viagens, setViagens] = useState('1');
  const [kmL, setKmL] = useState('');
  const [preco, setPreco] = useState('');
  const [extras, setExtras] = useState('');

  const r = useMemo(
    () =>
      calcularFrete({
        kmTrajeto: lerNumero(km),
        idaEVolta,
        viagens: lerNumero(viagens),
        kmPorLitro: lerNumero(kmL),
        precoLitro: lerNumero(preco),
        extrasPorViagem: lerNumero(extras),
      }),
    [km, idaEVolta, viagens, kmL, preco, extras],
  );

  async function copiar() {
    if (!r) return;
    const texto =
      `Frete: ${brl(r.custoTotal)} (${fmtNum(r.kmTotal)} km` +
      `${r.custoExtras > 0 ? `, com ${brl(r.custoExtras)} de pedágio/estacionamento` : ''})`;
    const ok = await copyToClipboard(texto);
    showToast(ok ? 'Copiado — cole no orçamento' : 'Não consegui copiar', ok ? 'success' : 'error');
  }

  return (
    <div className="px-3.5 pt-4 pb-8 flex flex-col gap-4">
      <div>
        <h1 className="font-extrabold" style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--color-ink)' }}>
          🚚 Calculadora de Frete
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Quanto custa ir até a obra: distância, consumo do carro e preço do litro.
        </p>
      </div>

      <section className="rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-white)' }}>
        <h2 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Trajeto</h2>
        <Campo id="frete-km" label="Distância até a obra" sufixo="km" value={km} onChange={setKm} placeholder="25" />
        <div className="flex gap-2" role="group" aria-label="Contar trajeto">
          {([true, false] as const).map((v) => {
            const ativo = idaEVolta === v;
            return (
              <button
                key={String(v)}
                type="button"
                aria-pressed={ativo}
                onClick={() => setIdaEVolta(v)}
                className="flex-1 font-bold text-sm rounded-xl"
                style={{
                  minHeight: 44,
                  background: ativo ? 'var(--color-ink)' : 'var(--color-white)',
                  color: ativo ? 'var(--color-white)' : 'var(--color-ink)',
                  border: '1.5px solid var(--color-ink)',
                }}
              >
                {v ? 'Ida e volta' : 'Só ida'}
              </button>
            );
          })}
        </div>
        <Campo id="frete-viagens" label="Quantas viagens (dias de obra)" sufixo="x" value={viagens} onChange={setViagens} placeholder="1" inteiro />
      </section>

      <section className="rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-white)' }}>
        <h2 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Veículo e combustível</h2>
        <div className="grid grid-cols-2 gap-3">
          <Campo id="frete-kml" label="Consumo" sufixo="km/L" value={kmL} onChange={setKmL} placeholder="10" />
          <Campo id="frete-preco" label="Preço do litro" sufixo="R$" value={preco} onChange={setPreco} placeholder="6,19" />
        </div>
        <Campo id="frete-extras" label="Pedágio / estacionamento por viagem (opcional)" sufixo="R$" value={extras} onChange={setExtras} placeholder="0" />
      </section>

      <section
        aria-live="polite"
        className="rounded-2xl p-4"
        style={{ background: 'var(--color-ink-fixed)', color: 'var(--color-white-fixed)' }}
      >
        {r ? (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[12px] uppercase tracking-wider" style={{ opacity: 0.75 }}>Custo do frete</div>
              <div className="font-extrabold" style={{ fontFamily: 'var(--font-display)', fontSize: 32 }}>{brl(r.custoTotal)}</div>
              {r.custoExtras > 0 && (
                <div className="text-sm" style={{ opacity: 0.85 }}>
                  {brl(r.custoCombustivel)} de combustível + {brl(r.custoExtras)} de pedágio/estacionamento
                </div>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt style={{ opacity: 0.75 }}>Km rodados</dt><dd className="text-right font-bold">{fmtNum(r.kmTotal)} km</dd>
              <dt style={{ opacity: 0.75 }}>Combustível</dt><dd className="text-right font-bold">{fmtNum(r.litros)} L</dd>
              <dt style={{ opacity: 0.75 }}>Custo por km</dt><dd className="text-right font-bold">{brl(r.custoPorKm)}</dd>
              <dt style={{ opacity: 0.75 }}>Por viagem</dt><dd className="text-right font-bold">{brl(r.custoPorViagem)}</dd>
            </dl>
            <button
              type="button"
              onClick={copiar}
              className="font-bold text-sm rounded-xl"
              style={{ minHeight: 44, background: 'var(--color-white-fixed)', color: 'var(--color-ink-fixed)' }}
            >
              Copiar pra colar no orçamento
            </button>
          </div>
        ) : (
          <p className="text-sm" style={{ opacity: 0.85 }}>
            Preencha a distância, o consumo (km/L) e o preço do litro pra ver o custo.
          </p>
        )}
      </section>
    </div>
  );
}
