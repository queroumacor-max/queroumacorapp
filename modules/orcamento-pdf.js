// modules/orcamento-pdf.js — feature "Orçamento PDF" (carregamento da lib
// jsPDF, montagem do documento, geração / compartilhamento do PDF e
// sugestão de materiais da loja vinculada ao orçamento) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada; próximo PR
// migra call sites e remove duplicatas do app.js).
//
// Depende de globals do app.js:
//   toast, getSupabase, escapeHtml, escapeJsArg, addToCart.
//
// Observação: `_lastOrcData` permanece declarado em app.js como `let` de top
// level (compartilhado com este módulo via leitura — `_buildOrcDoc` lê do
// estado canônico). Pra esta etapa de COPIA, lemos `window._lastOrcData`
// (já espelhado pelo `modules/ai-chat.js`) com fallback para o `let` global
// `_lastOrcData` do app.js. Na próxima etapa (migração de call sites) o
// estado fica só em `window._lastOrcData`. `_buildOrcDoc` é helper privado
// do IIFE — não é exportado.
(function(){
  'use strict';

  // Garante que window.jspdf está carregado antes de gerar PDF.
  // Se já estiver presente (tag estática no index.html), no-op. Senão, carrega
  // dinamicamente do path local — abrindo caminho pra remover a tag estática
  // num próximo passo e reduzir bundle inicial.
  async function ensureJsPDF() {
    if (window.jspdf) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/jspdf.umd.min.js?v=2.5.1';
      s.integrity = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function compartilharOrcamento(){
    try { await ensureJsPDF(); } catch(e){ console.warn('[ensureJsPDF]', e && e.message || e); }
    const doc = _buildOrcDoc();
    if(!doc){
      // Sem dados estruturados → compartilha o texto
      const text = document.getElementById('ai-orc-result')?.innerText || '';
      if(navigator.share){ navigator.share({ title:'Orçamento - QueroUmaCor', text }).catch(()=>{}); }
      else { navigator.clipboard.writeText(text).then(()=>toast('Orçamento copiado!')).catch(()=>toast('Erro ao copiar')); }
      return;
    }
    const file = new File([doc.output('blob')], 'orcamento-queroumacor.pdf', { type:'application/pdf' });
    try {
      if(navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({ files:[file], title:'Orçamento - QueroUmaCor', text:'Segue o orçamento gerado no QueroUmaCor.' });
        return;
      }
    } catch(e){ if(e && e.name === 'AbortError') return; /* outros erros → cai pro download */ }
    // Navegador sem suporte a compartilhar arquivo → baixa o PDF
    doc.save('orcamento-queroumacor.pdf');
    toast('PDF salvo — anexe no WhatsApp para enviar.');
  }

  // ══ PDF GENERATION ══
  // Monta o documento jsPDF do orçamento e o retorna (null se sem dados/lib).
  // Lê o estado canônico de `window._lastOrcData` (espelhado pelo ai-chat.js
  // e app.js) — na etapa 2 vira a única fonte.
  function _buildOrcDoc(){
    if(typeof window.jspdf === 'undefined') return null;
    const d = (typeof window !== 'undefined' && window._lastOrcData)
      || (typeof _lastOrcData !== 'undefined' ? _lastOrcData : null);
    if(!d || !(d.itens && d.itens.length) && !d.total) return null;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    // Header
    doc.setFillColor(26,26,46);
    doc.rect(0,0,210,35,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(22); doc.setFont(undefined,'bold');
    doc.text('ORCAMENTO',15,20);
    doc.setFontSize(10); doc.setFont(undefined,'normal');
    doc.text(d.hoje||'',195,15,{align:'right'});
    doc.text('QueroUmaCor',195,22,{align:'right'});
    // Info
    doc.setTextColor(26,26,46);
    let y=48;
    doc.setFontSize(11); doc.setFont(undefined,'bold');
    doc.text('Profissional: '+(d.pintor||''),15,y);
    doc.text('Cliente: '+(d.cliente||''),120,y); y+=10;
    doc.setFont(undefined,'normal'); doc.setFontSize(10);
    doc.text('Servico: '+(d.servico||''),15,y); y+=8;
    doc.text('Area: '+(d.area||0)+'m2  |  Demaos: '+(d.demaos||2)+'  |  Condicao: '+(d.condicao||''),15,y); y+=12;
    // Itens
    doc.setFont(undefined,'bold'); doc.setFontSize(11);
    doc.text('ITENS',15,y); y+=8;
    doc.setFont(undefined,'normal'); doc.setFontSize(9);
    (d.itens||[]).forEach(item=>{ doc.text('• '+item.desc,15,y); doc.text(item.valor,190,y,{align:'right'}); y+=6; if(y>270){doc.addPage();y=20;} });
    y+=6;
    // Obs
    doc.setFont(undefined,'bold'); doc.setFontSize(10);
    doc.text('OBSERVACOES',15,y); y+=7;
    doc.setFont(undefined,'normal'); doc.setFontSize(9);
    (d.obs||[]).forEach(o=>{ doc.text('• '+o,15,y); y+=5; if(y>270){doc.addPage();y=20;} });
    y+=6;
    // Forma de pagamento
    if(d.pagamento && d.pagamento.length){
      doc.setFont(undefined,'bold'); doc.setFontSize(10);
      doc.text('FORMA DE PAGAMENTO',15,y); y+=7;
      doc.setFont(undefined,'normal'); doc.setFontSize(9);
      d.pagamento.forEach(p=>{ doc.text('• '+p,15,y); y+=5; if(y>270){doc.addPage();y=20;} });
      y+=6;
    }
    // Total
    doc.setFillColor(245,240,235); doc.rect(10,y-4,190,18,'F');
    doc.setFont(undefined,'bold'); doc.setFontSize(14);
    doc.setTextColor(255,107,53);
    doc.text('TOTAL: R$ '+(d.total||0).toLocaleString('pt-BR'),105,y+7,{align:'center'});
    return doc;
  }

  async function gerarPDFOrcamento(){
    try { await ensureJsPDF(); } catch(e){ console.warn('[ensureJsPDF]', e && e.message || e); }
    const doc = _buildOrcDoc();
    if(!doc){ toast('Carregando PDF...'); return; }
    doc.save('orcamento-queroumacor.pdf');
    toast('PDF gerado!');
  }

  // ══ MATERIAL LIST LINKED TO STORE ══
  async function loadMaterialSuggestions(litros){
    const sb = getSupabase(); if(!sb) return;
    const { data: products } = await sb.from('products').select('*').eq('category','tintas').eq('active',true).limit(6);
    const el = document.getElementById('ai-orc-materiais');
    if(!el || !products || products.length===0) return;
    const l18 = Math.ceil(litros/18);
    el.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:8px;">MATERIAL DA NOSSA LOJA</div>'
      + products.map(p=>`<div style="display:flex;align-items:center;gap:10px;background:var(--white);border-radius:10px;padding:10px;margin-bottom:6px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
        <div style="width:36px;height:36px;border-radius:8px;background:${p.color_hex||'#ccc'};flex-shrink:0;"></div>
        <div style="flex:1;"><div style="font-size:12px;font-weight:700;">${escapeHtml(p.name)}</div><div style="font-size:10px;color:var(--muted);">${p.volume||'18L'} · ${p.line||''}</div></div>
        <div style="text-align:right;"><div style="font-size:12px;font-weight:700;color:var(--p1);">R$ ${(p.price||0).toLocaleString('pt-BR')}</div>
        <button onclick="addToCart('${p.id}',1,'${escapeJsArg(p.name)}',${p.price||0})" style="margin-top:4px;padding:4px 8px;background:var(--ink);color:#fff;border:none;border-radius:6px;font-size:9px;font-weight:700;cursor:pointer;">+ Carrinho</button></div>
      </div>`).join('');
  }

  window.Modules = window.Modules || {};
  window.Modules.orcamentoPdf = {
    ensureJsPDF, compartilharOrcamento, gerarPDFOrcamento, loadMaterialSuggestions
  };
})();
