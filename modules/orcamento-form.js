// modules/orcamento-form.js — feature "Orçamento (formulário do cliente)"
// extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
//
// Depende de globals do app.js:
//   getSupabase, requireSession, currentUser, currentChat, chatData,
//   toast, showScreen, showError, notify, distribuirLead,
//   stripEmail, escapeHtml, escapeJsArg, cleanHandle, isProfessionalRole,
//   saveConvLocal, loadConvsLocal, loadMsgsLocal,
//   _resetMsgColors, renderMessages.
//
// Funções extraídas:
//   abrirOrcamentoChat (constrói o modal "Pedir orçamento" via DOM),
//   addOrcPhotos, renderOrcPhotos, removeOrcPhoto, enviarOrcamentoForm
//   (cobre o fluxo do modal "Pedir orçamento" — solicitação rica com fotos),
//   toggleOrcOutros, sendOrc (formulário clássico de orçamento na tela),
//   openChat (abre conversa no chat — usado após enviar o orçamento;
//   versão do bloco do orcamento-form, NÃO a openChatConversation).
//
// Estado interno (era top-level no app.js):
//   chatStoreAdded, renderedMsgIds — usados por openChat.
(function(){
  'use strict';

  // ══ ESTADO INTERNO DO CHAT (usado por openChat) ══
  let chatStoreAdded = false;
  // Track which message IDs are already rendered to avoid duplicates
  const renderedMsgIds = new Set();

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

  // ══ Helpers das fotos do pedido (escopo global pq onclick inline usa) ══
  function addOrcPhotos(files){
    if(!files) return;
    window._orcPhotos = window._orcPhotos || [];
    for(const f of files){
      if(window._orcPhotos.length >= 5){ toast('Máximo 5 fotos'); break; }
      if(!f.type || !f.type.startsWith('image/')) continue;
      window._orcPhotos.push(f);
    }
    renderOrcPhotos();
  }
  function renderOrcPhotos(){
    const grid = document.getElementById('orc-photos-grid');
    if(!grid) return;
    const photos = window._orcPhotos || [];
    grid.innerHTML = photos.map((f,i) => {
      const url = URL.createObjectURL(f);
      return '<div style="position:relative;aspect-ratio:1;background:var(--cream);border-radius:8px;overflow:hidden;">'
        + '<img src="'+url+'" style="width:100%;height:100%;object-fit:cover;">'
        + '<span onclick="removeOrcPhoto('+i+')" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;">×</span>'
        + '</div>';
    }).join('');
  }
  function removeOrcPhoto(idx){
    if(!window._orcPhotos) return;
    window._orcPhotos.splice(idx, 1);
    renderOrcPhotos();
  }

  async function enviarOrcamentoForm(){
    const p = window._orcPainter || {};
    const painterId = p.id;
    const painterName = p.name || '';
    const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };

    const partes = ['Olá, '+painterName+'! Gostaria de solicitar um orçamento:'];
    const tipo  = v('orc-tipo');
    const sup   = v('orc-sup');
    const comod = v('orc-comodos').trim();
    const area  = v('orc-area').trim();
    const linha = v('orc-linha');
    const prazo = v('orc-prazo');
    const obs   = v('orc-obs').trim();

    if(tipo  && tipo  !== 'Selecione…') partes.push('📌 Tipo: '+tipo);
    if(sup   && sup   !== 'Selecione…') partes.push('🧱 Superfície: '+sup);
    if(comod) partes.push('🚪 Cômodos: '+comod);
    if(area)  partes.push('📐 Área: '+area);
    if(linha && linha !== 'Selecione…') partes.push('🎨 Linha: '+linha);
    if(prazo && prazo !== 'Selecione…') partes.push('📅 Prazo: '+prazo);
    if(obs)   partes.push('📝 Obs: '+obs);

    if(partes.length === 1){ toast('Preencha pelo menos um campo'); return; }

    // Cria o pedido no pipeline do profissional e dispara a notificação.
    const ctx = requireSession('Faça login para pedir orçamento');
    if(!ctx) return;
    const sb = ctx.sb;
    if(!painterId){ toast('Não foi possível identificar o profissional do post'); return; }
    if(painterId === currentUser.id){ toast('Você não pode pedir orçamento para si mesmo'); return; }

    const serviceType = (tipo && tipo !== 'Selecione…') ? tipo : 'Solicitação de orçamento';

    // Upload das fotos (até 5) — coleta as URLs públicas
    const photos = window._orcPhotos || [];
    const imageUrls = [];
    if(photos.length > 0){
      toast('Enviando fotos...');
      for(let i = 0; i < photos.length; i++){
        const f = photos[i];
        try {
          const extRaw = (f.name || '').split('.').pop() || 'jpg';
          const ext = extRaw.toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
          const path = currentUser.id + '/quote_' + Date.now() + '_' + i + '.' + ext;
          const { error: upErr } = await sb.storage.from('posts').upload(path, f, { upsert: false, contentType: f.type });
          if(upErr){ console.warn('upload foto:', upErr.message); continue; }
          const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
          if(urlData && urlData.publicUrl) imageUrls.push(urlData.publicUrl);
        } catch(e){ console.warn('upload foto:', e && e.message || e); }
      }
    }

    let novoQuoteId = null;
    try {
      // Usa RPC create_quote_from_post (SECURITY DEFINER) — força client_id
      const { data: rpcId, error: qErr } = await sb.rpc('create_quote_from_post', {
        p_painter_id:    painterId,
        p_post_id:       null,
        p_title:         serviceType,
        p_service_type:  serviceType,
        p_area_m2:       null,
        p_address:       null,
        p_description:   partes.slice(1).join('\n') || null,
        p_proposed_date: null,
        p_images:        imageUrls,
        p_lead_type:     'exclusive'
      });
      if(qErr) throw qErr;
      novoQuoteId = rpcId || null;
    } catch(e){
      console.warn('enviarOrcamentoForm quote:', e && e.message || e);
      toast('Erro ao enviar o pedido: ' + (e.message || e));
      return;
    }
    window._orcPhotos = [];
    const meuNome = (currentUser.user_metadata && currentUser.user_metadata.name) || 'Um cliente';
    await notify(painterId, 'quote_request', 'Novo pedido de orçamento 📋',
      meuNome + ' solicitou um orçamento. Veja no seu pipeline.', novoQuoteId);

    const overlay = document.getElementById('orc-chat-overlay');
    if(overlay) overlay.remove();
    window._orcPainter = null;
    toast('Pedido de orçamento enviado! ✅');

    window._orcPreMsg = partes.join('\n');
    showScreen('chat');
    setTimeout(()=>{
      if(typeof openChat==='function') openChat(painterId);
      setTimeout(()=>{
        const input = document.getElementById('chat-input') || document.getElementById('chat-input-field');
        if(input){ input.value = window._orcPreMsg; input.focus(); window._orcPreMsg = null; }
      }, 600);
    }, 300);
  }

  // ══ ORCAMENTO ══
  function toggleOrcOutros(v){
    const wrap = document.getElementById('orc-outros-wrap');
    if(!wrap) return;
    wrap.style.display = v === 'Outros' ? '' : 'none';
    if(v === 'Outros') document.getElementById('orc-outros-desc').focus();
  }

  async function sendOrc(){
    const sb = getSupabase();
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ toast('⚠️ Faça login para enviar orçamento.'); return; }

    const painterId = document.getElementById('orc-painter-id').value || null;
    const rawType = document.getElementById('orc-service-type').value;
    const outrosDesc = (document.getElementById('orc-outros-desc')||{}).value?.trim();
    const serviceType = rawType === 'Outros' ? ('Outros: ' + (outrosDesc || '').slice(0,120)) : rawType;
    const area = parseFloat(document.getElementById('orc-area').value) || null;
    const address = document.getElementById('orc-address').value.trim();
    const proposedDate = document.getElementById('orc-date').value || null;
    const description = document.getElementById('orc-desc').value.trim();

    if(!rawType){ toast('⚠️ Selecione o tipo de serviço.'); return; }
    if(rawType === 'Outros' && !outrosDesc){ toast('⚠️ Descreva o tipo de serviço.'); document.getElementById('orc-outros-desc').focus(); return; }
    if(!address){ toast('⚠️ Informe o endereço.'); return; }

    const btn = document.querySelector('.orc-submit');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Enviando...';

    // Usa RPC create_quote_from_post (SECURITY DEFINER) — força client_id =
    // auth.uid() no servidor, impedindo forjar pedido em nome de outro user.
    const { data: newQuoteId, error } = await sb.rpc('create_quote_from_post', {
      p_painter_id:    painterId || null,
      p_post_id:       null,
      p_title:         serviceType,
      p_service_type:  serviceType,
      p_area_m2:       area,
      p_address:       address,
      p_description:   description || null,
      p_proposed_date: proposedDate || null,
      p_images:        [],
      p_lead_type:     painterId ? 'exclusive' : 'shared'
    });
    const quoteData = newQuoteId ? { id: newQuoteId } : null;

    btn.disabled = false;
    btn.querySelector('span').textContent = '📩 Enviar Solicitação';

    if(error){
      showError('send-quote', error, 'Não foi possível enviar a solicitação de orçamento.');
    } else {
      // Auto-distribute lead if no specific painter
      if(!painterId && quoteData) distribuirLead(quoteData.id, serviceType, address);
      // Notifica o profissional do pedido recebido
      if(painterId && quoteData){
        const meuNome = (session.user.user_metadata && session.user.user_metadata.name) || 'Um cliente';
        notify(painterId, 'quote_request', 'Novo pedido de orçamento 📋',
          meuNome + ' solicitou um orçamento. Veja no seu pipeline.', quoteData.id);
      }
      // Pontos por solicitação são creditados automaticamente pelo
      // trigger trg_award_quote_request_points (Bateria 3.2).
      toast('✅ Solicitação enviada com sucesso!');
      // Clear form
      const _setEl = (id, prop, val) => { const e = document.getElementById(id); if(e) e[prop] = val; };
      _setEl('orc-service-type', 'selectedIndex', 0);
      toggleOrcOutros('');
      const od = document.getElementById('orc-outros-desc'); if(od) od.value = '';
      _setEl('orc-area', 'value', '');
      _setEl('orc-rooms', 'value', '');
      _setEl('orc-address', 'value', '');
      _setEl('orc-date', 'value', '');
      _setEl('orc-desc', 'value', '');
      setTimeout(()=>showScreen('feed'), 1800);
    }
  }

  function openChat(id) {
    currentChat = id;
    chatStoreAdded = false;
    renderedMsgIds.clear();
    _resetMsgColors();
    const conv = chatData[id];
    if(!conv){ console.error('openChat: no chatData'); return; }

    // Save conversation to localStorage so it appears in chat list
    const otherP = conv.participants.find(p => !p.logo) || conv.participants[0] || {};
    const _prevConv = (typeof loadConvsLocal === 'function') ? (loadConvsLocal()[id] || {}) : {};
    const _otherId = conv.otherId || _prevConv.otherId || '';
    if(_otherId) conv.otherId = _otherId;
    saveConvLocal(id, {
      name: otherP.name || conv.name || 'Usuário',
      avatar: otherP.img || '',
      tag: conv.sub && conv.sub.startsWith('@') ? conv.sub.substring(1) : '',
      role: otherP.role || '',
      otherId: _otherId,
      is3way: conv.type === '3way',
      lastMsg: '',
      lastMsgFrom: '',
      lastMsgTime: new Date().toISOString()
    });

    // Header
    const avatarsEl = document.getElementById('chat-header-avatars');
    if(conv.type==='3way' || conv.type==='store'){
      const parts = conv.participants.slice(0,3);
      avatarsEl.innerHTML = parts.map((p,i)=>`
        <div class="cha-av" style="left:${i*10}px;z-index:${3-i}">
          ${p.logo
            ? `<div style="width:100%;height:100%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><span style="font-size:10px;font-weight:800;color:var(--p1);font-family:'Syne',sans-serif;">CC</span></div>`
            : `<img src="${escapeHtml(p.img||'')}" alt="${escapeHtml(p.name||'')}">`}
        </div>`).join('');
      avatarsEl.style.width=(parts.length*10+22)+'px';
    } else {
      const p=conv.participants[0];
      avatarsEl.innerHTML=`<div class="cha-av" style="left:0;width:36px;height:36px;"><img src="${escapeHtml(p.img||'')}" alt="${escapeHtml(p.name||'')}"></div>`;
      avatarsEl.style.width='36px';
    }

    document.getElementById('chat-header-name').textContent = stripEmail(conv.name);
    document.getElementById('chat-header-sub').textContent = conv.sub;

    const partRow = document.getElementById('participant-row');
    if(conv.type==='3way'){
      partRow.style.display='flex';
      partRow.innerHTML = conv.participants.map(p=>`
        <div class="part-chip ${p.logo?'store':''}">
          ${p.logo
            ? `<div style="width:22px;height:22px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><span style="font-size:8px;font-weight:800;color:var(--p1);font-family:'Syne',sans-serif;">CC</span></div>`
            : `<img src="${escapeHtml(p.img||'')}" alt="${escapeHtml(p.name||'')}">`}
          <div><div class="part-chip-name">${escapeHtml(stripEmail(p.name))}</div><div class="part-chip-role">${escapeHtml(p.role||'')}</div></div>
        </div>`).join('');
    } else {
      partRow.style.display='none';
    }

    const invBar = document.getElementById('invite-store-bar');
    invBar.style.display = (conv.type==='direct') ? 'flex' : 'none';

    // Render saved messages from localStorage first (instant)
    const savedMsgs = loadMsgsLocal(id);
    if(savedMsgs.length > 0){
      const localRendered = savedMsgs.map(m => {
        const t = m.time ? new Date(m.time) : new Date();
        const timeStr = t.getHours()+':'+(t.getMinutes()<10?'0':'')+t.getMinutes();
        return { from: m.from || 'me', text: m.content || '', time: timeStr, type: m.type || 'text' };
      });
      renderMessages(localRendered);
    } else {
      renderMessages(conv.messages);
    }
    showScreen('chatconv');
    setTimeout(()=>{ const area=document.getElementById('msgs-area'); if(area) area.scrollTop=area.scrollHeight; },200);
    setTimeout(()=>{ const area=document.getElementById('msgs-area'); if(area) area.scrollTop=area.scrollHeight; },500);

    // Load real messages from Supabase
    (async () => {
      const sb = getSupabase();
      const { data:{ session } } = await sb.auth.getSession();
      if(!session){ console.warn('openChat: no session'); return; }


      // Load history by conversation_id (both sent and received)
      const { data: msgs, error } = await sb.from('messages')
        .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(100);

      if(error) console.error('openChat load error:', error.message);

      if(!error && msgs && msgs.length > 0){
        const myId = session.user.id;
        // Detect 3-way from DB messages
        const has3way = msgs.some(m => m.type === 'system' && m.content === '__STORE_ADDED__');
        if(has3way && conv.type !== '3way'){
          conv.type = '3way';
          if(!conv.participants.some(p => p.logo)){
            conv.participants.unshift({logo:true,name:'Cali Colors',role:'Loja Oficial'});
          }
          conv.name = conv.name.includes('Cali Colors') ? conv.name : conv.name + ' + Cali Colors';
          conv.sub = '3 participantes · Chat 3-way ativo';
          chatStoreAdded = true;
          // Update header for 3-way
          document.getElementById('chat-header-name').textContent = stripEmail(conv.name);
          document.getElementById('chat-header-sub').textContent = conv.sub;
          document.getElementById('invite-store-bar').style.display = 'none';
          const avatarsEl = document.getElementById('chat-header-avatars');
          const parts = conv.participants.slice(0,3);
          avatarsEl.innerHTML = parts.map((p,i)=>`
            <div class="cha-av" style="left:${i*10}px;z-index:${3-i}">
              ${p.logo
                ? '<div style="width:100%;height:100%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><span style="font-size:10px;font-weight:800;color:var(--p1);font-family:\'Syne\',sans-serif;">CC</span></div>'
                : '<img src="'+escapeHtml(p.img||'')+'" alt="'+escapeHtml(p.name||'')+'">'}
            </div>`).join('');
          avatarsEl.style.width=(parts.length*10+22)+'px';
          const partRow = document.getElementById('participant-row');
          partRow.style.display='flex';
          partRow.innerHTML = conv.participants.map(p=>`
            <div class="part-chip ${p.logo?'store':''}">
              ${p.logo?'<div style="width:22px;height:22px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><span style="font-size:8px;font-weight:800;color:var(--p1);font-family:\'Syne\',sans-serif;">CC</span></div>':'<img src="'+escapeHtml(p.img||'')+'" alt="'+escapeHtml(p.name||'')+'">'}
              <div><div class="part-chip-name">${escapeHtml(stripEmail(p.name))}</div><div class="part-chip-role">${escapeHtml(p.role||'')}</div></div>
            </div>`).join('');
        }
        // Load profiles for all senders to show correct names in 3-way
        const senderIds = [...new Set(msgs.map(m => m.sender_id).filter(Boolean))];
        let senderProfiles = {};
        if(senderIds.length > 0){
          const { data: profs } = await sb.from('profiles_public').select('id, name, avatar_url, role, user_type, tag, portal_access').in('id', senderIds);
          if(profs) profs.forEach(p => { senderProfiles[p.id] = p; });
        }
        const otherPart = conv.participants.find(p => !p.logo) || conv.participants[0];
        const realMsgs = msgs.filter(m => m.type !== 'system').map(m => {
          const t = new Date(m.created_at);
          const time = t.getHours()+':'+(t.getMinutes()<10?'0':'')+t.getMinutes();
          const sp = senderProfiles[m.sender_id];
          const isStoreMsg = m.type === 'store' || (sp && sp.portal_access);
          if(isStoreMsg && m.sender_id !== myId){
            // Papel = LOJA, mas mostra quem respondeu (@tag), nao "Cali Colors" generico
            return { from:'store', text: m.content, time, type: m.type || 'text', sender: sp ? cleanHandle(sp) : (m.type === 'store' ? 'Cali Colors' : 'Loja'), role:'loja' };
          }
          const senderName = cleanHandle(sp, otherPart ? otherPart.name : 'Usuário');
          const senderImg = sp ? (sp.avatar_url || '') : (otherPart ? otherPart.img : '');
          let role = 'cliente';
          if(sp && (sp.portal_access || (sp.role||'').toLowerCase()==='admin')) role = 'loja';
          else if(sp && (isProfessionalRole(sp.role) || isProfessionalRole(sp.user_type))) role = 'profissional';
          return {
            from: m.sender_id === myId ? 'me' : 'other',
            text: m.content,
            time,
            type: m.type || 'text',
            sender: senderName,
            img: senderImg,
            role
          };
        });
        renderMessages(realMsgs);
        const area=document.getElementById('msgs-area');
        area.scrollTop=area.scrollHeight;
      }

      // Realtime handled by global subscription (setupGlobalMsgSubscription)
      window._chatSession = session;
      window._chatConv = conv;
    })();
  }

  window.Modules = window.Modules || {};
  window.Modules.orcamentoForm = {
    abrirOrcamentoChat,
    addOrcPhotos, renderOrcPhotos, removeOrcPhoto, enviarOrcamentoForm,
    toggleOrcOutros, sendOrc, openChat
  };
})();
