'use client';
// OrcamentoSheet — modal "Pedir orçamento" disparado pelo botão Orçar de
// um post. Porta `abrirOrcamentoChat` + `enviarOrcamentoForm` do vanilla
// (modules/orcamento-form.js linhas 31-269).
//
// Fluxo no submit:
//  1) RPC create_quote_from_post (SECURITY DEFINER — força client_id=auth.uid)
//     → cria linha em `quotes` no pipeline do pintor.
//  2) INSERT em `notifications` (sininho do pintor).
//  3) INSERT em `messages` numa conv 1:1 client→painter, com a mesma cópia
//     resumida do pedido — caller pode ir pro /chat ver a thread.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BottomSheet } from '@/components/BottomSheet';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { buildDirectConvId } from '@/lib/services/chat-types';

export interface OrcamentoSheetProps {
  open: boolean;
  onClose: () => void;
  painterId: string;
  painterName?: string | null;
  postId?: string | null;
}

const TIPOS = [
  'Selecione…',
  'Pintura interna',
  'Pintura externa / fachada',
  'Textura (grafiato/marmorato)',
  'Piso epóxi',
  'Esmalte (portas/grades)',
  'Pintura automotiva',
  'Grafite / mural',
];
const SUPERFICIES = ['Selecione…', 'Parede', 'Teto', 'Chão', 'Madeira', 'Metal', 'Telhado'];
const LINHAS = ['Selecione…', 'Econômica', 'Standard', 'Premium'];
const PRAZOS = [
  'Selecione…',
  'O quanto antes',
  'Em até 1 semana',
  'Em até 15 dias',
  'Em até 1 mês',
  'Sem pressa / a combinar',
];

export function OrcamentoSheet({ open, onClose, painterId, painterName, postId }: OrcamentoSheetProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [tipo, setTipo] = useState(TIPOS[0]);
  const [sup, setSup] = useState(SUPERFICIES[0]);
  const [comodos, setComodos] = useState('');
  const [area, setArea] = useState('');
  const [linha, setLinha] = useState(LINHAS[0]);
  const [prazo, setPrazo] = useState(PRAZOS[0]);
  const [obs, setObs] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildSummary(): string[] {
    const lines: string[] = [`Olá, ${painterName || ''}! Gostaria de solicitar um orçamento:`];
    if (tipo !== TIPOS[0]) lines.push(`📌 Tipo: ${tipo}`);
    if (sup !== SUPERFICIES[0]) lines.push(`🧱 Superfície: ${sup}`);
    if (comodos.trim()) lines.push(`🚪 Cômodos: ${comodos.trim()}`);
    if (area.trim()) lines.push(`📐 Área: ${area.trim()}`);
    if (linha !== LINHAS[0]) lines.push(`🎨 Linha: ${linha}`);
    if (prazo !== PRAZOS[0]) lines.push(`📅 Prazo: ${prazo}`);
    if (obs.trim()) lines.push(`📝 Obs: ${obs.trim()}`);
    return lines;
  }

  async function handleSubmit() {
    if (!user) {
      setError('Faça login pra pedir orçamento.');
      return;
    }
    if (user.id === painterId) {
      setError('Você não pode pedir orçamento pra si mesmo.');
      return;
    }
    const parts = buildSummary();
    if (parts.length === 1) {
      setError('Preencha pelo menos um campo.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const sb = getSupabase();
      const serviceType = tipo !== TIPOS[0] ? tipo : 'Solicitação de orçamento';
      const areaNum = parseFloat(area.replace(/[^\d.,]/g, '').replace(',', '.'));

      // 1) Cria quote (RPC com SECURITY DEFINER)
      const { data: quoteId, error: rpcErr } = await sb.rpc('create_quote_from_post', {
        p_painter_id: painterId,
        p_post_id: postId ?? null,
        p_title: serviceType,
        p_service_type: serviceType,
        p_area_m2: Number.isFinite(areaNum) ? areaNum : null,
        p_address: null,
        p_description: parts.slice(1).join('\n') || null,
        p_proposed_date: null,
        p_images: [],
        p_lead_type: 'exclusive',
      });
      if (rpcErr) throw new Error(rpcErr.message);

      // 2) Notificação pro pintor (cast minimal — schema tem RLS via auth.uid)
      const meuNome =
        (user.user_metadata as { name?: string } | undefined)?.name || 'Um cliente';
      const sbAny = sb as unknown as {
        from: (t: string) => {
          insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      };
      await sbAny.from('notifications').insert({
        user_id: painterId,
        actor_id: user.id,
        type: 'quote_request',
        title: 'Novo pedido de orçamento 📋',
        body: `${meuNome} solicitou um orçamento. Veja no seu pipeline.`,
        ref_id: quoteId ? String(quoteId) : null,
      });

      // 3) Mensagem no chat — mesma cópia resumida do pedido
      try {
        const convId = buildDirectConvId(user.id, painterId);
        await sbAny.from('messages').insert({
          sender_id: user.id,
          receiver_id: painterId,
          conversation_id: convId,
          content: parts.join('\n'),
          type: 'text',
        });
      } catch {
        // chat best-effort; pedido já foi salvo no pipeline + sininho.
      }

      onClose();
      router.push('/chat');
    } catch (e) {
      setError((e as Error).message || 'Erro ao enviar o pedido.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Pedir orçamento">
      <h3
        className="font-extrabold text-center"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          marginBottom: 6,
          color: 'var(--color-ink)',
        }}
      >
        Pedir orçamento
      </h3>
      {painterName ? (
        <p
          className="text-center"
          style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 12 }}
        >
          Para <b style={{ color: 'var(--color-ink)' }}>{painterName}</b>
        </p>
      ) : null}

      <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
        <Field label="Tipo de pintura">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
            {TIPOS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Superfície">
          <select value={sup} onChange={(e) => setSup(e.target.value)} className={inputCls}>
            {SUPERFICIES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Cômodos">
          <input
            type="text"
            value={comodos}
            onChange={(e) => setComodos(e.target.value)}
            placeholder="Ex: 3 quartos + 1 sala"
            className={inputCls}
          />
        </Field>
        <Field label="Área ou metragem">
          <input
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Ex: 80 m²"
            className={inputCls}
          />
        </Field>
        <Field label="Linha de tinta">
          <select value={linha} onChange={(e) => setLinha(e.target.value)} className={inputCls}>
            {LINHAS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Prazo desejado">
          <select value={prazo} onChange={(e) => setPrazo(e.target.value)} className={inputCls}>
            {PRAZOS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Observações">
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={3}
            placeholder="Cores, ambiente, acesso, etc."
            className={inputCls}
            style={{ resize: 'none' }}
          />
        </Field>
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--color-danger, #c00)',
            margin: '8px 0 0',
            padding: 8,
            background: 'rgba(200,0,0,.08)',
            borderRadius: 8,
          }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full text-white font-bold"
        style={{
          padding: 15,
          marginTop: 14,
          background: 'var(--color-ink)',
          borderRadius: 14,
          fontSize: 15,
          border: 'none',
          cursor: submitting ? 'wait' : 'pointer',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Enviando…' : 'Enviar orçamento'}
      </button>
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.5px',
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]';
