// quotePdf.ts — gera Blob de PDF do orçamento usando jsPDF puro (sem html2canvas
// que adicionaria ~200kb). Layout A4 portrait com:
//   - Cabeçalho: logo + nome do pintor + contato + "ORÇAMENTO #id + data"
//   - Bloco cliente (border-left roxa)
//   - Tabela de detalhes do serviço
//   - Bloco escopo (parágrafo)
//   - Card valor total
//   - Rodapé com data de emissão
//
// Retorna um Blob 'application/pdf' que pode ser:
//  - Compartilhado via navigator.share({ files: [file] }) — alvo principal
//  - Baixado via download anchor fallback
//
// Dynamic import do jsPDF pra não pesar o bundle inicial (~150kb gz).

import type { Quote } from '@/lib/types';

export interface PainterForPdf {
  name?: string | null;
  tag?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  business_logo_url?: string | null;
  business_name?: string | null;
  avatar_url?: string | null;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const PRIMARY = '#FF6B35';
const ACCENT = '#8338ec';
const INK = '#1a1a2e';
const MUTED = '#888888';

// Carrega imagem como data URL pra jsPDF.addImage. Falha → null (segue sem logo).
async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Extrai dados de quote_data jsonb com fallback seguro.
function readField(qd: unknown, key: string): string {
  if (!qd || typeof qd !== 'object') return '';
  const v = (qd as Record<string, unknown>)[key];
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ');
  return '';
}
function readBool(qd: unknown, key: string): boolean | null {
  if (!qd || typeof qd !== 'object') return null;
  const v = (qd as Record<string, unknown>)[key];
  return typeof v === 'boolean' ? v : null;
}

export async function generateQuotePdfBlob(
  quote: Quote,
  painter: PainterForPdf | null,
): Promise<Blob> {
  // Dynamic import pra não pesar bundle inicial.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageW - margin * 2;

  const today = new Date().toLocaleDateString('pt-BR');
  const price = Number(quote.price) || 0;
  const warranty = ((quote.quote_data as { warranty?: string } | null)?.warranty) || '';
  const qd = quote.quote_data;

  // Prioridade: name primeiro, business_name como fallback. Antes priorizávamos
  // business_name (legado vanilla salvava label do logo da camisa lá), o que
  // poluía os PDFs com nomes de teste antigos.
  const painterName =
    painter?.name ||
    painter?.business_name ||
    (painter?.tag ? '@' + painter.tag : 'Pintor');
  const painterTag = painter?.tag ? '@' + painter.tag : '';
  const painterPhone = painter?.phone || '';
  const painterEmail = painter?.email || '';
  const painterCity =
    painter?.city && painter?.state
      ? `${painter.city}/${painter.state}`
      : painter?.city || '';

  // ── CABEÇALHO ─────────────────────────────────────────────────────────
  const logoUrl = painter?.business_logo_url || painter?.avatar_url || '';
  let cursorY = margin;
  let textX = margin;

  if (logoUrl) {
    const dataUrl = await loadImageAsDataUrl(logoUrl);
    if (dataUrl) {
      try {
        const ext = dataUrl.match(/^data:image\/(\w+);/)?.[1]?.toUpperCase() || 'JPEG';
        const fmt = ext === 'PNG' ? 'PNG' : 'JPEG';
        doc.addImage(dataUrl, fmt, margin, cursorY, 18, 18);
        textX = margin + 22;
      } catch {
        // Imagem inválida — segue sem logo.
      }
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(INK);
  doc.text(painterName, textX, cursorY + 6);

  if (painterTag) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text(painterTag, textX, cursorY + 11);
  }

  // Badge "ORÇAMENTO" à direita
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(PRIMARY);
  doc.text('ORÇAMENTO', pageW - margin, cursorY + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(today, pageW - margin, cursorY + 11, { align: 'right' });
  doc.text(`#${(quote.id || '').slice(0, 8)}`, pageW - margin, cursorY + 15, {
    align: 'right',
  });

  cursorY += 21;

  // Linha de contato (debaixo do nome)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  const contactParts = [
    painterPhone ? `Tel: ${painterPhone}` : '',
    painterEmail ? `E-mail: ${painterEmail}` : '',
    painterCity ? `${painterCity}` : '',
  ].filter(Boolean);
  if (contactParts.length > 0) {
    doc.text(contactParts.join('   ·   '), margin, cursorY);
    cursorY += 4;
  }

  // Linha separadora laranja
  doc.setDrawColor(PRIMARY);
  doc.setLineWidth(0.8);
  doc.line(margin, cursorY + 2, pageW - margin, cursorY + 2);
  cursorY += 8;

  // ── BLOCO CLIENTE ────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text('CLIENTE', margin, cursorY);
  cursorY += 4;

  // Card cinza com border-left roxa
  const cardY = cursorY;
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(margin, cardY, contentW, 14, 2, 2, 'F');
  doc.setFillColor(ACCENT);
  doc.rect(margin, cardY, 1.2, 14, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text(quote.client_name || 'Cliente não informado', margin + 4, cardY + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  const clientLine = [
    quote.client_phone ? `Tel: ${quote.client_phone}` : '',
    quote.address ? `End: ${quote.address}` : '',
  ]
    .filter(Boolean)
    .join('   ·   ');
  if (clientLine) {
    doc.text(clientLine, margin + 4, cardY + 10);
  }
  cursorY = cardY + 18;

  // ── TABELA DE DETALHES ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text('DETALHES DO SERVIÇO', margin, cursorY);
  cursorY += 4;

  const rows: Array<[string, string]> = [];
  const push = (k: string, v: string | null | undefined) => {
    if (v && v !== '—') rows.push([k, String(v)]);
  };

  push('Serviço', quote.service_type || quote.title || '');
  push('Área', quote.area_m2 ? `${quote.area_m2} m²` : '');
  push('Tipo de tinta', readField(qd, 'paintType'));
  push('Cor', readField(qd, 'colorWant'));
  push('Demãos', readField(qd, 'coats'));
  push('Preparação', readField(qd, 'prep'));
  push('Superfície', readField(qd, 'surfaceState'));
  push('Acesso', readField(qd, 'access'));
  push('Prazo de conclusão', quote.proposed_date);
  const im = readBool(qd, 'includeMaterial');
  if (im !== null) push('Inclui material', im ? 'Sim' : 'Não');
  const il = readBool(qd, 'includeLabor');
  if (il !== null) push('Inclui mão de obra', il ? 'Sim' : 'Não');
  push('Garantia', warranty);

  doc.setFontSize(9);
  doc.setTextColor(INK);
  const labelW = 38;
  const valueX = margin + labelW + 2;
  for (const [k, v] of rows) {
    if (cursorY > 270) {
      doc.addPage();
      cursorY = margin;
    }
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text(k, margin, cursorY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(INK);
    const wrapped = doc.splitTextToSize(v, contentW - labelW - 2) as string[];
    doc.text(wrapped, valueX, cursorY);
    const lines = wrapped.length;
    // Linha tracejada divisora
    doc.setDrawColor(238, 238, 238);
    doc.setLineWidth(0.15);
    doc.line(margin, cursorY + lines * 3.5 + 1, pageW - margin, cursorY + lines * 3.5 + 1);
    cursorY += lines * 3.5 + 3;
  }

  // ── ESCOPO TÉCNICO ────────────────────────────────────────────────────
  if (quote.description) {
    cursorY += 4;
    if (cursorY > 250) {
      doc.addPage();
      cursorY = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text('ESCOPO TÉCNICO', margin, cursorY);
    cursorY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(INK);
    const scopeLines = doc.splitTextToSize(quote.description, contentW) as string[];
    for (const line of scopeLines) {
      if (cursorY > 280) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(line, margin, cursorY);
      cursorY += 4;
    }
  }

  // ── VALOR TOTAL ──────────────────────────────────────────────────────
  cursorY += 6;
  if (cursorY > 250) {
    doc.addPage();
    cursorY = margin;
  }
  const valY = cursorY;
  // Card com border laranja
  doc.setFillColor(255, 244, 237);
  doc.setDrawColor(PRIMARY);
  doc.setLineWidth(0.7);
  doc.roundedRect(margin, valY, contentW, 20, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text('VALOR TOTAL', margin + 5, valY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('À combinar forma e parcelamento', margin + 5, valY + 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(PRIMARY);
  const priceTxt = price > 0 ? BRL.format(price) : '—';
  doc.text(priceTxt, pageW - margin - 5, valY + 12, { align: 'right' });
  cursorY = valY + 24;

  // ── RODAPÉ ───────────────────────────────────────────────────────────
  cursorY += 4;
  doc.setDrawColor(229, 229, 229);
  doc.setLineWidth(0.3);
  doc.line(margin, cursorY, pageW - margin, cursorY);
  cursorY += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Gerado em ${today} via QueroUmaCor`, margin, cursorY);
  doc.text('Validade: 15 dias da emissão', pageW - margin, cursorY, {
    align: 'right',
  });

  return doc.output('blob');
}

/**
 * Gera + baixa OU compartilha PDF do orçamento. Usa navigator.share({files})
 * quando disponível (mobile com share sheet nativo); fallback abre download.
 */
export async function shareOrDownloadQuotePdf(
  quote: Quote,
  painter: PainterForPdf | null,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await generateQuotePdfBlob(quote, painter);
  const filename = `orcamento-${(quote.id || 'novo').slice(0, 8)}.pdf`;
  const file = new File([blob], filename, { type: 'application/pdf' });

  // Tenta Web Share API com arquivo (Chrome Android, Safari iOS 15+).
  type Nav = Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  const nav = typeof navigator !== 'undefined' ? (navigator as Nav) : null;
  if (nav?.canShare && nav?.share && nav.canShare({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: `Orçamento ${quote.service_type || ''}`.trim(),
        text: 'Orçamento em anexo.',
      });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // Cai pro download fallback se share falhar por outro motivo.
    }
  }

  // Fallback: download direto via anchor.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  return 'downloaded';
}
