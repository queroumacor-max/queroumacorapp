'use client';
// OrcamentoDocumento — a prévia HTML do orçamento no MESMO layout do PDF
// (referência LP Decor, 2026-09-08). Recebe o modelo pronto de
// `montarDocumento`; não faz conta nenhuma — a conta é uma só, no modelo,
// pra prévia e arquivo nunca discordarem.
//
// Usado pelo QuotePreviewModal do wizard e pelo QuotePdfSheet do pipeline.
// Estilos inline e cores fixas de propósito: isso vira papel (print e PDF),
// não segue o tema claro/escuro do app.

import type { CSSProperties } from 'react';
import type { DocumentoOrcamento } from '@/lib/orcamentoDocumento';
import { fmtQuantidade, fmtValor } from '@/lib/orcamentoDocumento';
import { fmtBRL } from '@/lib/utils';

const PRETO = '#111';
const CINZA = '#cfcfcf';
const CINZA_CLARO = '#e6e6e6';
const TEXTO = '#1a1a1a';
const MUDO = '#555';

const h3: CSSProperties = { fontSize: 15, fontWeight: 800, color: TEXTO, margin: '0 0 6px' };
const p: CSSProperties = { fontSize: 12.5, color: TEXTO, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' };
const divisor: CSSProperties = { border: 0, borderTop: `1px solid ${CINZA_CLARO}`, margin: '14px 0' };

export function OrcamentoDocumento({ doc }: { doc: DocumentoOrcamento }) {
  const pr = doc.profissional;
  const linhasProf = [
    pr.cnpj ? `CNPJ: ${pr.cnpj}` : '',
    pr.cpf ? `CPF: ${pr.cpf}` : '',
    pr.endereco,
    pr.telefone,
    pr.email,
  ].filter(Boolean);

  return (
    <div className="od" style={{ color: TEXTO, fontFamily: 'DM Sans, system-ui, sans-serif', fontSize: 12.5, lineHeight: 1.45 }}>
      {/* A tabela de serviços tem 4 colunas na folha; num celular de 360px
          isso vira uma palavra por linha. Abaixo de 560px o item ocupa a
          largura toda e os três valores descem pra uma linha só. No print
          (A4) e no desktop fica como na referência. */}
      <style>{`
        .od-row { display: grid; grid-template-columns: minmax(0, 1fr) 84px 84px 96px; gap: 8px; align-items: center; }
        .od-cols { display: contents; }
        @media (max-width: 560px) {
          .od-row { grid-template-columns: minmax(0, 1fr); }
          .od-cols { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; }
          .od-head .od-cols { display: none; }
          .od-head { padding-top: 8px !important; padding-bottom: 8px !important; }
        }
        @media print {
          .od-row { grid-template-columns: minmax(0, 1fr) 84px 84px 96px; }
          .od-cols { display: contents; }
          .od-head .od-cols { display: contents; }
        }
      `}</style>
      {/* ── Cabeçalho do profissional ── */}
      <header style={{ display: 'flex', gap: 14, alignItems: 'flex-start', paddingBottom: 14, borderBottom: `4px solid ${CINZA_CLARO}` }}>
        {pr.logo ? (
          <img src={pr.logo} alt="" style={{ width: 84, height: 84, objectFit: 'contain', flexShrink: 0 }} />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15 }}>{pr.nome}</div>
            <div style={{ background: CINZA, borderRadius: 6, padding: '7px 18px', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
              Orçamento nº {doc.numero}
            </div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{pr.rotulo}</div>
          {linhasProf.map((l) => (
            <div key={l} style={{ fontSize: 12.5, marginTop: 3 }}>{l}</div>
          ))}
        </div>
      </header>

      {/* ── Cliente ── */}
      <section style={{ marginTop: 16 }}>
        <div style={h3}>Cliente</div>
        {doc.cliente.nome ? <div style={{ fontWeight: 700, fontSize: 13 }}>{doc.cliente.nome}</div> : null}
        {doc.cliente.telefone ? <div style={{ marginTop: 3 }}>{doc.cliente.telefone}</div> : null}
        {doc.cliente.enderecoLinha || doc.cliente.cep ? (
          <div style={{ display: 'flex', gap: 16, marginTop: 3, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 55%' }}>{doc.cliente.enderecoLinha}</div>
            {doc.cliente.cep ? <div style={{ flex: '1 1 30%' }}>CEP: {doc.cliente.cep}</div> : null}
          </div>
        ) : null}
        {doc.visitaTecnica ? (
          <div style={{ background: CINZA, borderRadius: 10, padding: '10px 14px', textAlign: 'center', marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>Visita técnica em:</div>
            <div style={{ fontSize: 13.5, marginTop: 2 }}>{doc.visitaTecnica}</div>
          </div>
        ) : null}
      </section>

      {/* ── Serviços ── */}
      <section style={{ marginTop: 16 }}>
        <div style={{ background: CINZA, borderRadius: '10px 10px 0 0', padding: '14px 16px', fontSize: 20, fontWeight: 800 }}>Serviços</div>
        <div
          className="od-row od-head"
          style={{
            background: PRETO,
            color: '#fff',
            borderRadius: '0 0 10px 10px',
            padding: '10px 16px',
            fontWeight: 700,
            fontSize: 12.5,
          }}
        >
          <div>Item</div>
          <div className="od-cols">
            <div style={{ textAlign: 'center' }}>Valor<br />Unitario</div>
            <div style={{ textAlign: 'center' }}>Quantidade</div>
            <div style={{ textAlign: 'center' }}>Subtotal</div>
          </div>
        </div>

        {doc.grupos.map((g, gi) => (
          <div key={gi}>
            {g.titulo ? (
              <div style={{ background: CINZA_CLARO, borderRadius: 6, padding: '6px 12px', fontWeight: 700, marginTop: 10, fontSize: 12.5 }}>
                {g.titulo}
              </div>
            ) : null}
            {g.itens.map((it, ii) => (
              <div
                key={ii}
                className="od-row"
                style={{
                  border: '1px solid #ddd',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginTop: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{it.titulo}</div>
                  {it.descricao ? <div style={{ fontSize: 12, marginTop: 2, whiteSpace: 'pre-wrap' }}>{it.descricao}</div> : null}
                </div>
                <div className="od-cols">
                  <Coluna rotulo={it.rotuloUnidade} valor={fmtValor(it.valorUnitario)} />
                  <Coluna rotulo="Quantidade" valor={fmtQuantidade(it.quantidade)} />
                  <Coluna rotulo="Valor" valor={fmtValor(it.subtotal)} />
                </div>
              </div>
            ))}
          </div>
        ))}

        <div style={{ background: PRETO, color: '#fff', borderRadius: 8, padding: '10px 14px', marginTop: 12, textAlign: 'right', fontWeight: 800, fontSize: 15 }}>
          Valor total dos Serviços:&nbsp;&nbsp; R$ {fmtBRL(doc.totais.totalServicos)}
        </div>
        <div style={{ background: CINZA, marginTop: 12, padding: '8px 14px', display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 6, columnGap: 18, fontSize: 13 }}>
          <div style={{ textAlign: 'right', fontWeight: 700 }}>Subtotal:</div>
          <div style={{ fontWeight: 700, textAlign: 'right' }}>R$ {fmtBRL(doc.totais.subtotal)}</div>
          {doc.totais.desconto > 0 ? (
            <>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>Descontos:</div>
              <div style={{ textAlign: 'right' }}>- R$ {fmtBRL(doc.totais.desconto)}</div>
            </>
          ) : null}
        </div>
        <div style={{ background: PRETO, color: '#fff', borderRadius: '0 0 8px 8px', padding: '10px 14px', textAlign: 'right', fontWeight: 800, fontSize: 17 }}>
          Valor total:&nbsp;&nbsp; R$ {fmtBRL(doc.totais.valorTotal)}
        </div>
        {doc.totais.temItemSemValor ? (
          <div style={{ fontSize: 11, color: MUDO, marginTop: 6 }}>Há item sem valor definido — ele não entra na soma.</div>
        ) : null}
      </section>

      {/* ── Laudo / informações ── */}
      {doc.laudoTecnico ? (
        <>
          <hr style={divisor} />
          <div style={h3}>Laudo Técnico</div>
          <p style={p}>{doc.laudoTecnico}</p>
        </>
      ) : null}
      {doc.informacoesAdicionais ? (
        <>
          <hr style={divisor} />
          <div style={h3}>Informações adicionais</div>
          <p style={p}>{doc.informacoesAdicionais}</p>
        </>
      ) : null}

      {/* ── Pagamento ── */}
      {doc.pagamento.formas.length > 0 || doc.pagamento.chavePix ? (
        <>
          <hr style={divisor} />
          <div style={{ background: CINZA, borderRadius: '10px 10px 0 0', padding: '12px 16px', fontSize: 18, fontWeight: 800 }}>Pagamento</div>
          <div style={{ background: PRETO, color: '#fff', borderRadius: '0 0 10px 10px', padding: '8px 16px', fontWeight: 700, fontSize: 12.5 }}>
            Formas de pagamento
          </div>
          {doc.pagamento.formas.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: '10px 16px 0', margin: 0 }}>
              {doc.pagamento.formas.map((f) => (
                <li key={f} style={{ marginBottom: 6 }}>• &nbsp;{f}</li>
              ))}
            </ul>
          ) : null}
          {doc.pagamento.chavePix ? (
            <div style={{ background: CINZA, borderRadius: 10, padding: '10px 14px', marginTop: 12 }}>
              <b>Chave PIX:</b> {doc.pagamento.chavePix}
            </div>
          ) : null}
        </>
      ) : null}

      {/* ── Local (interna/externa) ── */}
      {doc.locais.length > 0 ? (
        <>
          <hr style={divisor} />
          {doc.locais.map((l, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>{l.titulo}</div>
              <div style={{ marginTop: 2 }}>{l.texto}</div>
            </div>
          ))}
        </>
      ) : null}

      {/* ── Aprovação ── */}
      {doc.aprovacao.aprovarUrl && doc.aprovacao.recusarUrl ? (
        <>
          <hr style={divisor} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <a
              href={doc.aprovacao.recusarUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ border: '1.5px solid #c62828', color: '#c62828', borderRadius: 8, padding: '10px 8px', textAlign: 'center', textDecoration: 'none' }}
            >
              <div style={{ fontWeight: 800, fontSize: 15 }}>Recusar</div>
              <div style={{ fontSize: 11, color: TEXTO }}>Toque aqui para recusar este orçamento.</div>
            </a>
            <a
              href={doc.aprovacao.aprovarUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ background: '#1aa64b', color: '#fff', borderRadius: 8, padding: '10px 8px', textAlign: 'center', textDecoration: 'none' }}
            >
              <div style={{ fontWeight: 800, fontSize: 15 }}>Aprovar orçamento</div>
              <div style={{ fontSize: 11 }}>Toque aqui para aprovar este orçamento.</div>
            </a>
          </div>
        </>
      ) : null}

      {/* ── Área do profissional ── */}
      {pr.sobre ? (
        <>
          <hr style={divisor} />
          <div style={{ fontSize: 22, fontWeight: 800 }}>Área do profissional</div>
          <div style={{ marginTop: 2, marginBottom: 12 }}>Saiba mais sobre seu prestador de serviços.</div>
          <div style={{ background: CINZA, borderRadius: 14, padding: 16, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {pr.logo ? (
              <img src={pr.logo} alt="" style={{ width: 64, height: 64, borderRadius: 32, objectFit: 'cover', background: '#fff', flexShrink: 0 }} />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{pr.nome}</div>
              <p style={{ ...p, marginTop: 6, fontSize: 12 }}>{pr.sobre}</p>
            </div>
          </div>
        </>
      ) : null}

      <div style={{ textAlign: 'center', fontSize: 10.5, color: TEXTO, marginTop: 22 }}>
        Documento gerado em {doc.geradoEm}
      </div>
    </div>
  );
}

function Coluna({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: MUDO }}>{rotulo}</div>
      <div style={{ fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap' }}>{valor}</div>
    </div>
  );
}
