// TabelaPrecosView — a Tabela de Preços de Pintura da ABRAPP 2026 dentro do
// app: busca, filtro por categoria e por altura, e uma calculadora de
// quantidade em cada item.
//
// Três decisões que valem registro:
//
//  1. A LINHA FECHADA MOSTRA SÓ A MÉDIA. Mostrar mínimo/média/máximo nas 328
//     linhas de uma vez enche a tela de número e some com o serviço, que é o
//     que a pessoa procura. As três faixas aparecem ao tocar — junto da
//     explicação de quando cobrar cada uma, que é o que o documento pede.
//
//  2. A CALCULADORA VIVE NO ITEM ABERTO, não no topo. Cada linha tem a SUA
//     unidade (m², metro linear, peça, diária, km): um campo global de
//     quantidade multiplicaria diária por metro quadrado sem avisar.
//
//  3. NADA É EMBUTIDO NO BUNDLE. Se a tabela não carregou, a tela diz o
//     motivo em vez de mostrar valor velho — preço errado num orçamento é
//     pior que tela vazia.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePriceTable } from '@/lib/hooks/usePriceTable';
import {
  agruparPorCategoria,
  filtrarPrecos,
  listarCategorias,
  rotuloAltura,
  semValorPublicado,
  totalPara,
  unidadeCurta,
  unidadeLonga,
  type PriceAltura,
  type PriceItem,
} from '@/lib/services/priceTable';
import {
  AVISOS_DA_FONTE,
  FONTE_CREDITO,
  GUIA_FAIXAS,
  GUIA_JEITINHO,
  GUIA_PRINCIPIO,
  GUIA_TRES_TIPOS,
  GUIA_VARIAVEIS,
  NOTAS_POR_FOLHA,
} from '@/lib/priceTableGuide';
import { fmtBRL } from '@/lib/utils';
import { copyToClipboard } from '@/lib/native/clipboard';
import { showToast } from '@/lib/toast';

type Aba = 'precos' | 'guia';

export function TabelaPrecosView() {
  const [aba, setAba] = useState<Aba>('precos');

  return (
    <div className="px-3.5 pt-4 pb-8">
      <h1
        className="font-extrabold"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          marginBottom: 4,
          color: 'var(--color-ink)',
        }}
      >
        📊 Tabela de Preços
      </h1>
      <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 14 }}>
        Sugestão de preços · 2026 · valor de <strong>mão de obra</strong>, material não incluso.
      </p>

      <div
        role="tablist"
        aria-label="Seções da tabela de preços"
        className="flex gap-1.5"
        style={{ marginBottom: 14 }}
      >
        <AbaBotao ativa={aba === 'precos'} onClick={() => setAba('precos')}>
          Preços
        </AbaBotao>
        <AbaBotao ativa={aba === 'guia'} onClick={() => setAba('guia')}>
          Como usar
        </AbaBotao>
      </div>

      {aba === 'precos' ? <ListaDePrecos /> : <GuiaDeUso />}
    </div>
  );
}

function AbaBotao({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className="rounded-full text-xs font-bold"
      style={{
        padding: '8px 16px',
        border: `1px solid ${ativa ? 'transparent' : 'var(--color-border)'}`,
        background: ativa ? 'var(--color-ink)' : 'var(--color-white)',
        color: ativa ? '#fff' : 'var(--color-ink)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const ALTURAS: ReadonlyArray<{ valor: PriceAltura | null; rotulo: string }> = [
  { valor: null, rotulo: 'Qualquer altura' },
  { valor: 'ate_3m', rotulo: 'Até 3 m' },
  { valor: 'acima_3m', rotulo: 'Acima de 3 m' },
];

function ListaDePrecos() {
  const { items, loading, error, vazio } = usePriceTable();
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [altura, setAltura] = useState<PriceAltura | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);

  // Atraso na busca: digitar filtra 328 itens a cada tecla, e no celular
  // isso trava o teclado. 250ms é o mesmo intervalo usado na loja.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const categorias = useMemo(() => listarCategorias(items), [items]);
  const filtrados = useMemo(
    () => filtrarPrecos(items, { q: buscaAtiva, category: categoria, altura }),
    [items, buscaAtiva, categoria, altura],
  );
  const grupos = useMemo(() => agruparPorCategoria(filtrados), [filtrados]);

  const temFiltro = !!buscaAtiva || !!categoria || !!altura;

  if (loading) {
    return (
      <p className="text-center text-sm py-10" style={{ color: 'var(--color-muted)' }}>
        Carregando a tabela…
      </p>
    );
  }

  if (error) {
    return (
      <Aviso tom="erro">
        Não deu para carregar a tabela agora. Verifique a conexão e tente de novo.
      </Aviso>
    );
  }

  if (vazio) {
    return (
      <Aviso tom="neutro">
        A tabela ainda não foi carregada no banco. Peça para a Cali Colors rodar a migration
        da tabela de preços que os 328 itens aparecem aqui.
      </Aviso>
    );
  }

  return (
    <>
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
          marginBottom: 10,
        }}
      />

      <div className="flex gap-1.5" style={{ marginBottom: 10 }}>
        {ALTURAS.map((a) => (
          <Chip
            key={a.rotulo}
            ativo={altura === a.valor}
            onClick={() => setAltura(a.valor)}
            titulo={a.rotulo}
          />
        ))}
      </div>

      <div
        className="flex gap-1.5"
        style={{
          marginBottom: 12,
          overflowX: 'auto',
          overscrollBehaviorX: 'contain',
          paddingBottom: 4,
        }}
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

      <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 10 }}>
        {filtrados.length === items.length
          ? `${items.length} serviços`
          : `${filtrados.length} de ${items.length} serviços`}
        {temFiltro ? (
          <>
            {' · '}
            <button
              type="button"
              onClick={() => {
                setBusca('');
                setBuscaAtiva('');
                setCategoria(null);
                setAltura(null);
              }}
              style={{
                color: 'var(--color-p1)',
                fontWeight: 700,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              limpar filtros
            </button>
          </>
        ) : null}
      </p>

      {filtrados.length === 0 ? (
        <Aviso tom="neutro">
          Nada encontrado com esses filtros. Tente uma palavra mais curta — a busca procura no
          serviço, no produto e no tipo.
        </Aviso>
      ) : (
        grupos.map((g) => (
          <section key={g.category} style={{ marginBottom: 18 }}>
            <h2
              className="font-extrabold"
              style={{
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: '.04em',
                color: 'var(--color-muted)',
                marginBottom: 8,
              }}
            >
              {g.category}
            </h2>
            <div className="flex flex-col gap-1.5">
              {g.items.map((item) => (
                <LinhaDePreco
                  key={item.id}
                  item={item}
                  aberto={abertoId === item.id}
                  onToggle={() => setAbertoId(abertoId === item.id ? null : item.id)}
                />
              ))}
            </div>
            {notaDoGrupo(g.items) ? (
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--color-muted)',
                  marginTop: 8,
                  lineHeight: 1.5,
                }}
              >
                ⚠️ {notaDoGrupo(g.items)}
              </p>
            ) : null}
          </section>
        ))
      )}

      <p
        style={{
          fontSize: 10,
          color: 'var(--color-muted)',
          lineHeight: 1.6,
          marginTop: 10,
          borderTop: '1px solid var(--color-border)',
          paddingTop: 10,
        }}
      >
        {FONTE_CREDITO}
      </p>
    </>
  );
}

/** Nota de rodapé da folha, quando o grupo exibido contém aquela folha. */
function notaDoGrupo(items: readonly PriceItem[]): string | null {
  for (const i of items) {
    const nota = NOTAS_POR_FOLHA[i.sheet_no];
    if (nota) return nota;
  }
  return null;
}

function Chip({
  ativo,
  onClick,
  titulo,
}: {
  ativo: boolean;
  onClick: () => void;
  titulo: string;
}) {
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

function Aviso({ tom, children }: { tom: 'erro' | 'neutro'; children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: 14,
        fontSize: 13,
        lineHeight: 1.6,
        background: 'var(--color-white)',
        border: `1px solid ${tom === 'erro' ? 'var(--color-danger)' : 'var(--color-border)'}`,
        color: tom === 'erro' ? 'var(--color-danger)' : 'var(--color-muted)',
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function LinhaDePreco({
  item,
  aberto,
  onToggle,
}: {
  item: PriceItem;
  aberto: boolean;
  onToggle: () => void;
}) {
  const semValor = semValorPublicado(item);
  const subtitulo = [item.grupo, item.tipo].filter(Boolean).join(' · ');
  const alturaTxt = rotuloAltura(item.altura);

  return (
    <div
      style={{
        background: 'var(--color-white)',
        border: '1px solid var(--color-border)',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        className="w-full text-left flex items-center gap-3"
        style={{
          padding: '11px 13px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            className="block font-bold"
            style={{
              fontSize: 13,
              lineHeight: 1.35,
              color: 'var(--color-ink)',
              overflowWrap: 'anywhere',
            }}
          >
            {item.servico}
          </span>
          {subtitulo || alturaTxt ? (
            <span
              className="block"
              style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}
            >
              {subtitulo}
              {subtitulo && alturaTxt ? ' · ' : ''}
              {alturaTxt}
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
                style={{ fontSize: 15, color: 'var(--color-ink)', whiteSpace: 'nowrap' }}
              >
                R$ {fmtBRL(item.preco_medio)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>
                /{unidadeCurta(item.unidade)}
              </span>
            </>
          )}
        </span>
      </button>

      {aberto ? <DetalheDoItem item={item} /> : null}
    </div>
  );
}

function DetalheDoItem({ item }: { item: PriceItem }) {
  const [qtd, setQtd] = useState('1');
  const quantidade = Number(qtd.replace(',', '.'));
  const semValor = semValorPublicado(item);
  const copiouRef = useRef(false);

  async function copiar() {
    if (copiouRef.current) return;
    copiouRef.current = true;
    const linhas = [
      item.servico,
      `Média: R$ ${fmtBRL(item.preco_medio)} ${unidadeLonga(item.unidade)}`,
      item.preco_min !== null && item.preco_max !== null
        ? `Faixa: R$ ${fmtBRL(item.preco_min)} a R$ ${fmtBRL(item.preco_max)}`
        : null,
      'Fonte: Tabela de Preços 2026 (mão de obra, material não incluso)',
    ].filter(Boolean);
    const ok = await copyToClipboard(linhas.join('\n'));
    showToast(ok ? 'Copiado' : 'Não deu para copiar', ok ? 'success' : 'error');
    copiouRef.current = false;
  }

  if (semValor) {
    return (
      <div
        style={{
          padding: '0 13px 13px',
          fontSize: 12,
          color: 'var(--color-muted)',
          lineHeight: 1.6,
        }}
      >
        Este item aparece zerado no documento de referência — não há valor publicado para ele.
        Trate como orçamento sob medida.
      </div>
    );
  }

  return (
    <div style={{ padding: '0 13px 13px' }}>
      <div className="grid grid-cols-3 gap-1.5" style={{ marginBottom: 10 }}>
        <Faixa rotulo="Mínimo" valor={item.preco_min} quantidade={quantidade} />
        <Faixa rotulo="Média" valor={item.preco_medio} quantidade={quantidade} destaque />
        <Faixa rotulo="Máximo" valor={item.preco_max} quantidade={quantidade} />
      </div>

      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        <label
          htmlFor={`qtd-${item.id}`}
          style={{ fontSize: 12, color: 'var(--color-muted)', flexShrink: 0 }}
        >
          Quantidade
        </label>
        <input
          id={`qtd-${item.id}`}
          type="text"
          inputMode="decimal"
          value={qtd}
          onChange={(e) => setQtd(e.target.value)}
          className="rounded-lg"
          style={{
            width: 92,
            padding: '7px 10px',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-ink)',
            fontSize: 16,
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
          {unidadeLonga(item.unidade).replace(/^por /, '')}
        </span>
      </div>

      {item.observacao ? (
        <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 8 }}>
          Observação do documento: {item.observacao}
        </p>
      ) : null}

      <button
        type="button"
        onClick={copiar}
        className="rounded-full text-xs font-bold"
        style={{
          padding: '8px 14px',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-ink)',
          cursor: 'pointer',
        }}
      >
        Copiar para o orçamento
      </button>
    </div>
  );
}

function Faixa({
  rotulo,
  valor,
  quantidade,
  destaque,
}: {
  rotulo: string;
  valor: number | null;
  quantidade: number;
  destaque?: boolean;
}) {
  const total = totalPara(valor, quantidade);
  const multiplicando = Number.isFinite(quantidade) && quantidade > 0 && quantidade !== 1;
  return (
    <div
      style={{
        borderRadius: 10,
        padding: '8px 6px',
        textAlign: 'center',
        background: destaque ? 'var(--color-ink)' : 'var(--color-bg)',
        border: destaque ? 'none' : '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          color: destaque ? 'rgba(255,255,255,.65)' : 'var(--color-muted)',
        }}
      >
        {rotulo}
      </div>
      <div
        className="font-extrabold"
        style={{
          fontSize: 13,
          marginTop: 2,
          color: destaque ? '#fff' : 'var(--color-ink)',
          whiteSpace: 'nowrap',
        }}
      >
        {total === null ? '—' : `R$ ${fmtBRL(total)}`}
      </div>
      {multiplicando && total !== null ? (
        <div
          style={{
            fontSize: 9,
            marginTop: 1,
            color: destaque ? 'rgba(255,255,255,.6)' : 'var(--color-muted)',
          }}
        >
          total
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function GuiaDeUso() {
  return (
    <div className="flex flex-col gap-4">
      <Cartao>
        <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--color-ink)' }}>
          {GUIA_PRINCIPIO}
        </p>
      </Cartao>

      <section>
        <TituloSecao>Qual faixa cobrar</TituloSecao>
        <div className="flex flex-col gap-1.5">
          {GUIA_FAIXAS.map((f) => (
            <Cartao key={f.faixa}>
              <div
                className="font-extrabold"
                style={{ fontSize: 12, color: 'var(--color-p1)', marginBottom: 3 }}
              >
                {f.faixa}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-ink)' }}>
                {f.quando}
              </div>
            </Cartao>
          ))}
        </div>
      </section>

      <section>
        <TituloSecao>As 13 variáveis que definem o seu preço</TituloSecao>
        <div className="flex flex-col gap-1.5">
          {GUIA_VARIAVEIS.map((v) => (
            <Cartao key={v.n}>
              <div
                className="font-extrabold"
                style={{ fontSize: 12, color: 'var(--color-ink)', marginBottom: 3 }}
              >
                {v.n}. {v.titulo}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-muted)' }}>
                {v.texto}
              </div>
            </Cartao>
          ))}
        </div>
      </section>

      <section>
        <TituloSecao>Tabela do jeitinho</TituloSecao>
        <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 8 }}>
          Quanto acrescentar quando o cliente pede aquele favorzinho que ninguém orçou.
        </p>
        <Cartao>
          {GUIA_JEITINHO.map((j, i) => (
            <div
              key={j.frase}
              className="flex items-center justify-between gap-3"
              style={{
                padding: '7px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--color-ink)' }}>“{j.frase}”</span>
              <span
                className="font-extrabold"
                style={{ fontSize: 12, color: 'var(--color-p1)', flexShrink: 0 }}
              >
                +{j.acrescimo}%
              </span>
            </div>
          ))}
        </Cartao>
        <p
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--color-muted)',
            marginTop: 8,
          }}
        >
          {GUIA_TRES_TIPOS}
        </p>
      </section>

      <section>
        <TituloSecao>Sobre esta cópia</TituloSecao>
        <ul className="flex flex-col gap-1.5">
          {AVISOS_DA_FONTE.map((a) => (
            <li
              key={a}
              style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--color-muted)' }}
            >
              • {a}
            </li>
          ))}
        </ul>
        <p
          style={{
            fontSize: 10,
            color: 'var(--color-muted)',
            lineHeight: 1.6,
            marginTop: 10,
            borderTop: '1px solid var(--color-border)',
            paddingTop: 10,
          }}
        >
          {FONTE_CREDITO}
        </p>
      </section>
    </div>
  );
}

function TituloSecao({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="font-extrabold"
      style={{
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: '.04em',
        color: 'var(--color-muted)',
        marginBottom: 8,
      }}
    >
      {children}
    </h2>
  );
}

function Cartao({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--color-white)',
        border: '1px solid var(--color-border)',
        borderRadius: 14,
        padding: 13,
      }}
    >
      {children}
    </div>
  );
}
