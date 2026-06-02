// QuoteWizard — client component pra gerar orçamento guiado pela IA. Espelha
// a UX do `#ai-orc-modal` do vanilla (modules/ai-chat.js — sugerirEscopoIA +
// gerarOrcamentoIA), reduzido pra o caminho essencial:
//
//   1. User preenche: tipo de serviço, área (m²), descrição
//   2. Botão "Sugerir escopo" → preenche o textarea de escopo via /api/chat-ai
//   3. Botão "Sugerir preço" → puxa preço do /api/pricing-suggest
//   4. Card de resultado mostra escopo + preço final + justificativa
//
// Diferente do vanilla, NÃO geramos PDF / "salvar pipeline" aqui — esse
// fluxo vive em /orcamentos (PipelineKanban). Esta tela é só o "gerador IA".
// Quando o usuário aprova o resultado, copia o texto e cola no formulário
// canônico de orçamento.

'use client';

import { useState } from 'react';
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
  serviceType: string;
  areaM2: string; // string pq vem de <input>; parsed antes de mandar
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
];

export function QuoteWizard() {
  const { user, loading: authLoading } = useAuth();
  const policyUser = usePolicyUser();
  const [form, setForm] = useState<FormState>({
    serviceType: SERVICE_OPTIONS[0],
    areaM2: '',
    description: '',
    scope: '',
  });
  const [priceResult, setPriceResult] = useState<SuggestPriceResult | null>(null);

  const scopeMutation = useMutation<string, Error, string>({
    mutationFn: (desc: string) => suggestScope(desc),
    onSuccess: (scope) => setForm((f) => ({ ...f, scope })),
  });

  const priceMutation = useMutation<SuggestPriceResult, Error, void>({
    mutationFn: () =>
      suggestPrice({
        service_type: form.serviceType,
        description: form.description || form.scope,
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
        <div className="text-5xl mb-3" aria-hidden="true">
          📝
        </div>
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
        <div className="text-5xl mb-3" aria-hidden="true">
          📝
        </div>
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

  function handleSuggestScope() {
    const desc =
      `${form.serviceType}, aproximadamente ${form.areaM2 || '?'} m². ` +
      (form.description || 'sem observações adicionais');
    scopeMutation.mutate(desc);
  }

  return (
    <section className="bg-white rounded-2xl border border-[color:var(--color-border)] p-5 space-y-4">
      <div>
        <label
          htmlFor="qw-service"
          className="block text-xs font-bold text-[color:var(--color-muted)] uppercase mb-1"
        >
          Tipo de serviço
        </label>
        <select
          id="qw-service"
          value={form.serviceType}
          onChange={(e) => update('serviceType', e.target.value)}
          className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
        >
          {SERVICE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="qw-area"
          className="block text-xs font-bold text-[color:var(--color-muted)] uppercase mb-1"
        >
          Área aproximada (m²)
        </label>
        <input
          id="qw-area"
          type="number"
          min={0}
          step={1}
          value={form.areaM2}
          onChange={(e) => update('areaM2', e.target.value)}
          placeholder="ex: 80"
          className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
        />
      </div>

      <div>
        <label
          htmlFor="qw-desc"
          className="block text-xs font-bold text-[color:var(--color-muted)] uppercase mb-1"
        >
          Descrição (opcional)
        </label>
        <textarea
          id="qw-desc"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="ex: parede com mofo, 2 cômodos, urgência…"
          rows={2}
          className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label
            htmlFor="qw-scope"
            className="block text-xs font-bold text-[color:var(--color-muted)] uppercase"
          >
            Escopo do serviço
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
          id="qw-scope"
          value={form.scope}
          onChange={(e) => update('scope', e.target.value)}
          placeholder="Cole o escopo aqui ou clique em Sugerir escopo (IA)"
          rows={6}
          className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
        />
        {scopeMutation.error ? (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {scopeMutation.error.message}
          </p>
        ) : null}
      </div>

      <div className="pt-3 border-t border-[color:var(--color-border)]">
        <button
          type="button"
          onClick={() => priceMutation.mutate()}
          disabled={priceMutation.isPending}
          className="w-full px-4 py-3 bg-[color:var(--color-ink)] text-white rounded-xl font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {priceMutation.isPending ? 'Calculando…' : '💰 Sugerir preço (IA)'}
        </button>
        {priceMutation.error ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {priceMutation.error.message}
          </p>
        ) : null}
      </div>

      {priceResult ? (
        <article className="bg-[color:var(--color-bg)] rounded-xl p-4 border border-[color:var(--color-border)]">
          <h3 className="text-xs font-bold text-[color:var(--color-muted)] uppercase mb-2">
            Sugestão do Seu Zé
          </h3>
          <p
            className="text-2xl font-extrabold text-[color:var(--color-p1)] mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            R$ {priceResult.price.toLocaleString('pt-BR')}
          </p>
          {priceResult.justification ? (
            <p className="text-xs text-[color:var(--color-muted)]">
              {priceResult.justification}
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
