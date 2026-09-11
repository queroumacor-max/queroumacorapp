// Página /orcamentos/[id] — detalhe de um orçamento + ações.
// Equivale ao modal `quote-snapshot-modal` do vanilla (modules/pipeline.js
// `verSnapshot` linha 363) + os botões de ação por status, mas como rota
// dedicada — facilita compartilhamento de link e back-nav nativo.
//
// Padrão: client component "use client" porque precisa de useAuth (Realtime
// invalidação) + mutations interativas. Não dá pra usar Server Component
// puro aqui porque a tela é toda transacional. RSC seria útil só pra prefetch
// inicial — pode vir depois usando React.use(params) + Suspense.

'use client';

// Cloudflare Pages via @cloudflare/next-on-pages: rotas dinâmicas precisam
// edge runtime (Node runtime não está disponível em CF Pages Functions).
// Next.js 15 aceita route segment config em arquivos 'use client' — a
// diretiva é lida pelo framework no compile-time, não em runtime no client.
export const runtime = 'edge';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { usePipeline } from '@/lib/hooks/usePipeline';
import { getSupabase } from '@/lib/supabase';
import { useAutosave } from '@/lib/hooks/useAutosave';
import {
  QUOTE_STATUS,
  fetchQuote,
  type PipelineStatus,
} from '@/lib/services/pipeline';
import type { Quote } from '@/lib/types';
import { QuotePdfSheet } from './QuotePdfSheet';
import { urlParaBaixar, waMeTarget } from '@/lib/pdf/quotePdf';
import { abrirLinkExterno } from '@/lib/native';
import {
  detalhesDoServico,
  quantidadeDe,
  resumoDoServico,
  servicosDoQuoteData,
  subtotalDoItem,
  valorUnitarioDe,
} from '@/lib/orcamentoServicos';
import { unidadeCurta } from '@/lib/services/priceTable';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatBRL(n: number | null | undefined): string {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return BRL.format(0);
  return BRL.format(x);
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '';
  }
}

function resolveStatus(raw: string | null | undefined): PipelineStatus {
  if (!raw) return 'rascunho';
  if (raw in QUOTE_STATUS) return raw as PipelineStatus;
  if (raw === 'aceito') return 'aprovado';
  if (raw === 'pending') return 'enviado';
  return 'rascunho';
}

interface PageProps {
  // Next 15: params é Promise — uso `use()` pra unwrap dentro do client.
  params: Promise<{ id: string }>;
}

export default function OrcamentoDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { user, loading: authLoading } = useAuth();
  const dialog = useDialog();
  const router = useRouter();
  const {
    quotes,
    send,
    isSending,
    sendError,
    approve,
    isApproving,
    approveError,
    reject,
    isRejecting,
    rejectError,
    advance,
    isAdvancing,
    advanceError,
  } = usePipeline();

  // Cache local pra quando a quote não estiver no array do hook (acesso
  // direto via link sem passar pelo kanban primeiro).
  const [localQuote, setLocalQuote] = useState<Quote | null>(null);
  const [fetching, setFetching] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  // Lista de apps NOSSA, mostrada no app instalado depois que o PDF sobe.
  // Não é a tela de compartilhar do Android — essa não existe pro lado web
  // dentro da WebView (ver a nota sobre `intent:` em quotePdf.ts). Cada
  // opção aqui é uma URL comum que o wrapper já sabe abrir.
  const [enviarPdf, setEnviarPdf] = useState<{ url: string; texto: string; arquivo: string } | null>(null);

  // Painter profile = dono do orçamento (quote.painter_id), NÃO o user logado.
  // Antes usei useProfile() do current user, mas se admin abrir orçamento de
  // outro pintor, o cabeçalho do PDF mostrava o nome do admin. Fix puxa pelo
  // painter_id da quote.
  const [painterProfile, setPainterProfile] = useState<{
    name?: string | null;
    tag?: string | null;
    phone?: string | null;
    email?: string | null;
    city?: string | null;
    state?: string | null;
    business_logo_url?: string | null;
    business_name?: string | null;
    avatar_url?: string | null;
  } | null>(null);

  // Rascunho de notas privadas por orçamento — não bate no banco, só
  // localStorage. Persistido com TTL 7d pelo useAutosave. Útil pra o
  // pintor anotar lembretes ("ligar quinta", "cliente prefere fosco") sem
  // poluir a tabela quotes. Key `quote_${id}` por spec UX#6.
  const [internalNote, setInternalNote] = useState('');
  const [draftSavedAt, setDraftSavedAt] = useState(0);
  const noteValues = useMemo(() => ({ note: internalNote }), [internalNote]);
  const autosave = useAutosave<{ note: string }>({
    key: `quote_${id}`,
    values: noteValues,
    onRestore: (restored) => {
      if (typeof restored.note === 'string') setInternalNote(restored.note);
    },
  });
  useEffect(() => {
    if (autosave.lastSavedAt && autosave.lastSavedAt !== draftSavedAt) {
      setDraftSavedAt(autosave.lastSavedAt);
    }
  }, [noteValues, autosave.lastSavedAt, draftSavedAt]);

  // Prefere a quote do hook (mantida fresh pelo realtime); fallback pra
  // fetch direto se não estiver no cache.
  const quote = quotes.find((q) => q.id === id) ?? localQuote;

  useEffect(() => {
    if (authLoading || !user) return;
    if (quotes.some((q) => q.id === id)) return;
    setFetching(true);
    fetchQuote(id)
      .then((q) => setLocalQuote(q))
      .catch(() => setLocalQuote(null))
      .finally(() => setFetching(false));
  }, [authLoading, user, quotes, id]);

  // Fetch dos dados do pintor (dono da quote) pelo painter_id. Roda quando
  // a quote chega no estado e ainda não temos o profile carregado. Usa
  // profiles_public (campos seguros — name/tag/avatar/city/state) + chama
  // profiles direto pra phone/email/business_logo_url (RLS permite read
  // próprio; admin lê tudo).
  useEffect(() => {
    if (!quote?.painter_id) return;
    let cancel = false;
    const sb = getSupabase();
    (async () => {
      try {
        // Telefone/e-mail do pintor: só pra quem é PARTE do orçamento, via
        // RPC `quote_party_contact` (SECURITY DEFINER, confere client_id/
        // painter_id = auth.uid()). A tabela `profiles` não devolve mais a
        // linha de outra pessoa (auditoria 2026-09-11).
        const { data } = await sb.rpc('quote_party_contact' as never, {
          p_quote_id: quote.id,
        } as never);
        if (cancel) return;
        const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<typeof painterProfile>;
        const contato = rows.find((r) => r && (r as { id?: string }).id === quote.painter_id) ?? rows[0];
        if (contato) {
          setPainterProfile(contato as typeof painterProfile);
        } else {
          // Fallback: profiles_public se select privado bloquear.
          const { data: pub } = await sb
            .from('profiles_public')
            .select('id, name, tag, avatar_url, city, state')
            .eq('id', quote.painter_id!)
            .maybeSingle();
          if (cancel) return;
          if (pub) setPainterProfile(pub as typeof painterProfile);
        }
      } catch {
        // sem profile no PDF, fallback cabeçalho genérico
      }
    })();
    return () => { cancel = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.painter_id]);

  const mutationError = sendError || approveError || rejectError || advanceError;
  const isBusy = isSending || isApproving || isRejecting || isAdvancing;

  // ─── empty / loading states ──────────────────────────────────────

  if (authLoading) {
    return (
      <main className="min-h-screen p-4 max-w-2xl mx-auto">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-2/3 bg-[color:var(--color-border)] rounded" />
          <div className="h-4 w-1/2 bg-[color:var(--color-border)] rounded" />
          <div className="h-64 bg-[color:var(--color-border)] rounded-2xl" />
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen p-4 max-w-2xl mx-auto">
        <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <h2 className="font-semibold mb-2">Entre pra ver o orçamento</h2>
          <Link
            href="/login"
            className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold mt-2"
          >
            Entrar
          </Link>
        </div>
      </main>
    );
  }

  if (fetching && !quote) {
    return (
      <main className="min-h-screen p-4 max-w-2xl mx-auto">
        <div className="animate-pulse h-64 bg-[color:var(--color-border)] rounded-2xl" />
      </main>
    );
  }

  if (!quote) {
    return (
      <main className="min-h-screen p-4 max-w-2xl mx-auto">
        <Link
          href="/orcamentos"
          className="text-sm text-[color:var(--color-muted)] hover:underline"
        >
          ← Voltar pro pipeline
        </Link>
        <div className="text-center py-12 mt-4 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-5xl mb-3" aria-hidden="true">
            ❓
          </div>
          <h2 className="font-semibold">Orçamento não encontrado</h2>
          <p className="text-sm text-[color:var(--color-muted)] mt-2">
            Pode ter sido removido ou você não tem acesso a ele.
          </p>
        </div>
      </main>
    );
  }

  const status = resolveStatus(quote.status);
  const meta = QUOTE_STATUS[status];
  // Snapshot já existe pra aprovado/em_execucao/concluido; nos demais é null.
  const snapshot = quote.scope_snapshot ?? null;
  const data = snapshot ?? {
    service_type: quote.service_type ?? null,
    title: quote.title ?? null,
    area_m2: quote.area_m2 ?? null,
    address: quote.address ?? null,
    description: quote.description ?? null,
    price: Number(quote.price) || 0,
    proposed_date: quote.proposed_date ?? null,
    quote_data: quote.quote_data ?? null,
  };
  const qd = data.quote_data as
    | { itens?: Array<{ desc?: string; valor?: string }>; pagamento?: string[] }
    | null
    | undefined;
  // Serviços do tile Orçamento (espaço/material + itens da Tabela ABRAPP).
  const servicos = servicosDoQuoteData(data.quote_data);

  // ─── action handlers ──────────────────────────────────────────────

  const handleSend = async () => {
    const raw = await dialog.prompt(
      'Valor do orçamento (R$):',
      Number(quote.price) > 0 ? String(quote.price) : '',
      { title: 'Enviar orçamento', okLabel: 'Próximo' },
    );
    if (raw == null) return;
    const price = Number(String(raw).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0) {
      await dialog.alert('Informe um valor válido.');
      return;
    }
    const proposedDate = await dialog.prompt(
      'Prazo de conclusão (AAAA-MM-DD) — deixe em branco se a combinar:',
      quote.proposed_date || '',
      { title: 'Prazo', okLabel: 'Próximo' },
    );
    if (proposedDate == null) return;
    const existingWarranty =
      ((quote.quote_data as { warranty?: string } | null)?.warranty) ||
      '90 dias para retoques';
    const warranty = await dialog.prompt(
      'Garantia oferecida:',
      existingWarranty,
      { title: 'Garantia', okLabel: 'Enviar' },
    );
    if (warranty == null) return;
    send({
      id: quote.id,
      price,
      proposedDate: proposedDate.trim() || null,
      warranty: warranty.trim() || null,
    });
  };

  // ─── share/pdf/chat handlers ─────────────────────────────────────────
  // Texto plano formatado pra WhatsApp/email/clipboard/chat. Espelha o
  // buildPlainText do QuoteWizard pra consistência visual cross-feature.
  // Recebe quote como parâmetro pra evitar narrowing TS — o caller chama
  // só depois do early-return de quote==null abaixo.
  function buildQuoteText(q: NonNullable<typeof quote>): string {
    const warr = ((q.quote_data as { warranty?: string } | null)?.warranty) || '';
    const price = Number(q.price) || 0;
    const lines = [
      `*Orçamento — ${q.service_type || q.title || 'Pintura'}*`,
      '',
      q.client_name ? `Cliente: ${q.client_name}` : null,
      q.address ? `Endereço: ${q.address}` : null,
      q.area_m2 ? `Área: ${q.area_m2} m²` : null,
      q.proposed_date ? `Prazo: ${q.proposed_date}` : null,
      warr ? `Garantia: ${warr}` : null,
      '',
      q.description ? `Escopo:\n${q.description}` : null,
      '',
      price > 0 ? `💰 *Valor: R$ ${price.toLocaleString('pt-BR')}*` : null,
    ].filter(Boolean);
    return lines.join('\n');
  }

  function handlePrintPdf() {
    // Abre o preview formatado (QuotePdfSheet) com cabeçalho do pintor, dados
    // do cliente, tabela de detalhes, escopo, valor destacado. Botão dentro
    // dispara window.print() pra salvar como PDF.
    setPdfOpen(true);
  }

  function handleShareWhatsApp() {
    if (!quote) return;
    const text = encodeURIComponent(buildQuoteText(quote));
    const digits = (quote.client_phone || '').replace(/\D/g, '');
    const url = digits ? `https://wa.me/55${digits}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function handleShareEmail() {
    if (!quote) return;
    const subj = encodeURIComponent(`Orçamento — ${quote.service_type || 'Pintura'}`);
    const body = encodeURIComponent(buildQuoteText(quote));
    // `location.href` na casca vira a tela "Sem conexão" (ver abrirLinkExterno).
    abrirLinkExterno(`mailto:?subject=${subj}&body=${body}`);
  }

  function abrirDestino(destino: string) {
    setEnviarPdf(null);
    abrirLinkExterno(destino);
  }

  async function handleShareNative() {
    if (!quote) return;
    // Compartilhar = mandar o PDF pro cliente. Três caminhos, nessa ordem:
    //
    //  1. share sheet do sistema com o ARQUIVO anexo (Chrome Android,
    //     Safari iOS 15+, Edge) — o melhor;
    //  2. app instalado: `navigator.share` não existe na WebView, então o
    //     PDF sobe pro Storage e o LINK dele vai pra tela de compartilhar
    //     do Android (intent ACTION_SEND — WhatsApp, Mensagens, Facebook…);
    //     se o wrapper não tratar o intent, cai no WhatsApp direto;
    //  3. navegador desktop: baixa o arquivo.
    try {
      const { shareOrDownloadQuotePdf } = await import('@/lib/pdf/quotePdf');
      const result = await shareOrDownloadQuotePdf(
        quote,
        painterProfile,
        { text: buildQuoteText(quote), phone: quote.client_phone || null },
        (url, texto, arquivo) => setEnviarPdf({ url, texto, arquivo }),
      );
      if (result === 'downloaded') {
        await dialog.alert(
          'PDF baixado. Anexe no WhatsApp/email pra enviar ao cliente.',
          { title: 'Download concluído' },
        );
      } else if (result === 'failed') {
        // No app instalado o PDF precisa subir pro Storage pra virar link.
        // Falhando isso não há entrega possível — e o antigo "último
        // recurso" (data URL com o PDF inteiro) CONGELAVA o app.
        await dialog.alert(
          'Não consegui preparar o PDF agora. Tente de novo em instantes.',
          { title: 'Não deu' },
        );
      }
    } catch (e) {
      await dialog.alert(
        'Falha ao gerar PDF: ' + ((e as Error).message || ''),
        { title: 'Erro' },
      );
    }
  }

  function handleSendChat() {
    if (!quote) return;
    try {
      sessionStorage.setItem('chat:prefill', buildQuoteText(quote));
    } catch {
      /* ignore */
    }
    // Navegação de documento na casca = chance de "Sem conexão" (a errorPath
    // do Capacitor aparece quando a navegação falha ou é cancelada). O router
    // troca de tela sem recarregar o app; o prefill vive no sessionStorage,
    // que sobrevive igual.
    router.push('/chat');
  }

  const handleApprove = async () => {
    const ok = await dialog.confirm(
      'Marcar este orçamento como aceito pelo cliente?\n\nO escopo e o valor ficam congelados.',
      { title: 'Aprovar', okLabel: 'Aprovar' },
    );
    if (!ok) return;
    const note = await dialog.prompt('Observação da aprovação (opcional):', '', {
      title: 'Observação',
      okLabel: 'Confirmar',
    });
    if (note === null) return;
    approve({ id: quote.id, quote, note });
  };

  const handleReject = async () => {
    const ok = await dialog.confirm('Marcar este orçamento como recusado?', {
      title: 'Recusar',
      okLabel: 'Recusar',
      danger: true,
    });
    if (!ok) return;
    reject(quote.id);
  };

  const handleStart = () => {
    advance({ id: quote.id, status: 'em_execucao' });
  };

  const handleComplete = async () => {
    const ok = await dialog.confirm('Concluir este orçamento?', {
      title: 'Concluir',
      okLabel: 'Concluir',
    });
    if (!ok) return;
    advance({ id: quote.id, status: 'concluido' });
  };

  // ─── render ──────────────────────────────────────────────────────

  return (
    <main className="min-h-screen p-4 max-w-2xl mx-auto quote-detail-print">
      {/* @media print: esconde header/nav/footer + botões pra impressão limpa */}
      <style>{`
        @media print {
          .quote-pdf-noprint, .top-nav, .bot-nav, nav, header.top-nav { display: none !important; }
          body { background: #fff !important; }
          .quote-detail-print { padding: 0 !important; max-width: none !important; }
        }
      `}</style>
      <Link
        href="/orcamentos"
        className="text-sm text-[color:var(--color-muted)] hover:underline"
      >
        ← Voltar pro pipeline
      </Link>

      <header className="flex items-start gap-3 mt-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {quote.client_name || quote.client?.name || 'Cliente'}
          </h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            {quote.service_type || quote.title || 'Orçamento'}
          </p>
        </div>
        <span
          className="text-xs font-extrabold uppercase tracking-wider whitespace-nowrap"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
      </header>

      {mutationError ? (
        <div
          role="alert"
          className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {mutationError.message || 'Não foi possível concluir a ação.'}
        </div>
      ) : null}

      {/* Snapshot info — banner com timestamp pra status congelado */}
      <section className="bg-white rounded-2xl border border-[color:var(--color-border)] p-4 mb-4">
        {snapshot ? (
          <div className="text-xs text-[color:var(--color-ink)] bg-[#ecfdf5] border border-[#a7f3d0] rounded-lg p-3 mb-3">
            🔒 Escopo congelado na aprovação
            {quote.approved_at ? ` — ${formatDateTime(quote.approved_at)}` : ''}.
            Esta é a referência acordada com o cliente.
          </div>
        ) : (
          <div className="text-xs text-[color:var(--color-muted)] mb-3">
            Orçamento ainda não aprovado — o escopo pode mudar até a aprovação.
          </div>
        )}

        <dl className="text-sm divide-y divide-[color:var(--color-border)]">
          {data.service_type || data.title ? (
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-[color:var(--color-muted)]">Serviço</dt>
              <dd className="font-semibold text-right">
                {data.service_type || data.title}
              </dd>
            </div>
          ) : null}
          {data.area_m2 ? (
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-[color:var(--color-muted)]">Área</dt>
              <dd className="font-semibold">{data.area_m2} m²</dd>
            </div>
          ) : null}
          {data.address ? (
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-[color:var(--color-muted)]">Endereço</dt>
              <dd className="font-semibold text-right">{data.address}</dd>
            </div>
          ) : null}
          {data.description ? (
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-[color:var(--color-muted)]">Descrição</dt>
              <dd className="font-semibold text-right whitespace-pre-wrap">
                {data.description}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="flex justify-between items-center pt-3 mt-2 border-t border-[color:var(--color-border)]">
          <span className="text-sm font-bold">TOTAL</span>
          <span
            className="text-2xl font-extrabold text-[color:var(--color-p1)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {formatBRL(data.price)}
          </span>
        </div>

        {servicos.length > 0 ? (
          <div className="mt-4 space-y-4">
            {servicos.map((s, i) => (
              <div key={s.id}>
                <h3 className="text-xs font-bold uppercase text-[color:var(--color-muted)] mb-1">
                  {servicos.length > 1 ? `Serviço ${i + 1}` : 'Serviço'}
                </h3>
                <p className="text-sm font-bold">{resumoDoServico(s)}</p>
                <dl className="text-xs text-[color:var(--color-muted)] mt-1 space-y-0.5">
                  {detalhesDoServico(s)
                    .filter(([k]) => k !== 'Área' && k !== 'Cômodos')
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <dt>{k}</dt>
                        <dd className="text-right text-[color:var(--color-ink)]">{v}</dd>
                      </div>
                    ))}
                </dl>
                {s.itens.length > 0 ? (
                  <ul className="text-sm divide-y divide-[color:var(--color-border)] mt-2 border-t border-[color:var(--color-border)]">
                    {s.itens.map((it) => {
                      const v = valorUnitarioDe(it);
                      const sub = subtotalDoItem(it);
                      return (
                        <li key={it.id} className="flex justify-between gap-3 py-1.5">
                          <span className="min-w-0">
                            <span className="block font-semibold">{it.servico}</span>
                            <span className="block text-xs text-[color:var(--color-muted)]">
                              {quantidadeDe(it)} {unidadeCurta(it.unidade)}
                              {v !== null ? ` × ${formatBRL(v)}` : ''}
                            </span>
                          </span>
                          <span className="whitespace-nowrap font-semibold">
                            {sub !== null ? formatBRL(sub) : (
                              <span className="text-[color:var(--color-muted)] font-normal">a definir</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {qd && Array.isArray(qd.itens) && qd.itens.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-bold uppercase text-[color:var(--color-muted)] mb-2">
              Itens
            </h3>
            <ul className="text-sm divide-y divide-[color:var(--color-border)]">
              {qd.itens.map((it, i) => (
                <li
                  key={i}
                  className="flex justify-between gap-3 py-1.5"
                >
                  <span>{it.desc || ''}</span>
                  <span className="text-[color:var(--color-muted)] whitespace-nowrap">
                    {it.valor || ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {qd && Array.isArray(qd.pagamento) && qd.pagamento.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-bold uppercase text-[color:var(--color-muted)] mb-2">
              Pagamento
            </h3>
            <ul className="text-sm">
              {qd.pagamento.map((p, i) => (
                <li key={i}>• {p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {quote.approval_note ? (
          <div className="mt-4">
            <h3 className="text-xs font-bold uppercase text-[color:var(--color-muted)] mb-2">
              Observação da aprovação
            </h3>
            <p className="text-sm">{quote.approval_note}</p>
          </div>
        ) : null}
      </section>

      {/* Ações sempre disponíveis: PDF / WhatsApp / Email / Chat / Compartilhar.
          Independente do status — pintor pode mandar o PDF do orçamento aprovado
          pra o cliente abrir, reenviar via WhatsApp, etc. */}
      <section className="flex flex-wrap gap-2 mb-2 quote-pdf-noprint">
        {/* Compartilhar PDF — botão principal (gradient). Web Share API com
            file abre o share sheet do device → user escolhe WhatsApp / E-mail
            / Drive / etc, com o PDF anexado. Fallback: download. */}
        <button
          type="button"
          onClick={handleShareNative}
          className="px-4 py-2 text-white rounded-xl font-bold text-sm"
          style={{
            background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
            border: 'none',
          }}
        >
          📲 Compartilhar PDF
        </button>
        <button
          type="button"
          onClick={handlePrintPdf}
          className="px-3 py-2 bg-white border border-[color:var(--color-border)] rounded-xl font-semibold text-sm"
        >
          🖨️ Visualizar
        </button>
        <button
          type="button"
          onClick={handleShareWhatsApp}
          className="px-3 py-2 bg-white border border-[color:var(--color-border)] rounded-xl font-semibold text-sm"
        >
          💬 WhatsApp (texto)
        </button>
        <button
          type="button"
          onClick={handleShareEmail}
          className="px-3 py-2 bg-white border border-[color:var(--color-border)] rounded-xl font-semibold text-sm"
        >
          ✉️ E-mail
        </button>
        <button
          type="button"
          onClick={handleSendChat}
          className="px-3 py-2 bg-white border border-[color:var(--color-border)] rounded-xl font-semibold text-sm"
        >
          💭 Chat
        </button>
      </section>

      {/* Ações disponíveis por status */}
      <section className="flex flex-wrap gap-2">
        {status === 'rascunho' ? (
          <button
            type="button"
            onClick={handleSend}
            disabled={isBusy}
            className="px-4 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold text-sm disabled:opacity-60"
          >
            Enviar orçamento
          </button>
        ) : null}
        {status === 'enviado' ? (
          <>
            <button
              type="button"
              onClick={handleApprove}
              disabled={isBusy}
              className="px-4 py-2 bg-[#2ec4b6] text-white rounded-xl font-semibold text-sm disabled:opacity-60"
            >
              Marcar como aceito
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isBusy}
              className="px-4 py-2 bg-white border border-[color:var(--color-border)] text-[color:var(--color-ink)] rounded-xl font-semibold text-sm disabled:opacity-60"
            >
              Marcar como recusado
            </button>
          </>
        ) : null}
        {status === 'aprovado' ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={isBusy}
            className="px-4 py-2 bg-[#3a86ff] text-white rounded-xl font-semibold text-sm disabled:opacity-60"
          >
            Iniciar execução
          </button>
        ) : null}
        {status === 'em_execucao' ? (
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy}
            className="px-4 py-2 bg-[#16a34a] text-white rounded-xl font-semibold text-sm disabled:opacity-60"
          >
            Concluir
          </button>
        ) : null}
      </section>

      {/* Bloco de anotações privadas autosaved (UX#6). Visível só pra quem
          é dono — outros usuários nem chegam até aqui (RLS na quote). */}
      <section className="mt-4 bg-white rounded-2xl border border-[color:var(--color-border)] p-4">
        <label
          htmlFor="quote-internal-note"
          className="block text-xs font-bold uppercase text-[color:var(--color-muted)] mb-2"
        >
          Anotações internas
        </label>
        <textarea
          id="quote-internal-note"
          value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Lembretes só seus (ex.: cliente prefere fosco, ligar quinta)…"
          className="w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
        />
        {draftSavedAt > 0 ? (
          <p
            className="mt-2 text-xs text-[color:var(--color-muted)]"
            role="status"
            aria-live="polite"
          >
            Rascunho salvo
          </p>
        ) : (
          <p className="mt-2 text-xs text-[color:var(--color-muted)]">
            Salvo só no seu dispositivo. Não compartilhado com o cliente.
          </p>
        )}
      </section>

      <QuotePdfSheet
        open={pdfOpen}
        onClose={() => setPdfOpen(false)}
        quote={quote}
        painter={painterProfile as unknown as {
          name?: string | null;
          tag?: string | null;
          phone?: string | null;
          city?: string | null;
          state?: string | null;
          email?: string | null;
          business_logo_url?: string | null;
          business_name?: string | null;
          avatar_url?: string | null;
        } | null}
      />

      {enviarPdf && (
        <EscolherAppSheet
          info={enviarPdf}
          clientPhone={quote.client_phone || null}
          onClose={() => setEnviarPdf(null)}
          onPick={abrirDestino}
        />
      )}
    </main>
  );
}

/**
 * "Enviar orçamento por" — a lista de apps que aparece no celular depois
 * que o PDF sobe pro Storage.
 *
 * Por que é NOSSA e não a do Android: dentro da WebView do wrapper não
 * existe `navigator.share`, e pedir a tela do sistema por `intent:` foi
 * testado em 2026-08-29 e deu errado feio — o wrapper trata a URL do
 * intent como download, abre o "Save As" com milhares de caracteres no
 * campo de nome e salvar dali fecha o app. Então as opções aqui são todas
 * URLs comuns (https/mailto/sms) que o wrapper já sabe entregar pro app
 * certo.
 *
 * O que vai é o LINK do PDF, não o arquivo anexado: anexar exigiria uma
 * URI `content://`, impossível pelo lado web. Anexo de verdade só com
 * build nativo.
 */
function EscolherAppSheet({
  info,
  clientPhone,
  onClose,
  onPick,
}: {
  info: { url: string; texto: string; arquivo: string };
  clientPhone: string | null;
  onClose: () => void;
  onPick: (destino: string) => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const txt = encodeURIComponent(info.texto);
  // Regra do repo: 11 dígitos só é celular BR se o 3º for 9 — '55' cego já
  // transformou contato dos EUA em número inexistente (o 502 de 2026-08-28).
  const alvo = waMeTarget(clientPhone);
  const zap = alvo ? `https://wa.me/${alvo}?text=${txt}` : `https://wa.me/?text=${txt}`;
  const baixarUrl = urlParaBaixar(info.url, info.arquivo);

  const opcoes: Array<{ id: string; label: string; run: () => void }> = [
    {
      // Primeiro da lista de propósito: abrir é o que mais gente quer, e é
      // por dentro do visualizador de PDF do Android que existe o
      // compartilhar DE VERDADE do sistema, com todos os apps.
      id: 'abrir',
      label: '📄 Abrir o PDF',
      run: () => onPick(info.url),
    },
    {
      id: 'whats',
      label: alvo ? '💬 WhatsApp do cliente' : '💬 WhatsApp',
      run: () => onPick(zap),
    },
    {
      id: 'sms',
      label: '✉️ Mensagem (SMS)',
      run: () => onPick(`sms:${(clientPhone || '').replace(/\D/g, '')}?body=${txt}`),
    },
    {
      id: 'email',
      label: '📧 E-mail',
      run: () => onPick(`mailto:?subject=${encodeURIComponent('Orçamento')}&body=${txt}`),
    },
    {
      id: 'telegram',
      label: '➤ Telegram',
      run: () =>
        onPick(
          `https://t.me/share/url?url=${encodeURIComponent(info.url)}&text=${txt}`,
        ),
    },
    {
      id: 'face',
      label: '📘 Facebook',
      run: () =>
        onPick(
          `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(info.url)}`,
        ),
    },
    {
      id: 'baixar',
      label: '⬇️ Baixar o arquivo',
      // `?download=` liga o Content-Disposition: attachment — aí o Android
      // salva em vez de abrir.
      run: () => onPick(baixarUrl),
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Orçamento em PDF"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-6"
        style={{ maxHeight: '80dvh', overflowY: 'auto' }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold">Orçamento em PDF</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="px-2 text-xl">
            ×
          </button>
        </div>
        <p className="mb-3 text-xs text-[color:var(--color-muted)]">
          O PDF já está pronto. Abra pra conferir, ou escolha por onde
          mandar — vai o link, e o cliente abre tocando nele.
        </p>

        <div className="flex flex-col gap-2">
          {opcoes.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={o.run}
              className="rounded-xl border border-[color:var(--color-border)] px-4 py-3 text-left text-sm font-semibold"
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(info.url);
              } catch {
                // Clipboard bloqueado no wrapper: o link segue visível abaixo.
              }
              setCopiado(true);
            }}
            className="rounded-xl border border-[color:var(--color-border)] px-4 py-3 text-left text-sm font-semibold"
          >
            {copiado ? '✅ Link copiado' : '🔗 Copiar link'}
          </button>
        </div>

        {/* Se o clipboard falhar (comum na WebView), ainda dá pra selecionar
            o link na mão — melhor que um botão que não faz nada. */}
        <p className="mt-3 break-all text-[11px] text-[color:var(--color-muted)]">{info.url}</p>
      </div>
    </div>
  );
}
