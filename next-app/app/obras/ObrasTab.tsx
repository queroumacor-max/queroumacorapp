// Aba "Obras" do gestor: lista, criação/edição e o detalhe de cada obra
// (custos → Financeiro, anotações, orçamento vinculado, equipe escalada).
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDialog } from '@/components/Dialog';
import { showToast } from '@/lib/toast';
import { abrirLinkExterno } from '@/lib/native';
import { fetchQuotes } from '@/lib/services/pipeline';
import { parseBRL, ymdBrt } from '@/lib/utils';
import { CATEGORIAS_GASTO, type CategoriaGasto } from '@/lib/categoriasGasto';
import { STATUS_OBRA, resumoDaObra, rotuloDia, rotuloStatusObra } from '@/lib/obras';
import {
  anotarNaObra,
  apagarObra,
  escalaDaObra,
  lancamentosDaObra,
  lancarGastoDaObra,
  listEquipe,
  listObras,
  notasDaObra,
  salvarObra,
  vincularCliente,
  type Obra,
  type ObraInput,
} from '@/lib/services/obras';
import { getSupabase } from '@/lib/supabase';
import { useSingleFlight } from '@/lib/hooks/useSingleFlight';
import { Botao, Campo, Chip, ErroObras, brl, cls } from './ui';

type Filtro = 'ativas' | 'concluidas' | 'todas';

export function ObrasTab({ uid }: { uid: string }) {
  const [filtro, setFiltro] = useState<Filtro>('ativas');
  const [aberta, setAberta] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const q = useQuery({ queryKey: ['obras', uid], queryFn: () => listObras(uid), enabled: !!uid });

  const obras = useMemo(
    () =>
      (q.data ?? []).filter((o) =>
        filtro === 'todas' ? true : filtro === 'ativas' ? o.status !== 'concluida' : o.status === 'concluida',
      ),
    [q.data, filtro],
  );

  const obraAberta = (q.data ?? []).find((o) => o.id === aberta);
  if (obraAberta) return <ObraDetalhe uid={uid} obra={obraAberta} onVoltar={() => setAberta(null)} />;
  if (criando) return <ObraForm uid={uid} onFim={() => setCriando(false)} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2" role="group" aria-label="Filtrar obras">
        {(
          [
            ['ativas', 'Ativas'],
            ['concluidas', 'Concluídas'],
            ['todas', 'Todas'],
          ] as const
        ).map(([id, rot]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filtro === id}
            onClick={() => setFiltro(id)}
            className={`px-4 rounded-full text-sm font-bold border ${
              filtro === id
                ? 'bg-[color:var(--color-ink)] text-[color:var(--color-white)] border-[color:var(--color-ink)]'
                : 'bg-white text-[color:var(--color-ink)] border-[color:var(--color-border)]'
            }`}
            style={{ minHeight: 44 }}
          >
            {rot}
          </button>
        ))}
      </div>

      {q.error ? <ErroObras erro={q.error} /> : null}
      {q.isLoading ? <div className={`${cls.card} animate-pulse h-24`} aria-hidden="true" /> : null}
      {!q.isLoading && !q.error && obras.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)] text-center py-6">
          Nenhuma obra aqui ainda. Toque em &quot;Nova obra&quot; pra começar.
        </p>
      ) : null}

      {obras.map((o) => (
        <button key={o.id} type="button" onClick={() => setAberta(o.id)} className={`${cls.card} text-left`}>
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="font-bold text-base" style={{ fontFamily: 'var(--font-display)' }}>{o.nome}</div>
              {o.cliente ? <div className="text-sm text-[color:var(--color-muted)]">Cliente: {o.cliente}</div> : null}
            </div>
            <Chip tom={o.status}>{rotuloStatusObra(o.status)}</Chip>
          </div>
          {o.endereco ? <div className="text-sm mt-2 text-[color:var(--color-ink)]">📍 {o.endereco}</div> : null}
          <div className="text-xs mt-2 text-[color:var(--color-muted)]">
            {o.inicio ? `Início ${rotuloDia(o.inicio).curto}` : 'Sem data'}
            {o.fim ? ` · até ${rotuloDia(o.fim).curto}` : ''}
            {o.valor ? ` · ${brl(o.valor)}` : ''}
          </div>
        </button>
      ))}

      <Botao primario full onClick={() => setCriando(true)}>+ Nova obra</Botao>
    </div>
  );
}

// ─── formulário (criar / editar) ─────────────────────────────────────────

function ObraForm({ uid, obra, onFim }: { uid: string; obra?: Obra; onFim: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    nome: obra?.nome ?? '',
    cliente: obra?.cliente ?? '',
    endereco: obra?.endereco ?? '',
    status: obra?.status ?? 'planejada',
    inicio: obra?.inicio ?? '',
    fim: obra?.fim ?? '',
    valor: obra?.valor != null ? String(obra.valor).replace('.', ',') : '',
    quote_id: obra?.quote_id ?? '',
    observacoes: obra?.observacoes ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const quotes = useQuery({ queryKey: ['obras-quotes', uid], queryFn: () => fetchQuotes(uid), enabled: !!uid });
  const orcamentos = (quotes.data ?? []).filter((x) => ['aprovado', 'em_execucao', 'enviado', 'concluido'].includes(String(x.status)));

  const salvar = useMutation({
    mutationFn: () => {
      const valor = f.valor.trim() ? parseBRL(f.valor) : null;
      const input: ObraInput = { ...f, valor: Number.isFinite(valor as number) ? valor : null };
      return salvarObra(uid, input, obra?.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['obras', uid] });
      showToast(obra ? 'Obra atualizada' : 'Obra criada', 'success');
      onFim();
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });
  // Trava de clique duplo: o isPending só desabilita o botão no render
  // seguinte; um 2º toque rápido criava a obra duas vezes.
  const salvarFlight = useSingleFlight();

  function usarOrcamento(id: string) {
    set('quote_id', id);
    const q = orcamentos.find((x) => x.id === id);
    if (!q) return;
    setF((x) => ({
      ...x,
      quote_id: id,
      nome: x.nome || q.service_type || q.title || '',
      cliente: x.cliente || q.client_name || '',
      valor: x.valor || (q.price ? String(q.price).replace('.', ',') : ''),
    }));
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        // onError já mostra o toast; o catch só evita rejeição solta.
        salvarFlight.run(() => salvar.mutateAsync()).catch(() => {});
      }}
    >
      <h3 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>{obra ? 'Editar obra' : 'Nova obra'}</h3>
      {orcamentos.length ? (
        <Campo id="ob-orc" label="Vincular a um orçamento (opcional)">
          <select id="ob-orc" className={cls.input} value={f.quote_id} onChange={(e) => usarOrcamento(e.target.value)}>
            <option value="">Nenhum</option>
            {orcamentos.map((q) => (
              <option key={q.id} value={q.id}>
                {(q.client_name || 'Cliente') + ' — ' + (q.service_type || q.title || 'Orçamento') + (q.price ? ` (${brl(q.price)})` : '')}
              </option>
            ))}
          </select>
        </Campo>
      ) : null}
      <Campo id="ob-nome" label="Nome da obra">
        <input id="ob-nome" className={cls.input} value={f.nome} onChange={(e) => set('nome', e.target.value)} maxLength={120} placeholder="Pintura fachada" required />
      </Campo>
      <Campo id="ob-cli" label="Cliente">
        <input id="ob-cli" className={cls.input} value={f.cliente} onChange={(e) => set('cliente', e.target.value)} maxLength={120} />
      </Campo>
      <Campo id="ob-end" label="Endereço">
        <input id="ob-end" className={cls.input} value={f.endereco} onChange={(e) => set('endereco', e.target.value)} maxLength={300} placeholder="Rua, número — cidade" />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo id="ob-ini" label="Início">
          <input id="ob-ini" type="date" className={cls.input} value={f.inicio} onChange={(e) => set('inicio', e.target.value)} />
        </Campo>
        <Campo id="ob-fim" label="Fim previsto">
          <input id="ob-fim" type="date" className={cls.input} value={f.fim} onChange={(e) => set('fim', e.target.value)} />
        </Campo>
        <Campo id="ob-st" label="Situação">
          <select id="ob-st" className={cls.input} value={f.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_OBRA.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
          </select>
        </Campo>
        <Campo id="ob-val" label="Valor da obra (R$)">
          <input id="ob-val" inputMode="decimal" className={cls.input} value={f.valor} onChange={(e) => set('valor', e.target.value)} placeholder="0,00" />
        </Campo>
      </div>
      <Campo id="ob-obs" label="Observações">
        <textarea id="ob-obs" className={cls.input} rows={3} value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} maxLength={4000} />
      </Campo>
      <div className="flex gap-2">
        <Botao onClick={onFim}>Cancelar</Botao>
        <Botao primario type="submit" disabled={salvar.isPending}>{salvar.isPending ? 'Salvando…' : 'Salvar obra'}</Botao>
      </div>
    </form>
  );
}

// ─── detalhe da obra ─────────────────────────────────────────────────────

function ObraDetalhe({ uid, obra, onVoltar }: { uid: string; obra: Obra; onVoltar: () => void }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [editando, setEditando] = useState(false);
  const lanc = useQuery({ queryKey: ['obra-lanc', obra.id], queryFn: () => lancamentosDaObra(uid, obra.id) });
  const escala = useQuery({ queryKey: ['obra-escala-da', obra.id], queryFn: () => escalaDaObra(obra.id) });
  const equipe = useQuery({ queryKey: ['obra-equipe', uid], queryFn: () => listEquipe(uid) });
  const notas = useQuery({ queryKey: ['obra-notas', obra.id], queryFn: () => notasDaObra(uid, obra.id) });
  const clienteVinculado = useQuery({
    queryKey: ['obra-cliente-vinculado', obra.client_id],
    queryFn: async () => {
      if (!obra.client_id) return null;
      const { data } = await getSupabase().from('profiles_public').select('id, name, tag').eq('id', obra.client_id).maybeSingle();
      return data as { id: string; name: string | null; tag: string | null } | null;
    },
    enabled: !!obra.client_id,
  });
  const [tagCliente, setTagCliente] = useState('');
  const vincular = useMutation({
    mutationFn: () => vincularCliente(uid, obra.id, tagCliente),
    onSuccess: () => {
      setTagCliente('');
      showToast('Cliente vinculado — ele já pode acompanhar a obra no app dele', 'success');
      qc.invalidateQueries({ queryKey: ['obras', uid] });
      qc.invalidateQueries({ queryKey: ['obra-cliente-vinculado'] });
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });
  // Travas de clique duplo (ver useSingleFlight): gasto lançado em dobro no
  // Financeiro e vínculo repetido eram possíveis com dois toques rápidos.
  const vincularFlight = useSingleFlight();
  const lancarFlight = useSingleFlight();
  const desvincular = useMutation({
    mutationFn: () => vincularCliente(uid, obra.id, ''),
    onSuccess: () => {
      showToast('Vínculo removido', 'success');
      qc.invalidateQueries({ queryKey: ['obras', uid] });
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });

  const resumo = useMemo(() => {
    const diaria = new Map((equipe.data ?? []).map((m) => [m.id, m.diaria]));
    return resumoDaObra(obra.valor, lanc.data ?? [], (escala.data ?? []).map((e) => ({ diaria: diaria.get(e.equipe_id) })));
  }, [obra.valor, lanc.data, escala.data, equipe.data]);

  const [gasto, setGasto] = useState<{ categoria: CategoriaGasto; valor: string; descricao: string }>({
    categoria: 'material',
    valor: '',
    descricao: '',
  });
  const lancar = useMutation({
    mutationFn: () => lancarGastoDaObra(uid, obra, { categoria: gasto.categoria, valor: parseBRL(gasto.valor), descricao: gasto.descricao }),
    onSuccess: () => {
      setGasto((g) => ({ ...g, valor: '', descricao: '' }));
      qc.invalidateQueries({ queryKey: ['obra-lanc', obra.id] });
      qc.invalidateQueries({ queryKey: ['financeiro'] });
      showToast('Gasto lançado no Financeiro', 'success');
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });

  const [nota, setNota] = useState('');
  const anotar = useMutation({
    mutationFn: () => anotarNaObra(uid, obra.id, nota),
    onSuccess: () => {
      setNota('');
      qc.invalidateQueries({ queryKey: ['obra-notas', obra.id] });
      qc.invalidateQueries({ queryKey: ['notes', uid] });
    },
    onError: (e) => showToast((e as Error).message, 'error'),
  });

  async function apagar() {
    const ok = await dialog.confirm('Apagar esta obra? A escala dela some junto; os gastos continuam no Financeiro.', {
      title: 'Apagar obra',
      okLabel: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    try {
      await apagarObra(uid, obra.id);
      qc.invalidateQueries({ queryKey: ['obras', uid] });
      onVoltar();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  }

  if (editando) return <ObraForm uid={uid} obra={obra} onFim={() => setEditando(false)} />;

  const nomeDe = new Map((equipe.data ?? []).map((m) => [m.id, m.nome]));
  const hoje = ymdBrt(); // regra do app: "hoje" é o de Brasília
  const proximos = (escala.data ?? []).filter((e) => e.dia >= hoje).slice(0, 12);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onVoltar} aria-label="Voltar para obras" className="text-xl px-2" style={{ minHeight: 44, minWidth: 44 }}>
          ‹
        </button>
        <h3 className="font-extrabold text-xl flex-1 min-w-0" style={{ fontFamily: 'var(--font-display)' }}>{obra.nome}</h3>
        <Chip tom={obra.status}>{rotuloStatusObra(obra.status)}</Chip>
      </div>

      <section className={`${cls.card} flex flex-col gap-2 text-sm`}>
        {obra.cliente ? <div>Cliente: <b>{obra.cliente}</b></div> : null}
        {obra.endereco ? <div>📍 {obra.endereco}</div> : null}
        {obra.observacoes ? <div className="text-[color:var(--color-muted)] whitespace-pre-wrap">{obra.observacoes}</div> : null}
        <div className="flex flex-wrap gap-2 mt-1">
          {obra.endereco ? (
            <Botao onClick={() => abrirLinkExterno(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(obra.endereco || '')}`)}>
              Como chegar
            </Botao>
          ) : null}
          {obra.quote_id ? (
            <Link href={`/orcamentos/${obra.quote_id}`} className={`${cls.btn} ${cls.secundario}`} style={{ minHeight: 44 }}>
              Ver orçamento
            </Link>
          ) : null}
          <Botao onClick={() => setEditando(true)}>Editar</Botao>
        </div>
      </section>

      <section>
        <h4 className={cls.sec}>Custos da obra · vai pro Financeiro</h4>
        <div className={`${cls.card} flex flex-col gap-2 text-sm`}>
          <div className="flex justify-between"><span>Valor da obra</span><b>{brl(resumo.valor)}</b></div>
          {resumo.gastos.map((g) => (
            <div key={g.id} className="flex justify-between text-[color:var(--color-muted)]">
              <span>{g.rotulo}</span><span>− {brl(g.total)}</span>
            </div>
          ))}
          {resumo.maoDeObraEstimada > 0 ? (
            <div className="flex justify-between text-[color:var(--color-muted)]">
              <span>Mão de obra (estimada pela escala)</span><span>− {brl(resumo.maoDeObraEstimada)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-[color:var(--color-border)] pt-2 text-base">
            <b>Lucro previsto</b><b style={{ color: 'var(--color-p1-text)' }}>{brl(resumo.lucro)}</b>
          </div>
          {lanc.error ? <ErroObras erro={lanc.error} /> : null}

          <form
            className="grid grid-cols-2 gap-2 mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              lancarFlight.run(() => lancar.mutateAsync()).catch(() => {});
            }}
          >
            <Campo id="g-cat" label="Categoria">
              <select id="g-cat" className={cls.input} value={gasto.categoria} onChange={(e) => setGasto((g) => ({ ...g, categoria: e.target.value as CategoriaGasto }))}>
                {CATEGORIAS_GASTO.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
              </select>
            </Campo>
            <Campo id="g-val" label="Valor (R$)">
              <input id="g-val" inputMode="decimal" className={cls.input} value={gasto.valor} onChange={(e) => setGasto((g) => ({ ...g, valor: e.target.value }))} placeholder="0,00" />
            </Campo>
            <div className="col-span-2">
              <Campo id="g-desc" label="Descrição (opcional)">
                <input id="g-desc" className={cls.input} value={gasto.descricao} onChange={(e) => setGasto((g) => ({ ...g, descricao: e.target.value }))} maxLength={80} placeholder="Ex.: 2 latas de selador, diária do Diego, frete" />
              </Campo>
            </div>
            <div className="col-span-2">
              <Botao primario full type="submit" disabled={lancar.isPending}>{lancar.isPending ? 'Lançando…' : 'Lançar gasto'}</Botao>
            </div>
          </form>
          <p className="text-xs text-[color:var(--color-muted)]">
            Frete: use o tile Frete em Meu Negócio pra calcular, e lance aqui em &quot;Transporte / frete&quot;.
          </p>
        </div>
      </section>

      <section>
        <h4 className={cls.sec}>Cliente acompanha pelo app</h4>
        <div className={`${cls.card} flex flex-col gap-2 text-sm`}>
          {obra.client_id ? (
            <div className="flex items-center justify-between gap-2">
              <span>
                <b>{clienteVinculado.data?.name || 'Cliente vinculado'}</b>
                {clienteVinculado.data?.tag ? ` · @${clienteVinculado.data.tag}` : ''}
                {' '}vê status, equipe e agenda no app dele.
              </span>
              <Botao onClick={() => desvincular.mutate()} disabled={desvincular.isPending}>Remover</Botao>
            </div>
          ) : (
            <>
              <p className="text-[color:var(--color-muted)]">
                Dê ao cliente uma tela pra acompanhar o andamento (status, equipe escalada, agenda — nunca valor
                nem suas anotações). Ele precisa ter conta no app.
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  vincularFlight.run(() => vincular.mutateAsync()).catch(() => {});
                }}
              >
                <label htmlFor="ob-cli-tag" className="sr-only">@tag do cliente</label>
                <input
                  id="ob-cli-tag"
                  className={`${cls.input} flex-1 min-w-0`}
                  value={tagCliente}
                  onChange={(e) => setTagCliente(e.target.value)}
                  placeholder="@tag do cliente"
                  autoCapitalize="none"
                  autoComplete="off"
                />
                <Botao primario type="submit" disabled={vincular.isPending || !tagCliente.trim()}>
                  {vincular.isPending ? 'Vinculando…' : 'Vincular'}
                </Botao>
              </form>
            </>
          )}
        </div>
      </section>

      <section>
        <h4 className={cls.sec}>Próximos dias escalados</h4>
        <div className={`${cls.card} flex flex-col gap-1 text-sm`}>
          {proximos.length === 0 ? (
            <span className="text-[color:var(--color-muted)]">Ninguém escalado. Use a aba Escala.</span>
          ) : (
            proximos.map((e) => (
              <div key={e.id} className="flex justify-between gap-2">
                <span>{rotuloDia(e.dia).curto} · {nomeDe.get(e.equipe_id) ?? '—'}</span>
                <span className="text-[color:var(--color-muted)]">{e.presenca === 'confirmada' ? 'confirmou' : 'aguardando'}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h4 className={cls.sec}>Anotações da obra</h4>
        <div className={`${cls.card} flex flex-col gap-2`}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              anotar.mutate();
            }}
          >
            <label htmlFor="ob-nota" className="sr-only">Nova anotação</label>
            <input id="ob-nota" className={`${cls.input} flex-1 min-w-0`} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={4000} placeholder="Ex.: cliente pediu cor mais clara no quarto" />
            <Botao type="submit" disabled={anotar.isPending || !nota.trim()}>Salvar</Botao>
          </form>
          {(notas.data ?? []).map((n) => (
            <div key={n.id} className="text-sm border-t border-[color:var(--color-border)] pt-2 whitespace-pre-wrap">
              {n.body}
              <div className="text-xs text-[color:var(--color-muted)]">{new Date(n.created_at).toLocaleDateString('pt-BR')}</div>
            </div>
          ))}
          <p className="text-xs text-[color:var(--color-muted)]">As anotações também aparecem no tile Anotações.</p>
        </div>
      </section>

      <Botao onClick={apagar}>Apagar obra</Botao>
    </div>
  );
}
