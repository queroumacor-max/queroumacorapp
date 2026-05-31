// modules/leads.js — feature "Leads / Orçamentos" (distribuição de leads,
// manifestar interesse em obra, abrir chat com user, abrir formulário de
// pedido de orçamento) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, requireSession,
// appConfirm, toast, escapeHtml, notify, startChatWith, openChat, showScreen,
// enviarOrcamentoForm (helper que continua no app.js por enquanto).
(function(){
  'use strict';

  // ══ DISTRIBUIÇÃO DE LEADS ══
  async function distribuirLead(quoteId, serviceType, city){
    const sb = getSupabase(); if(!sb) return;
    // Find painters in same city, matching specialty, ordered by PRO first then rating
    let query = sb.from('profiles_public').select('id, name, role, city, specialties, rating_avg, portal_access')
      .in('role',['pintor','grafiteiro','automotivo']).ilike('city','%'+(city||'')+'%')
      .order('rating_avg',{ascending:false,nullsFirst:false}).limit(5);
    const { data: painters } = await query;
    if(!painters||painters.length===0) return;
    // PRO painters get priority (sorted first)
    painters.sort((a,b)=> (b.portal_access?1:0)-(a.portal_access?1:0));
    // Assign to top painter as exclusive if PRO, shared otherwise
    const topPainter = painters[0];
    const isExclusive = topPainter.portal_access;
    await sb.from('quotes').update({
      painter_id: topPainter.id,
      lead_type: isExclusive ? 'exclusive' : 'shared',
      is_exclusive: isExclusive
    }).eq('id', quoteId);
    return topPainter;
  }

  // ══ MANIFESTAR INTERESSE EM OBRA ══
  // Antes inseria uma row em orders com status='pending' eterno. Removido
  // porque (a) não tinha fluxo de pagamento real, (b) admin malicioso podia
  // marcar a order como 'paid' e disparar trigger de pontos. Hoje só
  // notifica o artista; venda real vai usar fluxo MP quando existir.
  // Guard por (artistId + postId): dois cliques rápidos no botão "Interesse"
  // do feed disparariam 2 notificações pro artista (spam). Guard em memória
  // dura o tempo da sessão — recarregar zera (intencional, é só anti-spam).
  const _comprarObraInFlight = new Set();
  async function comprarObra(postId, artistName, artistId, artType){
    if(!currentUser){ toast('Faça login pra falar com o artista'); return; }
    const key = String(artistId||'') + ':' + String(postId||'');
    if(_comprarObraInFlight.has(key)){ return; }
    if(!(await appConfirm('Manifestar interesse em "'+artType+'" de '+artistName+'? O artista será notificado e entra em contato.', { okLabel:'Manifestar interesse' }))) return;
    _comprarObraInFlight.add(key);
    const meuNome = (currentUser.user_metadata && currentUser.user_metadata.name) || 'Um cliente';
    // Usa notify_user RPC (SECURITY DEFINER que valida relação) — fallback
    // silencioso se não houver quote/conversa prévia.
    try {
      await notify(artistId, 'artwork_interest', 'Interesse em obra 🎨',
        meuNome + ' demonstrou interesse em "' + (artType||'sua obra') + '". Mande uma mensagem!',
        postId);
      toast('Interesse enviado! O artista vai te chamar.');
    } catch(e){
      console.warn('comprarObra notify:', e && e.message || e);
      toast('Mande uma mensagem direta ao artista pelo perfil dele.');
    } finally {
      _comprarObraInFlight.delete(key);
    }
  }

  // Alias para o wrapper canônico startChatWith (em head.js). Mantido pelos
  // callers inline (ex.: app.js:~6787 onclick="openChatWithUser('...')").
  function openChatWithUser(userId){
    if(typeof startChatWith === 'function') return startChatWith(userId);
    // Fallback se head.js ainda não carregou
    showScreen('chat');
    setTimeout(()=>{ if(typeof openChat==='function') openChat(userId); },300);
  }

  function abrirOrcamentoChat(painterId, painterName){
    if(!currentUser){ showScreen('login'); return; }
    const existing = document.getElementById('orc-chat-overlay');
    if(existing) existing.remove();

    // Store in closure to avoid escaping issues in onclick strings
    window._orcPainter = { id: painterId, name: painterName };
    window._orcPhotos = [];

    const fieldStyle = 'width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid var(--border);border-radius:12px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--white);outline:none;margin-top:4px;';

    function makeLabel(text){
      const d = document.createElement('div');
      d.style.cssText = 'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:14px;';
      d.textContent = text;
      return d;
    }
    function makeSelect(id, opts){
      const s = document.createElement('select');
      s.id = id;
      s.style.cssText = fieldStyle + 'appearance:none;-webkit-appearance:none;';
      opts.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; s.appendChild(op); });
      return s;
    }
    function makeInput(id, ph){
      const i = document.createElement('input');
      i.id = id; i.type = 'text'; i.placeholder = ph;
      i.style.cssText = fieldStyle;
      return i;
    }
    function makePhotosSection(){
      const wrap = document.createElement('div');
      wrap.style.marginTop = '14px';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;';
      lbl.textContent = 'Fotos do local (opcional · até 5)';
      const grid = document.createElement('div');
      grid.id = 'orc-photos-grid';
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:8px;';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      fileInput.id = 'orc-photo-input';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', e => { addOrcPhotos(e.target.files); e.target.value = ''; });
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.style.cssText = 'width:100%;padding:12px;background:var(--cream);color:var(--ink);border:1.5px dashed var(--border);border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;';
      addBtn.textContent = '📷 Adicionar fotos';
      addBtn.addEventListener('click', () => fileInput.click());
      wrap.append(lbl, grid, fileInput, addBtn);
      return wrap;
    }

    const overlay = document.createElement('div');
    overlay.id = 'orc-chat-overlay';
    overlay.className = 'overlay open';
    overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.style.cssText = 'padding-bottom:env(safe-area-inset-bottom,16px);max-height:92vh;overflow-y:auto;';
    sheet.addEventListener('click', e => e.stopPropagation());

    const handle = document.createElement('div'); handle.className = 'sheet-handle';
    const title = document.createElement('div'); title.className = 'sheet-title'; title.textContent = 'Pedir orçamento';
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:13px;color:var(--muted);margin-bottom:4px;';
    sub.innerHTML = 'Para <b style="color:var(--ink);">'+escapeHtml(painterName)+'</b>';

    const obs = document.createElement('textarea');
    obs.id = 'orc-obs'; obs.rows = 3; obs.placeholder = 'Cores, ambiente, acesso, etc.';
    obs.style.cssText = fieldStyle + 'resize:none;';

    const btn = document.createElement('button');
    btn.textContent = 'Enviar orçamento';
    btn.style.cssText = 'width:100%;margin-top:18px;padding:15px;background:var(--ink);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;touch-action:manipulation;';
    btn.addEventListener('click', enviarOrcamentoForm);

    sheet.append(
      handle, title, sub,
      makeLabel('Tipo de pintura'),
      makeSelect('orc-tipo', ['Selecione…','Pintura interna','Pintura externa / fachada']),
      makeLabel('Superfície'),
      makeSelect('orc-sup', ['Selecione…','Parede','Teto','Chão','Madeira','Metal','Telhado']),
      makeLabel('Quantidade de cômodos'),
      makeInput('orc-comodos', 'Ex: 3 quartos + 1 sala'),
      makeLabel('Área ou metragem'),
      makeInput('orc-area', 'Ex: 80 m² ou lista de itens'),
      makeLabel('Linha de tinta preferida'),
      makeSelect('orc-linha', ['Selecione…','Econômica','Standard','Premium']),
      makeLabel('Prazo desejado'),
      makeSelect('orc-prazo', ['Selecione…','O quanto antes','Em até 1 semana','Em até 15 dias','Em até 1 mês','Sem pressa / a combinar']),
      makeLabel('Observações'),
      obs,
      makePhotosSection(),
      btn
    );
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
  }

  window.Modules = window.Modules || {};
  window.Modules.leads = {
    distribuirLead, comprarObra, openChatWithUser, abrirOrcamentoChat
  };
})();
