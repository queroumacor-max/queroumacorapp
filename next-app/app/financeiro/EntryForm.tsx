// EntryForm — modal pra adicionar lançamento financeiro. Espelha o form
// do vanilla (#fin-form em modules/financeiro.js + html inline), mas como
// dialog React em vez de seção fixa no DOM.
//
// Decisões:
//   - tipo (receita/custo) é só açúcar de UI: o backend grava `jobs` com
//     `revenue` e `material_cost` independentes. Receita pura = revenue>0,
//     custo>0; Custo puro = revenue=0, material_cost>0; Misto = ambos>0.
//     Isso preserva o modelo do vanilla onde um único lançamento podia ser
//     ambos (projeto com material gasto E pagamento recebido);
//   - usa parseBRL pra aceitar "1.500,00", "1500.50", "500" — mesmo input
//     mascarado-light do vanilla;
//   - data é informativa (jobs.created_at é now() do banco; o `scheduled_date`
//     que o service grava é YYYY-MM-DD de hoje no fuso local). Mostramos o
//     campo de data como display-only ("hoje") pra não confundir o usuário;
//   - categoria é opcional e vira parte do `service_type` (ex.: "Material:
//     tinta acrílica") porque a tabela `jobs` não tem coluna `category`. Se
//     virar requisito, migration adiciona — por ora o vanilla também não tem.
//
// Fecha com ESC ou clique no backdrop. Form submit + Enter no input dispara
// salvar (form nativo, sem JS extra).

'use client';

import { useEffect, useRef, useState } from 'react';
import { parseBRL } from '@/lib/utils';
import { showToast } from '@/lib/toast';
import { canSeeProFeature } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import type { FinEntryInput } from '@/lib/services/financeiro';

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

export type EntryType = 'receita' | 'custo' | 'misto';

const TYPE_OPTIONS: Array<{ value: EntryType; label: string; hint: string }> = [
  { value: 'receita', label: 'Receita', hint: 'Entrada de dinheiro' },
  { value: 'custo', label: 'Custo', hint: 'Saída/gasto' },
  { value: 'misto', label: 'Misto', hint: 'Projeto com receita e custo' },
];

interface EntryFormProps {
  onClose: () => void;
  onSubmit: (input: FinEntryInput) => void;
  isSubmitting: boolean;
  error: Error | null;
}

export function EntryForm({
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: EntryFormProps) {
  const policyUser = usePolicyUser();
  const isPro = canSeeProFeature(policyUser);
  const [tipo, setTipo] = useState<EntryType>('receita');
  const [nome, setNome] = useState('');
  const [cliente, setCliente] = useState('');
  const [categoria, setCategoria] = useState('');
  const [recebido, setRecebido] = useState('');
  const [gasto, setGasto] = useState('');
  // Erros locais de validação (antes de submeter). Após submeter, `error`
  // (prop) carrega o erro de rede/servidor.
  const [localErr, setLocalErr] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<ReceiptResult | null>(null);

  // OCR de recibo: PRO escaneia foto → API gpt-4o-mini vision → preenche
  // nome/categoria/gasto baseado nos items. User confirma antes de salvar.
  async function handleReceiptUpload(file: File) {
    setLocalErr(null);
    setOcrLoading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/receipt-ocr', { method: 'POST', body: fd });
      const text = await res.text();
      let data: ReceiptResult & { error?: string };
      try { data = JSON.parse(text); }
      catch { throw new Error('Resposta inválida do servidor'); }
      if (!res.ok) throw new Error(data.error || 'Erro ao ler recibo');
      if (!data.items || data.items.length === 0) {
        throw new Error('Não consegui ler itens nessa foto. Tente outra.');
      }
      setOcrResult(data);
      // Auto-preenche os campos do form com o resultado.
      setTipo('custo');
      setCategoria('Material');
      setNome(
        data.merchant
          ? `Compra em ${data.merchant}`
          : 'Compra de material',
      );
      setGasto(String(data.total.toFixed(2)).replace('.', ','));
      showToast(`${data.items.length} item(ns) lido(s) do recibo`, 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao ler recibo', 'error');
    } finally {
      setOcrLoading(false);
    }
  }

  // Foca o primeiro campo ao montar — UX de modal: usuário não precisa
  // clicar pra começar a digitar. Cleanup do ESC no return do useEffect.
  useEffect(() => {
    firstFieldRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalErr(null);

    const nomeT = nome.trim();
    const clienteT = cliente.trim();
    if (!nomeT && !clienteT) {
      setLocalErr('Informe o nome do projeto ou cliente.');
      return;
    }

    // Mapeia o tipo de UI pros campos reais. Pra "receita", força gasto=0;
    // pra "custo", força receita=0; "misto" usa os dois inputs.
    let revenue = 0;
    let materialCost = 0;
    if (tipo === 'receita') {
      revenue = parseBRL(recebido);
    } else if (tipo === 'custo') {
      materialCost = parseBRL(gasto);
    } else {
      revenue = parseBRL(recebido);
      materialCost = parseBRL(gasto);
    }

    if (revenue <= 0 && materialCost <= 0) {
      setLocalErr('Informe um valor recebido ou gasto.');
      return;
    }

    // Categoria entra como prefixo no service_type pra não perder o dado
    // sem precisar de migration. Ex.: "Material: tinta acrílica 18L".
    const catT = categoria.trim();
    const serviceType = catT && nomeT ? `${catT}: ${nomeT}` : catT || nomeT;

    onSubmit({
      service_type: serviceType,
      client_name: clienteT,
      revenue,
      material_cost: materialCost,
    });
    // Fechamos otimisticamente. Se o create estourar erro, o caller (Dashboard)
    // mostra createError inline na tela — o modal já se foi. Tradeoff: UX
    // fluida (95% dos casos) vs ter que reabrir modal pra ver o erro.
    onClose();
  }

  // Mostra campo recebido pra receita e misto; gasto pra custo e misto.
  const showRecebido = tipo === 'receita' || tipo === 'misto';
  const showGasto = tipo === 'custo' || tipo === 'misto';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fin-form-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 id="fin-form-title" className="text-lg font-bold">
            Novo lançamento
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-2xl text-[color:var(--color-muted)] leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* OCR de recibo (PRO): foto vira lançamento automaticamente */}
          <div>
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleReceiptUpload(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (!isPro) {
                  showToast('OCR de recibo é PRO — assine pra liberar', 'info');
                  return;
                }
                receiptInputRef.current?.click();
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
                  marginTop: 8,
                  padding: 10,
                  background: '#f7f7f7',
                  borderRadius: 10,
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  📋 Itens lidos ({ocrResult.items.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {ocrResult.items.slice(0, 6).map((it, idx) => (
                    <li key={idx} style={{ marginBottom: 2 }}>
                      {it.description} · R$ {it.total.toFixed(2).replace('.', ',')}
                    </li>
                  ))}
                  {ocrResult.items.length > 6 ? (
                    <li style={{ opacity: 0.6 }}>
                      + {ocrResult.items.length - 6} mais
                    </li>
                  ) : null}
                </ul>
                <div style={{ marginTop: 6, fontWeight: 700, color: 'var(--color-p1)' }}>
                  Total: R$ {ocrResult.total.toFixed(2).replace('.', ',')}
                </div>
              </div>
            ) : null}
          </div>

          {/* Tipo (radio-like buttons) */}
          <div>
            <label className="block text-xs font-semibold text-[color:var(--color-muted)] mb-2 uppercase tracking-wider">
              Tipo
            </label>
            <div className="flex gap-2" role="radiogroup" aria-label="Tipo de lançamento">
              {TYPE_OPTIONS.map((opt) => {
                const active = opt.value === tipo;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTipo(opt.value)}
                    className={
                      'flex-1 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ' +
                      (active
                        ? 'bg-[color:var(--color-ink)] text-white'
                        : 'bg-white border border-[color:var(--color-border)] text-[color:var(--color-ink)]')
                    }
                    title={opt.hint}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label
              htmlFor="fin-nome"
              className="block text-xs font-semibold text-[color:var(--color-muted)] mb-1 uppercase tracking-wider"
            >
              Descrição
            </label>
            <input
              id="fin-nome"
              ref={firstFieldRef}
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Pintura cozinha"
              className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm"
              maxLength={120}
            />
          </div>

          {/* Cliente */}
          <div>
            <label
              htmlFor="fin-cliente"
              className="block text-xs font-semibold text-[color:var(--color-muted)] mb-1 uppercase tracking-wider"
            >
              Cliente (opcional)
            </label>
            <input
              id="fin-cliente"
              type="text"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Nome do cliente"
              className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm"
              maxLength={80}
            />
          </div>

          {/* Categoria */}
          <div>
            <label
              htmlFor="fin-cat"
              className="block text-xs font-semibold text-[color:var(--color-muted)] mb-1 uppercase tracking-wider"
            >
              Categoria (opcional)
            </label>
            <input
              id="fin-cat"
              type="text"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Ex: Material, Mão de obra, Outros"
              className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm"
              maxLength={40}
            />
          </div>

          {/* Valores */}
          <div className="grid grid-cols-2 gap-3">
            {showRecebido ? (
              <div className={showGasto ? '' : 'col-span-2'}>
                <label
                  htmlFor="fin-recebido"
                  className="block text-xs font-semibold text-[color:var(--color-muted)] mb-1 uppercase tracking-wider"
                >
                  Recebido (R$)
                </label>
                <input
                  id="fin-recebido"
                  type="text"
                  inputMode="decimal"
                  value={recebido}
                  onChange={(e) => setRecebido(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm"
                />
              </div>
            ) : null}
            {showGasto ? (
              <div className={showRecebido ? '' : 'col-span-2'}>
                <label
                  htmlFor="fin-gasto"
                  className="block text-xs font-semibold text-[color:var(--color-muted)] mb-1 uppercase tracking-wider"
                >
                  Gasto (R$)
                </label>
                <input
                  id="fin-gasto"
                  type="text"
                  inputMode="decimal"
                  value={gasto}
                  onChange={(e) => setGasto(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm"
                />
              </div>
            ) : null}
          </div>

          {/* Data — display-only, sempre "hoje" no fuso local. */}
          <div className="text-xs text-[color:var(--color-muted)]">
            Data:{' '}
            <span className="font-semibold">
              {new Intl.DateTimeFormat('pt-BR').format(new Date())}
            </span>
          </div>

          {localErr ? (
            <div
              role="alert"
              className="p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
            >
              {localErr}
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
            >
              {error.message || 'Erro ao salvar.'}
            </div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-[color:var(--color-border)] rounded-xl text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold disabled:opacity-60"
            >
              {isSubmitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
