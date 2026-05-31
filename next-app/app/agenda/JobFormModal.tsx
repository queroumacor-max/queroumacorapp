// JobFormModal — modal de criar projeto (job).
// Espelha o form #modal-novo-projeto do vanilla (campos client_name,
// service_type, scheduled_date, scheduled_time, address, revenue,
// material_cost, notes), mas como Dialog React controlado por props.
//
// State LOCAL (useState) — o spec foi explícito sobre não usar Context.
// O pai (AgendaCalendar) controla apenas open/close e recebe o input via
// callback `onSubmit`. Loading/error vêm de props (vinculados à mutation
// do useAgenda) pra o modal não precisar saber sobre supabase/TanStack.
//
// Acessibilidade básica:
//   - role="dialog" + aria-modal="true"
//   - foca o primeiro input quando abre
//   - Esc fecha (via keydown na backdrop)
//   - Submit via Enter no form
//
// Edit-mode fica pra um PR futuro (vanilla também só tem create + update
// status no momento). Quando vier, o pai passa `initial` e o modal entra em
// modo edit; submit dispara um `update` em vez de `create`.

'use client';

import { useEffect, useRef, useState } from 'react';
import type { JobInput } from '@/lib/types';
import { parseBRL } from '@/lib/utils';

export interface JobFormModalProps {
  open: boolean;
  defaultDate?: string; // yyyy-mm-dd — prefill do campo data
  onClose: () => void;
  onSubmit: (input: JobInput) => void;
  isSubmitting: boolean;
  submitError: Error | null;
}

// Forma do state interno do form — mantém tudo como string pra match com
// <input>; parsing pra number (parseBRL) acontece só no submit.
interface FormState {
  client_name: string;
  service_type: string;
  scheduled_date: string;
  scheduled_time: string;
  address: string;
  revenue: string;
  material_cost: string;
  notes: string;
}

function emptyState(defaultDate?: string): FormState {
  return {
    client_name: '',
    service_type: '',
    scheduled_date: defaultDate || '',
    scheduled_time: '',
    address: '',
    revenue: '',
    material_cost: '',
    notes: '',
  };
}

export function JobFormModal({
  open,
  defaultDate,
  onClose,
  onSubmit,
  isSubmitting,
  submitError,
}: JobFormModalProps) {
  const [form, setForm] = useState<FormState>(() => emptyState(defaultDate));
  const [localError, setLocalError] = useState<string | null>(null);
  // Guarda o estado anterior de isSubmitting pra detectar "estava submetendo,
  // agora não está mais E sem erro" = sucesso → fecha + reseta.
  const wasSubmittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset do form quando o modal abre (com defaultDate fresca). Garante que
  // reabrir limpa o conteúdo anterior. Roda só na transição closed→open.
  useEffect(() => {
    if (open) {
      setForm(emptyState(defaultDate));
      setLocalError(null);
      // Foca o primeiro input após o paint (microtask via requestAnimationFrame
      // evita timing race com a transition de open).
      requestAnimationFrame(() => firstInputRef.current?.focus());
    }
  }, [open, defaultDate]);

  // Detecta sucesso: transição isSubmitting true→false sem submitError.
  useEffect(() => {
    if (wasSubmittingRef.current && !isSubmitting && !submitError) {
      onClose();
    }
    wasSubmittingRef.current = isSubmitting;
  }, [isSubmitting, submitError, onClose]);

  // Esc fecha o modal. Só quando aberto pra não interferir com outras telas.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, isSubmitting, onClose]);

  if (!open) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const clientName = form.client_name.trim();
    if (!clientName) {
      setLocalError('Informe o cliente');
      firstInputRef.current?.focus();
      return;
    }
    const input: JobInput = {
      client_name: clientName,
      service_type: form.service_type.trim() || null,
      scheduled_date: form.scheduled_date || null,
      scheduled_time: form.scheduled_time || null,
      address: form.address.trim() || null,
      revenue: parseBRL(form.revenue),
      material_cost: parseBRL(form.material_cost),
      notes: form.notes.trim() || null,
    };
    onSubmit(input);
  }

  // Click no backdrop (não no card) fecha. Usar onMouseDown evita problemas
  // de drag-select fechando sem intenção.
  function handleBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !isSubmitting) {
      onClose();
    }
  }

  const errorMsg = localError || submitError?.message || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-form-title"
      onMouseDown={handleBackdropMouseDown}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2
              id="job-form-title"
              className="text-lg font-bold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Novo projeto
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Fechar"
              className="text-xl leading-none px-2 text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] disabled:opacity-50"
            >
              ×
            </button>
          </div>

          <div className="space-y-3">
            <Field label="Cliente *">
              <input
                ref={firstInputRef}
                type="text"
                required
                value={form.client_name}
                onChange={(e) => update('client_name', e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-p1)] disabled:opacity-60"
              />
            </Field>

            <Field label="Tipo de serviço">
              <input
                type="text"
                value={form.service_type}
                onChange={(e) => update('service_type', e.target.value)}
                disabled={isSubmitting}
                placeholder="Ex.: Pintura externa"
                className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-p1)] disabled:opacity-60"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Data">
                <input
                  type="date"
                  value={form.scheduled_date}
                  onChange={(e) => update('scheduled_date', e.target.value)}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-p1)] disabled:opacity-60"
                />
              </Field>
              <Field label="Hora">
                <input
                  type="time"
                  value={form.scheduled_time}
                  onChange={(e) => update('scheduled_time', e.target.value)}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-p1)] disabled:opacity-60"
                />
              </Field>
            </div>

            <Field label="Endereço">
              <input
                type="text"
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                disabled={isSubmitting}
                placeholder="Rua, número, bairro"
                className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-p1)] disabled:opacity-60"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Receita (R$)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.revenue}
                  onChange={(e) => update('revenue', e.target.value)}
                  disabled={isSubmitting}
                  placeholder="0,00"
                  className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-p1)] disabled:opacity-60"
                />
              </Field>
              <Field label="Custo material (R$)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.material_cost}
                  onChange={(e) => update('material_cost', e.target.value)}
                  disabled={isSubmitting}
                  placeholder="0,00"
                  className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-p1)] disabled:opacity-60"
                />
              </Field>
            </div>

            <Field label="Descrição / notas">
              <textarea
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                disabled={isSubmitting}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:border-[color:var(--color-p1)] disabled:opacity-60"
              />
            </Field>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"
            >
              {errorMsg}
            </div>
          ) : null}

          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-[color:var(--color-bg)] border border-[color:var(--color-border)] text-sm font-semibold text-[color:var(--color-ink)] disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-[color:var(--color-p1)] text-white text-sm font-semibold disabled:opacity-60"
            >
              {isSubmitting ? 'Salvando...' : 'Salvar projeto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Wrapper de label + control pra evitar repetir markup em todos os campos.
// Mantém os classNames consistentes (text size, espaço label↔input).
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[color:var(--color-muted)] mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
