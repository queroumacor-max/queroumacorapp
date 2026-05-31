// CrmCard — card individual de um cliente elegível pro follow-up.
// Componente puro: recebe `client`, `intervalMonths` e os 3 handlers
// (onDraft, onSend, buildWaUrl) como props. Não faz fetch/mutation próprios
// — quem orquestra é o CrmList via useCrm.
//
// Fluxo de UI:
//   1. Pintor vê o card com dados do cliente + textarea vazia.
//   2. Clica "Gerar com IA" → loading button → mensagem aparece na textarea
//      (handler `onDraft` chama hook → service → /api/crm-draft).
//   3. Pintor revisa/edita a mensagem.
//   4. Clica "Enviar no WhatsApp" → abre `wa.me` em nova aba +
//      `onSend(message)` registra o log via saveFollowUp.
//
// Estados de send button:
//   - canSend false (sem telefone/opt-in/cliente do app) → disabled + razão visível
//   - canSend true → botão verde "Enviar pelo WhatsApp"
//
// Inspirado em renderCrmCard do vanilla (modules/crm.js linha 165+), mas
// com 2 diferenças:
//   - Cliente do app: o vanilla envia via notify() in-app. Aqui só
//     habilitamos WhatsApp quando há telefone+opt-in. Notificação in-app
//     fica pra quando esse fluxo for portado (notifs.js já está em React).
//   - Removemos os emojis decorativos exuberantes — visual mais limpo,
//     mantém o sinal sem o ruído.

'use client';

import { useState } from 'react';
import type { CrmClient } from '@/lib/services/crm';

// Formatter BRL singleton — recriar em cada render é caro.
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatTotal(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  return BRL.format(v);
}

function formatAgo(monthsSince: number | null): string {
  if (monthsSince === null) return 'sem serviço registrado';
  if (monthsSince === 0) return 'último serviço neste mês';
  return `último serviço há ${monthsSince} ${monthsSince === 1 ? 'mês' : 'meses'}`;
}

export interface CrmCardProps {
  client: CrmClient;
  isGeneratingGlobal: boolean;
  isLoggingGlobal: boolean;
  // Devolve o draft (Promise) — o card preenche o textarea.
  onDraft: (args: {
    clientName: string;
    monthsAgo: number;
    jobType: string;
  }) => Promise<{ draft: string }>;
  // Loga o follow-up enviado.
  onSend: (input: { message: string; channel: 'whatsapp' }) => Promise<void>;
  // Constrói URL `wa.me` (null quando telefone inválido).
  buildWaUrl: (phone: string | null | undefined, message: string) => string | null;
}

export function CrmCard({
  client,
  isGeneratingGlobal,
  isLoggingGlobal,
  onDraft,
  onSend,
  buildWaUrl,
}: CrmCardProps) {
  // Mensagem editável local — começa vazia. IA preenche, pintor pode
  // sobrescrever antes de enviar.
  const [message, setMessage] = useState('');
  // Estados granulares por card (apenas pra UI loading do botão específico
  // que foi clicado). `isGeneratingGlobal` cobre concorrência entre cards
  // (não dá pra rascunhar 2 ao mesmo tempo na mesma mutation).
  const [localDrafting, setLocalDrafting] = useState(false);
  const [localSending, setLocalSending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const phoneDigits = String(client.client_phone || '').replace(/\D/g, '');
  const hasPhone = phoneDigits.length >= 10;
  const canSend = hasPhone && client.followup_optin;
  const reason = !hasPhone ? 'sem telefone' : 'cliente sem opt-in';

  const handleDraft = async (): Promise<void> => {
    if (localDrafting || isGeneratingGlobal) return;
    setLocalError(null);
    setLocalDrafting(true);
    try {
      const out = await onDraft({
        clientName: client.client_name,
        monthsAgo: client.months_since ?? 0,
        jobType: client.last_service_desc || '',
      });
      setMessage(out.draft);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Erro ao gerar mensagem');
    } finally {
      setLocalDrafting(false);
    }
  };

  // Open WhatsApp + log async (não bloqueia o user). Se o log falhar,
  // mostramos erro mas mantemos o link aberto — pior cenário é histórico
  // incompleto, melhor que perder o disparo.
  const handleSend = async (): Promise<void> => {
    if (!canSend || localSending) return;
    const msg = message.trim();
    if (!msg) {
      setLocalError('Escreva ou gere a mensagem primeiro');
      return;
    }
    const url = buildWaUrl(client.client_phone, msg);
    if (!url) {
      setLocalError('Telefone inválido para WhatsApp');
      return;
    }
    setLocalError(null);
    setLocalSending(true);
    // Abre a aba ANTES do await pra não ser bloqueado pelo popup blocker
    // (browsers exigem que window.open esteja na call stack do user gesture).
    window.open(url, '_blank', 'noopener,noreferrer');
    try {
      await onSend({ message: msg, channel: 'whatsapp' });
    } catch (e) {
      setLocalError(
        e instanceof Error
          ? `Mensagem aberta no WhatsApp, mas não foi possível registrar: ${e.message}`
          : 'Não foi possível registrar o envio'
      );
    } finally {
      setLocalSending(false);
    }
  };

  // Badge de canal — mesmo vocabulário do vanilla mas sem o branch "cliente
  // do app" porque esse path ainda não está suportado neste port.
  const badge = canSend ? (
    <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
      WhatsApp
    </span>
  ) : (
    <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[color:var(--color-bg)] text-[color:var(--color-muted)] border border-[color:var(--color-border)]">
      Sem contato
    </span>
  );

  return (
    <article className="bg-white rounded-2xl border border-[color:var(--color-border)] p-4 shadow-sm flex flex-col gap-3">
      <header className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-[color:var(--color-ink)] truncate">
            {client.client_name}
          </h3>
          <p className="text-xs text-[color:var(--color-muted)]">
            {formatAgo(client.months_since)}
          </p>
        </div>
        {badge}
      </header>

      <div className="flex items-center justify-between text-xs text-[color:var(--color-muted)]">
        <span>
          Total histórico:{' '}
          <strong className="text-[color:var(--color-ink)]">
            {formatTotal(client.total_value)}
          </strong>
        </span>
        {client.last_service_desc ? (
          <span className="truncate ml-2 max-w-[50%] text-right">
            {client.last_service_desc}
          </span>
        ) : null}
      </div>

      {!canSend ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
          Não dá pra enviar: {reason}.
        </p>
      ) : null}

      <label className="sr-only" htmlFor={`crm-msg-${client.id}`}>
        Mensagem de reativação para {client.client_name}
      </label>
      <textarea
        id={`crm-msg-${client.id}`}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          localDrafting
            ? 'Gerando mensagem…'
            : 'Mensagem de reativação — gere com a IA ou escreva aqui…'
        }
        rows={4}
        className="w-full p-2 text-sm border border-[color:var(--color-border)] rounded-lg resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
        aria-label="Mensagem de reativação"
      />

      {localError ? (
        <div
          role="alert"
          className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2 py-1"
        >
          {localError}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleDraft}
          disabled={localDrafting || isGeneratingGlobal}
          className="flex-1 px-3 py-2 text-sm font-semibold rounded-xl bg-[color:var(--color-bg)] text-[color:var(--color-ink)] border border-[color:var(--color-border)] disabled:opacity-60 disabled:cursor-not-allowed hover:bg-[color:var(--color-border)] transition-colors"
          aria-label="Gerar mensagem com IA"
        >
          {localDrafting ? 'Gerando…' : 'Gerar mensagem (IA)'}
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend || localSending || isLoggingGlobal}
          className="flex-1 px-3 py-2 text-sm font-semibold rounded-xl bg-[color:var(--color-p1)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          aria-label="Enviar pelo WhatsApp"
        >
          {localSending ? 'Enviando…' : 'Enviar pelo WhatsApp'}
        </button>
      </div>
    </article>
  );
}
