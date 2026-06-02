'use client';
// LaunchCostSheet — modal pra lançar custo dentro de um projeto/lançamento
// existente. Reutiliza /api/receipt-ocr (PRO) + entrada manual.
//
// O backend incrementa material_cost via incrementCost() em financeiro.ts;
// não cria job novo, só soma ao projeto que veio do orçamento (ou criado à mão).

import { useRef, useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { canSeeProFeature } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { showToast } from '@/lib/toast';
import { parseBRL } from '@/lib/utils';
import type { Job } from '@/lib/types';

interface ReceiptItem {
  description: string;
  qty: number;
  unit_price: number;
  total: number;
}
interface ReceiptResult {
  merchant: string;
  date: string;
  items: ReceiptItem[];
  total: number;
  notes: string;
}

export interface LaunchCostSheetProps {
  open: boolean;
  entry: Job | null;
  onClose: () => void;
  onConfirm: (delta: number) => void;
  isSubmitting: boolean;
}

export function LaunchCostSheet({
  open,
  entry,
  onClose,
  onConfirm,
  isSubmitting,
}: LaunchCostSheetProps) {
  const policyUser = usePolicyUser();
  const isPro = canSeeProFeature(policyUser);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<ReceiptResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!open || !entry) return null;

  async function handleReceipt(file: File) {
    setOcrLoading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/receipt-ocr', { method: 'POST', body: fd });
      const text = await res.text();
      let data: ReceiptResult & { error?: string };
      try { data = JSON.parse(text); }
      catch { throw new Error('Resposta inválida'); }
      if (!res.ok) throw new Error(data.error || 'Erro');
      if (!data.items || data.items.length === 0) {
        throw new Error('Não consegui ler itens dessa foto');
      }
      setOcrResult(data);
      setValue(String(data.total.toFixed(2)).replace('.', ','));
      setNote(
        data.merchant
          ? `Compra em ${data.merchant}`
          : `${data.items.length} item(ns) do recibo`,
      );
      showToast(`${data.items.length} item(ns) lido(s)`, 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao ler recibo', 'error');
    } finally {
      setOcrLoading(false);
    }
  }

  function handleConfirm() {
    const delta = parseBRL(value);
    if (!Number.isFinite(delta) || delta <= 0) {
      showToast('Informe um valor válido', 'error');
      return;
    }
    onConfirm(delta);
    // Reset local
    setValue('');
    setNote('');
    setOcrResult(null);
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Lançar custo no projeto">
      <h3
        className="font-extrabold text-center"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          marginBottom: 6,
          color: 'var(--color-ink)',
        }}
      >
        Lançar custo
      </h3>
      <p
        className="text-center"
        style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 14 }}
      >
        Projeto: <strong>{entry.service_type || 'Projeto'}</strong>
        {entry.client_name ? ` · ${entry.client_name}` : ''}
      </p>

      {/* OCR de recibo */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleReceipt(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => {
          if (!isPro) {
            showToast('OCR de recibo é PRO', 'info');
            return;
          }
          fileRef.current?.click();
        }}
        disabled={ocrLoading}
        className="w-full font-bold flex items-center justify-center gap-2"
        style={{
          padding: 11,
          borderRadius: 10,
          fontSize: 13,
          border: '1.5px dashed var(--color-p1)',
          background: 'linear-gradient(135deg, rgba(255,107,53,.06), rgba(131,56,236,.06))',
          color: 'var(--color-ink)',
          cursor: ocrLoading ? 'wait' : 'pointer',
          marginBottom: 12,
        }}
      >
        {ocrLoading ? '🔍 Lendo recibo…' : '📷 Foto do recibo (IA preenche)'}
        {!isPro ? (
          <span
            className="text-white font-extrabold"
            style={{
              background: 'linear-gradient(135deg, var(--color-p5), var(--color-p1))',
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

      {ocrResult && ocrResult.items.length > 0 ? (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            background: '#f7f7f7',
            borderRadius: 10,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            📋 Itens lidos
          </div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {ocrResult.items.slice(0, 6).map((it, idx) => (
              <li key={idx}>
                {it.description} · R$ {it.total.toFixed(2).replace('.', ',')}
              </li>
            ))}
            {ocrResult.items.length > 6 ? <li>+ {ocrResult.items.length - 6} mais</li> : null}
          </ul>
        </div>
      ) : null}

      {/* Valor manual / editar valor do OCR */}
      <div style={{ marginBottom: 10 }}>
        <label
          htmlFor="cost-value"
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-muted)',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Valor do custo (R$)
        </label>
        <input
          id="cost-value"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0,00"
          className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm bg-white"
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label
          htmlFor="cost-note"
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-muted)',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Descrição (opcional)
        </label>
        <input
          id="cost-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex: tinta acrílica 18L"
          className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm bg-white"
        />
      </div>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={isSubmitting || !value.trim()}
        className="w-full text-white font-bold"
        style={{
          padding: 13,
          background: 'var(--color-ink)',
          borderRadius: 12,
          fontSize: 14,
          border: 'none',
          cursor: isSubmitting || !value.trim() ? 'not-allowed' : 'pointer',
          opacity: isSubmitting || !value.trim() ? 0.5 : 1,
        }}
      >
        {isSubmitting ? 'Lançando…' : 'Lançar custo no projeto'}
      </button>
    </BottomSheet>
  );
}
