// QuoteWizard — gerador de orçamento guiado pela IA com TODOS os campos
// que um pintor precisa pra um projeto completo. Sections agrupadas pra
// UX não ficar overwhelming:
//
//  1. **Espaço** — tipo, área, pé direito, cômodos, estado da superfície,
//     acesso (escada/andaime)
//  2. **Material e técnica** — tipo de tinta, cor desejada, demãos,
//     preparação (massa/lixa/selador/primer), EPI
//  3. **Logística** — cidade/endereço, prazo em dias, incluir material?,
//     incluir mão de obra?, garantia (% retoques)
//  4. **IA** — Sugerir escopo (escreve técnico) + Sugerir preço (R$)
//
// Tudo isso vira o `description` enviado pro /api/chat-ai (Seu Zé escopo) e
// /api/pricing-suggest. Quanto mais campos preenchidos, melhor a sugestão.

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { canSeeProFeature } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import {
  suggestScope,
  suggestPrice,
  type SuggestPriceResult,
} from '@/lib/services/aiChat';

interface FormState {
  // Espaço
  serviceType: string;
  areaM2: string;
  ceilingHeight: string; // pé direito em metros
  rooms: string; // nº de cômodos
  surfaceState: string; // boa, com mofo, descascando, nova
  access: string; // térreo, escada, andaime
  // Material e técnica
  paintType: string; // acrílica, esmalte, PVA, epóxi, textura
  colorWant: string; // cor/paleta desejada
  coats: string; // 1/2/3 demãos
  prep: string[]; // multiselect: massa, lixa, selador, primer
  // Logística
  city: string;
  durationDays: string;
  includeMaterial: boolean;
  includeLabor: boolean;
  warranty: string; // ex.: 90 dias retoques
  // IA
  description: string;
  scope: string;
}

const SERVICE_OPTIONS = [
  'Pintura interna',
  'Pintura externa / fachada',
  'Textura (grafiato/marmorato)',
  'Piso epóxi',
  'Microcimento',
  'Esmalte (portas/grades)',
  'Pintura automotiva',
  'Grafite / mural',
];

const SURFACE_STATES = [
  'Nova (alvenaria recém-feita)',
  'Boa (só limpeza)',
  'Pintura antiga em bom estado',
  'Descascando / mofo / infiltração',
  'Concreto ou tijolo aparente',
];

const ACCESS_OPTIONS = [
  'Térreo / sem altura',
  'Escada (até 3m)',
  'Andaime (3-6m)',
  'Andaime alto / cadeira suspensa (acima 6m)',
];

const PAINT_TYPES = [
  'Acrílica (interna/externa)',
  'PVA (interna)',
  'Esmalte sintético (madeira/metal)',
  'Esmalte aquoso',
  'Epóxi (piso/banheiro)',
  'Elastomérica (fachada)',
  'Textura/grafiato',
  'Outra',
];

const PREP_OPTIONS = [
  'Massa corrida',
  'Lixamento',
  'Selador',
  'Fundo preparador',
  'Fungicida (mofo)',
  'Tratamento de trincas',
];

export function QuoteWizard() {
  const { user, loading: authLoading } = useAuth();
  const policyUser = usePolicyUser();
  const [form, setForm] = useState<FormState>({
    serviceType: SERVICE_OPTIONS[0],
    areaM2: '',
    ceilingHeight: '2.8',
    rooms: '',
    surfaceState: SURFACE_STATES[1],
    access: ACCESS_OPTIONS[0],
    paintType: PAINT_TYPES[0],
    colorWant: '',
    coats: '2',
    prep: ['Massa corrida', 'Lixamento'],
    city: '',
    durationDays: '',
    includeMaterial: true,
    includeLabor: true,
    warranty: '90 dias para retoques',
    description: '',
    scope: '',
  });
  const [priceResult, setPriceResult] = useState<SuggestPriceResult | null>(null);

  // Monta a descrição rica que vai pra IA — concatena todos os campos
  // preenchidos. Quanto mais info, mais preciso o escopo/preço.
  const richDescription = useMemo(() => {
    const lines = [
      `Serviço: ${form.serviceType}`,
      form.areaM2 && `Área: ${form.areaM2} m²`,
      form.ceilingHeight && `Pé direito: ${form.ceilingHeight} m`,
      form.rooms && `Cômodos: ${form.rooms}`,
      `Superfície: ${form.surfaceState}`,
      `Acesso: ${form.access}`,
      `Tipo de tinta: ${form.paintType}`,
      form.colorWant && `Cor desejada: ${form.colorWant}`,
      `Demãos: ${form.coats}`,
      form.prep.length > 0 && `Preparação: ${form.prep.join(', ')}`,
      form.city && `Cidade: ${form.city}`,
      form.durationDays && `Prazo: ${form.durationDays} dias`,
      `Inclui material: ${form.includeMaterial ? 'sim' : 'não (só mão de obra)'}`,
      `Inclui mão de obra: ${form.includeLabor ? 'sim' : 'não (só material)'}`,
      form.warranty && `Garantia: ${form.warranty}`,
      form.description && `Observações: ${form.description}`,
    ].filter(Boolean);
    return lines.join('\n');
  }, [form]);

  const scopeMutation = useMutation<string, Error, string>({
    mutationFn: (desc: string) => suggestScope(desc),
    onSuccess: (scope) => setForm((f) => ({ ...f, scope })),
  });

  const priceMutation = useMutation<SuggestPriceResult, Error, void>({
    mutationFn: () =>
      suggestPrice({
        service_type: form.serviceType,
        description: richDescription,
        area_m2: parseFloat(form.areaM2) || undefined,
      }),
    onSuccess: (res) => setPriceResult(res),
  });

  if (authLoading) {
    return (
      <div
        className="bg-white rounded-2xl border border-[color:var(--color-border)] p-8 animate-pulse h-96"
        aria-hidden="true"
      />
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">📝</div>
        <h2 className="font-semibold mb-2">Entre pra usar o orçamento IA</h2>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  if (!canSeeProFeature(policyUser)) {
    return (
      <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">📝</div>
        <h2 className="font-bold mb-2 text-[color:var(--color-ink)]">
          Orçamento IA é PRO
        </h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4 max-w-md mx-auto">
          Gere escopo e preço guiado pelo Seu Zé.
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

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function togglePrep(item: string) {
    setForm((f) => ({
      ...f,
      prep: f.prep.includes(item)
        ? f.prep.filter((p) => p !== item)
        : [...f.prep, item],
    }));
  }

  function handleSuggestScope() {
    scopeMutation.mutate(richDescription);
  }

  return (
    <section className="space-y-4">
      {/* ── 1. ESPAÇO ── */}
      <Card title="🏠 Espaço">
        <Row label="Tipo de serviço">
          <select
            value={form.serviceType}
            onChange={(e) => update('serviceType', e.target.value)}
            className={inputCls}
          >
            {SERVICE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Row>

        <Row label="Área aproximada (m²)">
          <input
            type="number"
            min={0}
            value={form.areaM2}
            onChange={(e) => update('areaM2', e.target.value)}
            placeholder="ex: 80"
            className={inputCls}
          />
        </Row>

        <Row label="Pé direito (m)">
          <input
            type="number"
            step="0.1"
            min={0}
            value={form.ceilingHeight}
            onChange={(e) => update('ceilingHeight', e.target.value)}
            placeholder="ex: 2.8"
            className={inputCls}
          />
        </Row>

        <Row label="Cômodos / divisões">
          <input
            type="number"
            min={0}
            value={form.rooms}
            onChange={(e) => update('rooms', e.target.value)}
            placeholder="ex: 3"
            className={inputCls}
          />
        </Row>

        <Row label="Estado da superfície">
          <select
            value={form.surfaceState}
            onChange={(e) => update('surfaceState', e.target.value)}
            className={inputCls}
          >
            {SURFACE_STATES.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Row>

        <Row label="Acesso">
          <select
            value={form.access}
            onChange={(e) => update('access', e.target.value)}
            className={inputCls}
          >
            {ACCESS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Row>
      </Card>

      {/* ── 2. MATERIAL E TÉCNICA ── */}
      <Card title="🪣 Material e técnica">
        <Row label="Tipo de tinta">
          <select
            value={form.paintType}
            onChange={(e) => update('paintType', e.target.value)}
            className={inputCls}
          >
            {PAINT_TYPES.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Row>

        <Row label="Cor desejada">
          <input
            type="text"
            value={form.colorWant}
            onChange={(e) => update('colorWant', e.target.value)}
            placeholder="ex: branco gelo, areia, ref. Suvinil A123"
            className={inputCls}
          />
        </Row>

        <Row label="Nº de demãos">
          <div className="flex gap-2">
            {(['1', '2', '3'] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => update('coats', n)}
                className="flex-1 font-bold"
                style={{
                  padding: '8px 0',
                  borderRadius: 10,
                  fontSize: 13,
                  border: '1.5px solid ' + (form.coats === n
                    ? 'var(--color-p1)'
                    : 'var(--color-border)'),
                  background: form.coats === n
                    ? 'var(--color-p1)'
                    : '#fff',
                  color: form.coats === n ? '#fff' : 'var(--color-ink)',
                  cursor: 'pointer',
                }}
              >
                {n} demão{n !== '1' ? 's' : ''}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Preparação (marque o que precisa)">
          <div className="flex flex-wrap gap-2">
            {PREP_OPTIONS.map((opt) => {
              const on = form.prep.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => togglePrep(opt)}
                  className="font-semibold text-xs"
                  style={{
                    padding: '6px 11px',
                    borderRadius: 999,
                    border: '1.5px solid ' + (on
                      ? 'var(--color-p1)'
                      : 'var(--color-border)'),
                    background: on ? 'rgba(255,107,53,.12)' : '#fff',
                    color: on ? 'var(--color-p1)' : 'var(--color-ink)',
                    cursor: 'pointer',
                  }}
                >
                  {on ? '✓ ' : ''}{opt}
                </button>
              );
            })}
          </div>
        </Row>
      </Card>

      {/* ── 3. LOGÍSTICA ── */}
      <Card title="📋 Logística e comercial">
        <Row label="Cidade do serviço">
          <input
            type="text"
            value={form.city}
            onChange={(e) => update('city', e.target.value)}
            placeholder="ex: São Paulo, SP"
            className={inputCls}
          />
        </Row>

        <Row label="Prazo estimado (dias úteis)">
          <input
            type="number"
            min={0}
            value={form.durationDays}
            onChange={(e) => update('durationDays', e.target.value)}
            placeholder="ex: 5"
            className={inputCls}
          />
        </Row>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-[color:var(--color-ink)] cursor-pointer">
            <input
              type="checkbox"
              checked={form.includeLabor}
              onChange={(e) => update('includeLabor', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--color-p1)' }}
            />
            Inclui mão de obra
          </label>
          <label className="flex items-center gap-2 text-sm text-[color:var(--color-ink)] cursor-pointer">
            <input
              type="checkbox"
              checked={form.includeMaterial}
              onChange={(e) => update('includeMaterial', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--color-p1)' }}
            />
            Inclui material (tinta + insumos)
          </label>
        </div>

        <Row label="Garantia">
          <input
            type="text"
            value={form.warranty}
            onChange={(e) => update('warranty', e.target.value)}
            placeholder="ex: 90 dias para retoques"
            className={inputCls}
          />
        </Row>
      </Card>

      {/* ── 4. DESCRIÇÃO E ESCOPO ── */}
      <Card title="✍️ Observações livres">
        <Row label="Descrição (opcional)">
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="ex: parede com mofo no quarto principal, urgência pra entregar dia 15"
            rows={3}
            className={inputCls}
          />
        </Row>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-[color:var(--color-muted)] uppercase">
              Escopo técnico do serviço
            </label>
            <button
              type="button"
              onClick={handleSuggestScope}
              disabled={scopeMutation.isPending}
              className="text-xs font-bold text-[color:var(--color-p1)] hover:opacity-80 disabled:opacity-50"
            >
              {scopeMutation.isPending ? '✨ Gerando…' : '✨ Sugerir escopo (IA)'}
            </button>
          </div>
          <textarea
            value={form.scope}
            onChange={(e) => update('scope', e.target.value)}
            placeholder="Cole o escopo aqui ou clique em 'Sugerir escopo (IA)' — o Seu Zé monta a partir dos campos acima"
            rows={7}
            className={inputCls}
          />
          {scopeMutation.error ? (
            <p role="alert" className="mt-1 text-xs text-red-700">
              {scopeMutation.error.message}
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── 5. AÇÃO: SUGERIR PREÇO ── */}
      <div>
        <button
          type="button"
          onClick={() => priceMutation.mutate()}
          disabled={priceMutation.isPending}
          className="w-full text-white font-bold"
          style={{
            padding: 14,
            background: 'var(--color-ink)',
            borderRadius: 14,
            fontSize: 15,
            border: 'none',
            cursor: priceMutation.isPending ? 'wait' : 'pointer',
            opacity: priceMutation.isPending ? 0.7 : 1,
          }}
        >
          {priceMutation.isPending ? 'Calculando…' : '💰 Sugerir preço (IA)'}
        </button>
        {priceMutation.error ? (
          <p role="alert" className="mt-2 text-xs text-red-700 text-center">
            {priceMutation.error.message}
          </p>
        ) : null}
      </div>

      {priceResult ? (
        <article
          className="rounded-2xl p-5"
          style={{
            background: 'linear-gradient(135deg, rgba(255,107,53,.08), rgba(131,56,236,.08))',
            border: '1.5px solid var(--color-border)',
          }}
        >
          <h3 className="text-xs font-bold text-[color:var(--color-muted)] uppercase mb-2">
            Sugestão do Seu Zé
          </h3>
          <p
            className="text-3xl font-extrabold text-[color:var(--color-p1)] mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            R$ {priceResult.price.toLocaleString('pt-BR')}
          </p>
          {priceResult.justification ? (
            <p className="text-xs text-[color:var(--color-muted)]" style={{ lineHeight: 1.6 }}>
              {priceResult.justification}
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

// ─── Atoms locais — Card / Row pra deixar o JSX legível ────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="bg-white space-y-3"
      style={{
        borderRadius: 16,
        padding: 16,
        border: '1px solid var(--color-border)',
      }}
    >
      <h3
        className="font-extrabold"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 14,
          color: 'var(--color-ink)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-[color:var(--color-muted)] uppercase mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)] bg-white';
