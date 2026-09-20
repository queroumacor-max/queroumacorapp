'use client';
// ServicosDoOrcamento — a seção "Serviços" do tile Orçamento (Crie e envie).
//
// A seção começa VAZIA: o bloco de serviço nasce quando a pessoa escolhe um
// item na Tabela de Preços (ou cria um avulso) — não há "Serviço 1" pré-montado
// pra preencher, e o bloco mostra SÓ O ITEM: espaço e material ficam atrás de
// "Detalhes", fechados e sem nenhum valor pré-escolhido (decisões do usuário,
// 2026-09-07, 3ª e 4ª rodadas).
//
// Um orçamento tem VÁRIOS serviços (sala + fachada, por exemplo). Cada bloco
// carrega o próprio espaço (tipo, área, pé direito, cômodos, superfície,
// acesso), o próprio material (tinta, cor, demãos, preparação) e os próprios
// ITENS: linhas escolhidas na Tabela de Preços da ABRAPP (o mesmo catálogo do
// tile "Tabela de Preços") ou avulsas, com quantidade e VALOR — que nasce
// vazio, com a sugestão da tabela do lado (mín/média/máx).
//
// Por que o seletor é um modal em portal e não uma lista inline: o wizard já
// abre dentro de um BottomSheet (z-[1000]); uma lista de 328 itens dentro
// dele viraria rolagem dentro de rolagem, e o iOS prende o gesto a um
// scroller só. O modal precisa de z-index ACIMA de 1000 (lição do leitor do
// Click Rua: overlay aberto de dentro de um sheet abaixo disso fica atrás).

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePriceTable } from '@/lib/hooks/usePriceTable';
import {
  filtrarPrecos,
  listarCategorias,
  rotuloAltura,
  semValorPublicado,
  unidadeCurta,
  type PriceAltura,
  type PriceItem,
} from '@/lib/services/priceTable';
import {
  ESTADOS_DA_SUPERFICIE,
  OPCOES_DE_ACESSO,
  OPCOES_DE_PREPARACAO,
  TIPOS_DE_SERVICO,
  TIPOS_DE_TINTA,
  alturaDoAcesso,
  detalhesDoServico,
  itemAvulso,
  itemDaTabela,
  resumoDoServico,
  servicoComItem,
  subtotalDoItem,
  subtotalSugerido,
  totaisDosItens,
  type ItemDoOrcamento,
  type ServicoDoOrcamento,
} from '@/lib/orcamentoServicos';
import { fmtBRL } from '@/lib/utils';

export interface ServicosDoOrcamentoProps {
  servicos: ServicoDoOrcamento[];
  onChange: (next: ServicoDoOrcamento[]) => void;
}

export function ServicosDoOrcamento({ servicos, onChange }: ServicosDoOrcamentoProps) {
  const [seletorAberto, setSeletorAberto] = useState(false);
  const ultimo = servicos[servicos.length - 1] ?? null;

  function atualizar(id: string, patch: Partial<ServicoDoOrcamento>) {
    onChange(servicos.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function remover(id: string) {
    onChange(servicos.filter((s) => s.id !== id));
  }
  // O serviço NASCE do item: escolher uma linha da tabela (ou um avulso) cria
  // o bloco em volta dela. Não existe bloco vazio pré-montado — a seção começa
  // limpa e cresce conforme a obra.
  function novoServicoDaTabela(item: PriceItem) {
    onChange([...servicos, servicoComItem(itemDaTabela(item), ultimo)]);
    setSeletorAberto(false);
  }
  function novoServicoAvulso() {
    onChange([...servicos, servicoComItem(itemAvulso(), ultimo)]);
  }

  return (
    <div className="space-y-3">
      {servicos.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6 }}>
          Escolha um serviço na Tabela de Preços pra começar. O valor fica em branco pra
          você decidir, com a sugestão da Tabela de Preços (mão de obra) do lado. Área, tinta e
          preparação são opcionais, em “Detalhes”.
        </p>
      ) : null}

      {servicos.map((s, idx) => (
        <BlocoDeServico
          key={s.id}
          servico={s}
          indice={idx}
          onChange={(patch) => atualizar(s.id, patch)}
          onRemove={() => remover(s.id)}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSeletorAberto(true)}
          className="font-bold text-sm"
          style={{
            flex: '1 1 auto',
            padding: '11px 12px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--color-p1)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          📊 {servicos.length === 0 ? 'Adicionar da Tabela de Preços' : 'Outro serviço da tabela'}
        </button>
        <button
          type="button"
          onClick={novoServicoAvulso}
          className="font-bold text-sm"
          style={{
            padding: '11px 12px',
            borderRadius: 12,
            border: '1.5px solid var(--color-border)',
            background: 'var(--color-white)',
            color: 'var(--color-ink)',
            cursor: 'pointer',
          }}
        >
          + Avulso
        </button>
      </div>

      {seletorAberto ? (
        <SeletorDeItens
          onClose={() => setSeletorAberto(false)}
          onEscolher={novoServicoDaTabela}
          alturaInicial={alturaDoAcesso(ultimo?.acesso)}
        />
      ) : null}
    </div>
  );
}

// ─── Bloco de serviço (espaço + material + itens) ─────────────────────────

function BlocoDeServico({
  servico: s,
  indice,
  onChange,
  onRemove,
}: {
  servico: ServicoDoOrcamento;
  indice: number;
  onChange: (patch: Partial<ServicoDoOrcamento>) => void;
  onRemove: () => void;
}) {
  const totais = useMemo(() => totaisDosItens(s.itens), [s.itens]);
  // Espaço/material começam FECHADOS: quem adicionou um item da tabela quer
  // ver o item, não dez campos. Abre se já tem algo preenchido (edição).
  const temDetalhe = detalhesDoServico(s).length > 0 || !!s.tipo;
  const [detalhesAbertos, setDetalhesAbertos] = useState(temDetalhe);

  function togglePrep(item: string) {
    onChange({
      preparacao: s.preparacao.includes(item)
        ? s.preparacao.filter((p) => p !== item)
        : [...s.preparacao, item],
    });
  }

  return (
    <section
      aria-label={`Serviço ${indice + 1}`}
      style={{
        border: '1.5px solid var(--color-border)',
        borderRadius: 14,
        padding: 12,
        background: 'var(--color-cream)',
      }}
    >
      <header className="flex items-start justify-between gap-2" style={{ marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div
            className="font-extrabold"
            style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-p1)' }}
          >
            Serviço {indice + 1}
          </div>
          <div className="font-bold" style={{ fontSize: 13, color: 'var(--color-ink)', overflowWrap: 'anywhere' }}>
            {resumoDoServico(s)}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover serviço ${indice + 1}`}
          className="text-xs font-bold"
          style={{
            flexShrink: 0,
            padding: '5px 10px',
            borderRadius: 999,
            border: '1px solid var(--color-border)',
            background: 'var(--color-white)',
            color: 'var(--color-ink)',
            cursor: 'pointer',
          }}
        >
          ✕ Remover
        </button>
      </header>

      {/* Itens da Tabela ABRAPP — o que a pessoa pediu ver */}
      <ItensDoServico
        itens={s.itens}
        onChange={(itens) => onChange({ itens })}
        acesso={s.acesso}
      />
      {s.itens.length > 0 ? (
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            marginTop: 10,
            paddingTop: 8,
            fontSize: 12,
            color: 'var(--color-muted)',
            lineHeight: 1.7,
          }}
        >
          <div className="flex justify-between gap-3">
            <span>Subtotal do serviço {indice + 1}</span>
            <strong style={{ color: 'var(--color-ink)' }}>
              {totais.preenchido > 0 ? `R$ ${fmtBRL(totais.preenchido)}` : '—'}
            </strong>
          </div>
          {totais.semValor > 0 && totais.sugerido > 0 ? (
            <div className="flex justify-between gap-3">
              <span>
                Com a sugestão da tabela {totais.semValor === 1 ? 'no que falta' : `nos ${totais.semValor} que faltam`}
              </span>
              <span style={{ whiteSpace: 'nowrap' }}>R$ {fmtBRL(totais.sugerido)}</span>
            </div>
          ) : null}
          {totais.semSugestao > 0 ? (
            <div style={{ fontSize: 11 }}>
              {totais.semSugestao === 1
                ? '1 item sem valor e sem sugestão na tabela.'
                : `${totais.semSugestao} itens sem valor e sem sugestão na tabela.`}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Espaço + material — opcionais, fechados por padrão */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-border)' }}>
        <button
          type="button"
          onClick={() => setDetalhesAbertos((v) => !v)}
          aria-expanded={detalhesAbertos}
          className="w-full text-left text-xs font-bold"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--color-p1)',
            cursor: 'pointer',
          }}
        >
          {detalhesAbertos ? '▾' : '▸'} Detalhes do serviço (tipo, área, tinta, preparação…)
          {!detalhesAbertos ? (
            <span style={{ color: 'var(--color-muted)', fontWeight: 500 }}> · opcional</span>
          ) : null}
        </button>

        {detalhesAbertos ? (
          <div className="space-y-2.5" style={{ marginTop: 10 }}>
            <Campo label="Tipo de serviço">
              <select value={s.tipo} onChange={(e) => onChange({ tipo: e.target.value })} className={inputCls}>
                <option value="">Selecione…</option>
                {TIPOS_DE_SERVICO.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </Campo>

            <div className="grid grid-cols-3 gap-2">
              <Campo label="Área (m²)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={s.areaM2}
                  onChange={(e) => onChange({ areaM2: e.target.value })}
                  placeholder="ex: 80"
                  className={inputCls}
                />
              </Campo>
              <Campo label="Pé direito (m)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={s.peDireito}
                  onChange={(e) => onChange({ peDireito: e.target.value })}
                  placeholder="ex: 2.8"
                  className={inputCls}
                />
              </Campo>
              <Campo label="Cômodos">
                <input
                  type="text"
                  inputMode="numeric"
                  value={s.comodos}
                  onChange={(e) => onChange({ comodos: e.target.value })}
                  placeholder="ex: 3"
                  className={inputCls}
                />
              </Campo>
            </div>

            <Campo label="Onde (sai no PDF como “parte Interna/Externa da casa”)">
              <select value={s.local ?? ''} onChange={(e) => onChange({ local: e.target.value })} className={inputCls}>
                <option value="">Não informar</option>
                <option value="interna">Parte interna da casa</option>
                <option value="externa">Parte externa da casa</option>
              </select>
            </Campo>

            <Campo label="Estado da superfície">
              <select value={s.superficie} onChange={(e) => onChange({ superficie: e.target.value })} className={inputCls}>
                <option value="">Selecione…</option>
                {ESTADOS_DA_SUPERFICIE.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </Campo>

            <Campo label="Acesso">
              <select value={s.acesso} onChange={(e) => onChange({ acesso: e.target.value })} className={inputCls}>
                <option value="">Selecione…</option>
                {OPCOES_DE_ACESSO.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </Campo>

            <Campo label="Tipo de tinta">
              <select value={s.tinta} onChange={(e) => onChange({ tinta: e.target.value })} className={inputCls}>
                <option value="">Selecione…</option>
                {TIPOS_DE_TINTA.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </Campo>

            <Campo label="Cor desejada">
              <input
                type="text"
                value={s.cor}
                onChange={(e) => onChange({ cor: e.target.value })}
                placeholder="ex: branco gelo, areia, ref. Suvinil A123"
                className={inputCls}
              />
            </Campo>

            <Campo label="Nº de demãos">
              <div className="flex gap-2">
                {(['1', '2', '3'] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange({ demaos: s.demaos === n ? '' : n })}
                    aria-pressed={s.demaos === n}
                    className="flex-1 font-bold"
                    style={{
                      padding: '8px 0',
                      borderRadius: 10,
                      fontSize: 13,
                      border: '1.5px solid ' + (s.demaos === n ? 'var(--color-p1)' : 'var(--color-border)'),
                      background: s.demaos === n ? 'var(--color-p1)' : 'var(--color-white)',
                      color: s.demaos === n ? '#fff' : 'var(--color-ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {n} demão{n !== '1' ? 's' : ''}
                  </button>
                ))}
              </div>
            </Campo>

            <Campo label="Preparação (marque o que precisa)">
              <div className="flex flex-wrap gap-2">
                {OPCOES_DE_PREPARACAO.map((opt) => {
                  const on = s.preparacao.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => togglePrep(opt)}
                      className="font-semibold text-xs"
                      style={{
                        padding: '6px 11px',
                        borderRadius: 999,
                        border: '1.5px solid ' + (on ? 'var(--color-p1)' : 'var(--color-border)'),
                        background: on ? 'rgba(255,107,53,.12)' : 'var(--color-white)',
                        color: on ? 'var(--color-p1)' : 'var(--color-ink)',
                        cursor: 'pointer',
                      }}
                    >
                      {on ? '✓ ' : ''}{opt}
                    </button>
                  );
                })}
              </div>
            </Campo>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ─── Itens de um serviço ──────────────────────────────────────────────────

function ItensDoServico({
  itens,
  onChange,
  acesso,
}: {
  itens: ItemDoOrcamento[];
  onChange: (next: ItemDoOrcamento[]) => void;
  /** campo "Acesso" do serviço — só pra pré-selecionar o filtro de altura */
  acesso: string;
}) {
  const [seletorAberto, setSeletorAberto] = useState(false);

  function atualizar(id: string, patch: Partial<ItemDoOrcamento>) {
    onChange(itens.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function remover(id: string) {
    onChange(itens.filter((s) => s.id !== id));
  }
  function adicionarDaTabela(item: PriceItem) {
    onChange([...itens, itemDaTabela(item)]);
    setSeletorAberto(false);
  }
  function adicionarAvulso() {
    onChange([...itens, itemAvulso()]);
  }

  return (
    <div className="space-y-2">
      {itens.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6 }}>
          Este serviço ficou sem item. Adicione um da tabela ou remova o serviço.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Itens do serviço">
          {itens.map((s) => (
            <LinhaDeItem
              key={s.id}
              item={s}
              onChange={(patch) => atualizar(s.id, patch)}
              onRemove={() => remover(s.id)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSeletorAberto(true)}
          className="font-bold text-sm"
          style={{
            flex: '1 1 auto',
            padding: '10px 12px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--color-p1)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          📊 Adicionar da Tabela de Preços
        </button>
        <button
          type="button"
          onClick={adicionarAvulso}
          className="font-bold text-sm"
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            border: '1.5px solid var(--color-border)',
            background: 'var(--color-white)',
            color: 'var(--color-ink)',
            cursor: 'pointer',
          }}
        >
          + Avulso
        </button>
      </div>

      {seletorAberto ? (
        <SeletorDeItens
          onClose={() => setSeletorAberto(false)}
          onEscolher={adicionarDaTabela}
          alturaInicial={alturaDoAcesso(acesso)}
        />
      ) : null}
    </div>
  );
}

// ─── Linha de item ────────────────────────────────────────────────────────

function LinhaDeItem({
  item: s,
  onChange,
  onRemove,
}: {
  item: ItemDoOrcamento;
  onChange: (patch: Partial<ItemDoOrcamento>) => void;
  onRemove: () => void;
}) {
  const sub = subtotalDoItem(s);
  const sugerido = subtotalSugerido(s);
  const unid = unidadeCurta(s.unidade);
  const avulso = s.priceItemId === null;
  const sug = s.sugestao;

  return (
    <li
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 14,
        padding: '10px 12px',
        background: 'var(--color-white)',
      }}
    >
      <div className="flex items-start gap-2">
        <div style={{ flex: 1, minWidth: 0 }}>
          {avulso ? (
            <input
              type="text"
              value={s.servico}
              onChange={(e) => onChange({ servico: e.target.value })}
              placeholder="Nome do item (ex: grafite no muro)"
              aria-label="Nome do item avulso"
              className={inputCls}
            />
          ) : (
            <>
              <div
                className="font-bold"
                style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--color-ink)', overflowWrap: 'anywhere' }}
              >
                {s.servico}
              </div>
              {s.detalhe ? (
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{s.detalhe}</div>
              ) : null}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover ${s.servico || 'item'}`}
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 999,
            border: 'none',
            background: 'var(--color-cream)',
            color: 'var(--color-ink)',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>

      <div className="flex items-end gap-2" style={{ marginTop: 8 }}>
        <label style={{ width: 96, flexShrink: 0 }}>
          <span className={rotuloCls}>Qtd ({unid})</span>
          <input
            type="text"
            inputMode="decimal"
            value={s.quantidade}
            onChange={(e) => onChange({ quantidade: e.target.value })}
            className={inputCls}
          />
        </label>
        <label style={{ flex: 1, minWidth: 0 }}>
          <span className={rotuloCls}>Valor por {unid} (R$)</span>
          <input
            type="text"
            inputMode="decimal"
            value={s.valorUnitario}
            onChange={(e) => onChange({ valorUnitario: e.target.value })}
            placeholder={sug ? `sugestão: ${fmtBRL(sug.medio)}` : 'ex: 25,00'}
            className={inputCls}
          />
        </label>
      </div>

      {sug ? (
        <div
          className="flex items-center justify-between gap-2"
          style={{ marginTop: 6, fontSize: 11, color: 'var(--color-muted)', lineHeight: 1.5 }}
        >
          <span style={{ minWidth: 0 }}>
            Tabela de Preços: <b style={{ color: 'var(--color-ink)' }}>R$ {fmtBRL(sug.medio)}</b>/{unid}
            {sug.min !== null && sug.max !== null ? (
              <> · faixa R$ {fmtBRL(sug.min)} a R$ {fmtBRL(sug.max)}</>
            ) : null}
          </span>
          {!s.valorUnitario ? (
            <button
              type="button"
              onClick={() => onChange({ valorUnitario: fmtBRL(sug.medio) })}
              className="font-bold"
              style={{
                flexShrink: 0,
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid var(--color-p1)',
                background: 'transparent',
                color: 'var(--color-p1)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Usar média
            </button>
          ) : null}
        </div>
      ) : null}

      <label style={{ display: 'block', marginTop: 8 }}>
        <span className={rotuloCls}>Descrição no PDF (opcional)</span>
        <textarea
          value={s.descricao ?? ''}
          onChange={(e) => onChange({ descricao: e.target.value })}
          placeholder="ex: Empapelamento e proteção do piso, portas e janelas…"
          rows={2}
          className={inputCls}
        />
      </label>

      <div
        className="flex justify-between gap-2"
        style={{ marginTop: 6, fontSize: 12, color: 'var(--color-muted)' }}
      >
        <span>Subtotal</span>
        {sub !== null ? (
          <strong style={{ color: 'var(--color-ink)' }}>R$ {fmtBRL(sub)}</strong>
        ) : sugerido !== null ? (
          <span>
            a definir <span style={{ opacity: 0.8 }}>(sugerido R$ {fmtBRL(sugerido)})</span>
          </span>
        ) : (
          <span>a definir</span>
        )}
      </div>
    </li>
  );
}

// ─── Seletor (modal) ──────────────────────────────────────────────────────

const ALTURAS: ReadonlyArray<{ valor: PriceAltura | null; rotulo: string }> = [
  { valor: null, rotulo: 'Qualquer altura' },
  { valor: 'ate_3m', rotulo: 'Até 3 m' },
  { valor: 'acima_3m', rotulo: 'Acima de 3 m' },
];

function SeletorDeItens({
  onClose,
  onEscolher,
  alturaInicial,
}: {
  onClose: () => void;
  onEscolher: (item: PriceItem) => void;
  alturaInicial: PriceAltura | null;
}) {
  const { items, loading, error, vazio } = usePriceTable();
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [altura, setAltura] = useState<PriceAltura | null>(alturaInicial);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const categorias = useMemo(() => listarCategorias(items), [items]);
  const filtrados = useMemo(
    () => filtrarPrecos(items, { q: buscaAtiva, category: categoria, altura }),
    [items, buscaAtiva, categoria, altura],
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escolher item da Tabela de Preços"
      className="fixed inset-0 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,.55)', zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full"
        style={{
          maxWidth: 560,
          maxHeight: '88dvh',
          background: 'var(--color-bg)',
          borderRadius: '18px 18px 0 0',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <header
          className="flex items-center justify-between"
          style={{ padding: '14px 16px 8px', flexShrink: 0 }}
        >
          <div>
            <h3
              className="font-extrabold"
              style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--color-ink)' }}
            >
              📊 Tabela de Preços
            </h3>
            <p style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              2026 · mão de obra · toque pra adicionar
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: 'none',
              background: 'var(--color-white)',
              color: 'var(--color-ink)',
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </header>

        <div style={{ padding: '0 16px', flexShrink: 0 }}>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar serviço, tinta, textura…"
            aria-label="Buscar na tabela de preços"
            className="w-full rounded-xl"
            style={{
              padding: '11px 14px',
              border: '1px solid var(--color-border)',
              background: 'var(--color-white)',
              color: 'var(--color-ink)',
              fontSize: 16, // 16px trava o zoom automático do iOS no foco
              marginBottom: 8,
            }}
          />
          <div className="flex gap-1.5" style={{ marginBottom: 8 }}>
            {ALTURAS.map((a) => (
              <Chip key={a.rotulo} ativo={altura === a.valor} onClick={() => setAltura(a.valor)} titulo={a.rotulo} />
            ))}
          </div>
          <div
            className="flex gap-1.5"
            style={{ marginBottom: 8, overflowX: 'auto', overscrollBehaviorX: 'contain', paddingBottom: 4 }}
          >
            <Chip ativo={categoria === null} onClick={() => setCategoria(null)} titulo="Todas" />
            {categorias.map((c) => (
              <Chip
                key={c}
                ativo={categoria === c}
                onClick={() => setCategoria(categoria === c ? null : c)}
                titulo={c}
              />
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px 16px' }}>
          {loading ? (
            <p className="text-center text-sm py-8" style={{ color: 'var(--color-muted)' }}>
              Carregando a tabela…
            </p>
          ) : error ? (
            <Aviso>Não deu para carregar a tabela agora. Verifique a conexão e tente de novo.</Aviso>
          ) : vazio ? (
            <Aviso>A tabela ainda não foi carregada no banco. Use um item avulso por enquanto.</Aviso>
          ) : filtrados.length === 0 ? (
            <Aviso>Nada encontrado com esses filtros. Tente uma palavra mais curta.</Aviso>
          ) : (
            <>
              <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 8 }}>
                {filtrados.length === items.length
                  ? `${items.length} serviços`
                  : `${filtrados.length} de ${items.length} serviços`}
              </p>
              <ul className="flex flex-col gap-1.5">
                {filtrados.map((item) => (
                  <ItemDaTabela key={item.id} item={item} onClick={() => onEscolher(item)} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ItemDaTabela({ item, onClick }: { item: PriceItem; onClick: () => void }) {
  const semValor = semValorPublicado(item);
  const subtitulo = [item.grupo, item.tipo, rotuloAltura(item.altura)].filter(Boolean).join(' · ');
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left flex items-center gap-3"
        style={{
          padding: '10px 12px',
          background: 'var(--color-white)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            className="block font-bold"
            style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--color-ink)', overflowWrap: 'anywhere' }}
          >
            {item.servico}
          </span>
          {subtitulo ? (
            <span className="block" style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
              {subtitulo}
            </span>
          ) : null}
        </span>
        <span style={{ textAlign: 'right', flexShrink: 0 }}>
          {semValor ? (
            <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>sem valor</span>
          ) : (
            <>
              <span
                className="block font-extrabold"
                style={{ fontSize: 14, color: 'var(--color-ink)', whiteSpace: 'nowrap' }}
              >
                R$ {fmtBRL(item.preco_medio)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>/{unidadeCurta(item.unidade)}</span>
            </>
          )}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--color-p1)', fontWeight: 800, flexShrink: 0 }}>
          +
        </span>
      </button>
    </li>
  );
}

// ─── Átomos ───────────────────────────────────────────────────────────────

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={rotuloCls}>{label}</label>
      {children}
    </div>
  );
}

function Chip({ ativo, onClick, titulo }: { ativo: boolean; onClick: () => void; titulo: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className="rounded-full text-xs whitespace-nowrap"
      style={{
        padding: '6px 12px',
        border: `1px solid ${ativo ? 'transparent' : 'var(--color-border)'}`,
        background: ativo ? 'var(--color-p1)' : 'var(--color-white)',
        color: ativo ? '#fff' : 'var(--color-ink)',
        fontWeight: ativo ? 700 : 500,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {titulo}
    </button>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: 14,
        fontSize: 13,
        lineHeight: 1.6,
        background: 'var(--color-white)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-muted)',
      }}
    >
      {children}
    </div>
  );
}

const rotuloCls = 'block text-[10px] font-bold text-[color:var(--color-muted)] uppercase mb-1';
const inputCls =
  'w-full px-3 py-2 border border-[color:var(--color-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)] bg-white';
