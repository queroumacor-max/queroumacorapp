'use client';
// QuotePdfSheet — preview formatado pra impressão/PDF. Renderiza um layout
// A4-ready com: cabeçalho com business_logo do pintor + dados completos
// (nome, tag, telefone, cidade, email), bloco do cliente (nome, telefone,
// endereço), tabela de detalhes do serviço, escopo, observações, valor
// destacado, e rodapé com data + branding.
//
// Usa @media print pra esconder tudo fora do .quote-pdf-content quando o
// browser entra em modo impressão — o user salva como PDF pelo diálogo
// nativo ("Salvar como PDF"). Sem jspdf — economiza 150kb.

import type { Quote } from '@/lib/types';

interface PainterProfile {
  name?: string | null;
  tag?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  email?: string | null;
  business_logo_url?: string | null;
  business_name?: string | null;
  avatar_url?: string | null;
}

export interface QuotePdfSheetProps {
  open: boolean;
  onClose: () => void;
  quote: Quote;
  painter: PainterProfile | null;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function QuotePdfSheet({ open, onClose, quote, painter }: QuotePdfSheetProps) {
  if (!open) return null;

  const today = new Date().toLocaleDateString('pt-BR');
  const price = Number(quote.price) || 0;
  const warranty =
    ((quote.quote_data as { warranty?: string } | null)?.warranty) || '';
  const qd = (quote.quote_data ?? null) as Record<string, unknown> | null;
  const paintType = qd && typeof qd['paintType'] === 'string' ? (qd['paintType'] as string) : '';
  const coats = qd && (typeof qd['coats'] === 'string' || typeof qd['coats'] === 'number') ? String(qd['coats']) : '';
  const colorWant = qd && typeof qd['colorWant'] === 'string' ? (qd['colorWant'] as string) : '';
  const prep = qd && Array.isArray(qd['prep']) ? (qd['prep'] as unknown[]).filter((p) => typeof p === 'string').join(', ') : '';
  const includeMaterial = qd ? !!qd['includeMaterial'] : null;
  const includeLabor = qd ? !!qd['includeLabor'] : null;
  const surfaceState = qd && typeof qd['surfaceState'] === 'string' ? (qd['surfaceState'] as string) : '';
  const access = qd && typeof qd['access'] === 'string' ? (qd['access'] as string) : '';

  const painterName =
    painter?.business_name ||
    painter?.name ||
    (painter?.tag ? '@' + painter.tag : 'Pintor');
  const painterLogo = painter?.business_logo_url || painter?.avatar_url || '';
  const painterTag = painter?.tag ? '@' + painter.tag : '';
  const painterPhone = painter?.phone || '';
  const painterCity =
    painter?.city && painter?.state
      ? `${painter.city}/${painter.state}`
      : painter?.city || '';
  const painterEmail = painter?.email || '';

  return (
    <>
      {/* Print styles: esconde tudo exceto .quote-pdf-content. Layout A4 limpo. */}
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          .quote-pdf-content, .quote-pdf-content * { visibility: visible !important; }
          .quote-pdf-content {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            color: #1a1a2e !important;
            box-shadow: none !important;
          }
          .quote-pdf-noprint { display: none !important; }
        }
      `}</style>

      <div
        className="fixed inset-0 z-50 quote-pdf-noprint flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,.6)', padding: 12 }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white"
          style={{
            width: '100%',
            maxWidth: 560,
            maxHeight: '92vh',
            overflowY: 'auto',
            borderRadius: 16,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <header
            className="flex items-center justify-between quote-pdf-noprint"
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e5e5e5',
              flexShrink: 0,
            }}
          >
            <h2 className="font-bold text-sm">Preview do orçamento (PDF)</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}
            >
              ✕
            </button>
          </header>

          {/* Conteúdo do PDF */}
          <article
            className="quote-pdf-content"
            style={{
              padding: 28,
              background: '#fff',
              color: '#1a1a2e',
              fontFamily: 'DM Sans, system-ui, sans-serif',
              lineHeight: 1.5,
            }}
          >
            {/* CABEÇALHO — logo + dados do profissional */}
            <header
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 16,
                paddingBottom: 16,
                borderBottom: '3px solid #FF6B35',
                marginBottom: 18,
              }}
            >
              {painterLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={painterLogo}
                  alt="Logo"
                  style={{
                    width: 72,
                    height: 72,
                    objectFit: 'cover',
                    borderRadius: 10,
                    border: '1px solid #eee',
                    background: '#fafafa',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 10,
                    background:
                      'linear-gradient(135deg, #FF6B35, #8338ec)',
                    color: '#fff',
                    fontSize: 28,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {painterName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: '#1a1a2e',
                    fontFamily: 'Syne, DM Sans, sans-serif',
                    lineHeight: 1.15,
                  }}
                >
                  {painterName}
                </div>
                {painterTag ? (
                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                    {painterTag}
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: 11,
                    color: '#444',
                    marginTop: 8,
                    display: 'flex',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  {painterPhone ? <span>📞 {painterPhone}</span> : null}
                  {painterEmail ? <span>✉ {painterEmail}</span> : null}
                  {painterCity ? <span>📍 {painterCity}</span> : null}
                </div>
              </div>
              <div
                style={{
                  textAlign: 'right',
                  fontSize: 10,
                  color: '#666',
                  flexShrink: 0,
                  paddingLeft: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#FF6B35',
                    letterSpacing: '.08em',
                  }}
                >
                  ORÇAMENTO
                </div>
                <div style={{ marginTop: 4 }}>{today}</div>
                <div style={{ marginTop: 2, fontFamily: 'monospace', opacity: 0.7 }}>
                  #{(quote.id || '').slice(0, 8)}
                </div>
              </div>
            </header>

            {/* BLOCO 1 — DADOS DO CLIENTE */}
            <section style={{ marginBottom: 18 }}>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: '#999',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                  marginBottom: 8,
                }}
              >
                Cliente
              </h3>
              <div
                style={{
                  background: '#f8f8f8',
                  padding: '12px 14px',
                  borderRadius: 8,
                  borderLeft: '3px solid #8338ec',
                  fontSize: 13,
                }}
              >
                {quote.client_name ? (
                  <div style={{ fontWeight: 700, color: '#1a1a2e' }}>
                    {quote.client_name}
                  </div>
                ) : (
                  <div style={{ color: '#999' }}>Cliente não informado</div>
                )}
                <div style={{ marginTop: 4, color: '#444', fontSize: 12 }}>
                  {quote.client_phone ? <span>📞 {quote.client_phone}</span> : null}
                  {quote.client_phone && quote.address ? ' · ' : ''}
                  {quote.address ? <span>📍 {quote.address}</span> : null}
                </div>
              </div>
            </section>

            {/* BLOCO 2 — DETALHES DO SERVIÇO (tabela) */}
            <section style={{ marginBottom: 18 }}>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: '#999',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                  marginBottom: 8,
                }}
              >
                Detalhes do serviço
              </h3>
              <table
                style={{
                  width: '100%',
                  fontSize: 12,
                  color: '#1a1a2e',
                  borderCollapse: 'collapse',
                }}
              >
                <tbody>
                  <Row k="Serviço" v={quote.service_type || quote.title || '—'} />
                  {quote.area_m2 ? <Row k="Área" v={`${quote.area_m2} m²`} /> : null}
                  {paintType ? <Row k="Tipo de tinta" v={paintType} /> : null}
                  {colorWant ? <Row k="Cor" v={colorWant} /> : null}
                  {coats ? <Row k="Demãos" v={coats} /> : null}
                  {prep ? <Row k="Preparação" v={prep} /> : null}
                  {surfaceState ? <Row k="Superfície" v={surfaceState} /> : null}
                  {access ? <Row k="Acesso" v={access} /> : null}
                  {quote.proposed_date ? (
                    <Row k="Prazo de conclusão" v={quote.proposed_date} />
                  ) : null}
                  {includeMaterial !== null ? (
                    <Row k="Inclui material" v={includeMaterial ? 'Sim' : 'Não'} />
                  ) : null}
                  {includeLabor !== null ? (
                    <Row k="Inclui mão de obra" v={includeLabor ? 'Sim' : 'Não'} />
                  ) : null}
                  {warranty ? <Row k="Garantia" v={warranty} /> : null}
                </tbody>
              </table>
            </section>

            {/* BLOCO 3 — ESCOPO TÉCNICO */}
            {quote.description ? (
              <section style={{ marginBottom: 18 }}>
                <h3
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#999',
                    textTransform: 'uppercase',
                    letterSpacing: '.06em',
                    marginBottom: 8,
                  }}
                >
                  Escopo técnico
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: '#333',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    margin: 0,
                  }}
                >
                  {quote.description}
                </p>
              </section>
            ) : null}

            {/* BLOCO 4 — VALOR TOTAL (destaque) */}
            <section
              style={{
                marginTop: 24,
                padding: 20,
                background:
                  'linear-gradient(135deg, rgba(255,107,53,.08) 0%, rgba(131,56,236,.08) 100%)',
                borderRadius: 12,
                border: '2px solid #FF6B35',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: '#888',
                    fontWeight: 800,
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  Valor total
                </div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                  À combinar forma e parcelamento
                </div>
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: '#FF6B35',
                  fontFamily: 'Syne, DM Sans, sans-serif',
                  lineHeight: 1,
                }}
              >
                {price > 0 ? BRL.format(price) : '—'}
              </div>
            </section>

            {/* RODAPÉ */}
            <footer
              style={{
                marginTop: 24,
                paddingTop: 14,
                borderTop: '1px solid #e5e5e5',
                fontSize: 10,
                color: '#999',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>
                Orçamento gerado em {today} via QueroUmaCor
              </span>
              <span>
                Validade: 15 dias da emissão
              </span>
            </footer>
          </article>

          <footer
            className="quote-pdf-noprint flex gap-2"
            style={{
              padding: 12,
              borderTop: '1px solid #e5e5e5',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="flex-1 font-bold text-sm"
              style={{
                padding: 11,
                background: '#fff',
                color: '#1a1a2e',
                borderRadius: 10,
                border: '1.5px solid #e5e5e5',
                cursor: 'pointer',
              }}
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex-1 font-bold text-white text-sm"
              style={{
                padding: 11,
                background: 'linear-gradient(135deg, #FF6B35, #8338ec)',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              🖨️ Imprimir / Salvar PDF
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td
        style={{
          padding: '6px 12px 6px 0',
          color: '#888',
          verticalAlign: 'top',
          width: '38%',
          borderBottom: '1px dashed #eee',
          fontWeight: 500,
        }}
      >
        {k}
      </td>
      <td
        style={{
          padding: '6px 0',
          color: '#1a1a2e',
          fontWeight: 700,
          borderBottom: '1px dashed #eee',
        }}
      >
        {v}
      </td>
    </tr>
  );
}
