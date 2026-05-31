// ReportModal — modal "Denunciar post" com radio buttons pro motivo + textarea
// opcional ("Mais detalhes"). Guard de double-submit via isReporting do hook.
// O motivo enviado pro banco é "<reason>: <detalhes>" se houver detalhes,
// ou apenas "<reason>" — mantém uma coluna text simples (igual ao vanilla).
//
// Acessibilidade: role="dialog" + aria-labelledby; fechar via botão "Cancelar"
// ou via Esc (parent controla isOpen). Foco volta pro caller automaticamente
// se ele lembrar do trigger — não fazemos focus trap interno pra manter o
// componente leve (caller que precisar pode embrulhar num <Dialog> headless).

'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useReportPost } from '@/lib/hooks/usePostInteractions';
import type { ReportReason } from '@/lib/services/postInteractions';

export interface ReportModalProps {
  isOpen: boolean;
  postId: string;
  targetUserId?: string | null;
  onClose: () => void;
  /** Callback opcional pra toast/feedback de sucesso. */
  onReported?: () => void;
  /** Callback opcional pra toast de erro. Default: silencioso. */
  onError?: (msg: string) => void;
}

// Opções fixas — mesmas categorias usadas pelo vanilla. Adicionar/remover
// aqui é seguro: a coluna `reason` no banco é text livre.
const REASONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: 'Spam ou propaganda' },
  { value: 'ofensivo', label: 'Conteúdo ofensivo' },
  { value: 'violencia', label: 'Violência ou perigo' },
  { value: 'desinformacao', label: 'Informação falsa' },
  { value: 'outros', label: 'Outro motivo' },
];

export function ReportModal({
  isOpen,
  postId,
  targetUserId,
  onClose,
  onReported,
  onError,
}: ReportModalProps) {
  const [reason, setReason] = useState<ReportReason>(REASONS[0].value);
  const [details, setDetails] = useState('');
  const { report, isReporting } = useReportPost();

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (isReporting) return;
      const trimmed = details.trim();
      const fullReason = trimmed ? `${reason}: ${trimmed}` : reason;
      try {
        await report(postId, fullReason, targetUserId ?? null);
        // Reset interno e fecha. O caller chama onReported pra mostrar toast.
        setDetails('');
        setReason(REASONS[0].value);
        onReported?.();
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao enviar denúncia';
        onError?.(msg);
      }
    },
    [postId, reason, details, targetUserId, isReporting, report, onReported, onError, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      // Backdrop. onClick no backdrop fecha; click no card propaga stopPropagation.
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl"
      >
        <h2
          id="report-modal-title"
          className="text-lg font-bold text-[color:var(--color-ink,#222)] mb-3"
        >
          Denunciar post
        </h2>
        <form onSubmit={submit}>
          <fieldset className="mb-4" disabled={isReporting}>
            <legend className="text-sm font-semibold mb-2 text-[color:var(--color-ink,#222)]">
              Motivo
            </legend>
            <div className="space-y-1.5">
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block mb-4">
            <span className="block text-sm font-semibold mb-1 text-[color:var(--color-ink,#222)]">
              Detalhes (opcional)
            </span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              disabled={isReporting}
              rows={3}
              maxLength={500}
              placeholder="Conte mais sobre o problema…"
              className="w-full border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none resize-none disabled:opacity-60"
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isReporting}
              className="px-4 py-2 text-sm font-medium text-[color:var(--color-ink,#222)] disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isReporting}
              className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isReporting ? 'Enviando…' : 'Enviar denúncia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
