// modules/chat.js — feature "Chat" (sistema de chat completo) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
//
// IMPORTANTE: openChat(id) (linha ~4942 do app.js) NÃO mora aqui — pertence a
// modules/orcamento-form.js (era usado pela feature de orçamento e foi
// extraído antes). As variáveis chatStoreAdded/renderedMsgIds também moram
// lá. Esta camada cobre tudo o resto do sistema de chat:
//   - Filtros/abas da lista (chatTab, applyChatFilter)
//   - Display name / cache local (convDisplayName, getLocalConvKey,
//     getLocalMsgsKey, saveConvLocal, loadConvsLocal, saveMsgLocal,
//     loadMsgsLocal)
//   - Renderização da lista (loadChatList, renderConvList, _proLabel)
//   - Novo chat (_searchNewChatUsersImpl, searchNewChatUsers, startNewChat,
//     openChatConversation)
//   - Resolução de destinatário (getChatReceiverId)
//   - Realtime global (setupGlobalMsgSubscription, handleRealtimeMsg,
//     _markProcessed)
//   - Envio (sendChatMsg, sendMsg, handleChatAttachment)
//   - Renderização de mensagens (renderMessages, appendMsg, _msgKind,
//     _msgColors, _resetMsgColors)
//   - 3-way (addStoreToChat)
//
// Depende de globals do app.js / head.js:
//   currentUser, currentChat, chatData, getSupabase, requireSession,
//   handleSbError, toast, escapeHtml, escapeJsArg, stripEmail, cleanHandle,
//   avatarOf, avatarUrl, isProfessionalRole, showError, moderateContentAsync,
//   closeModals, debounce, maybeAutoReply, loadArchivedConvs, DB, calicolorsUserId
//
// NOTE etapa 1: a fonte da verdade ainda é o app.js. Esta cópia é só pra
// validar isolamento. Próximo PR remove os duplicados do app.js.
(function(){
  'use strict';

  // ══ CHAT TABS / FILTRO ══
  function chatTab(el){
    document.querySelectorAll('.chat-tab').forEach(t=>{t.classList.remove('active');});
    el.classList.add('active');
    applyChatFilter(el.dataset.filter || 'all');
  }

  function applyChatFilter(filter){
    document.querySelectorAll('#conv-list .conv-item').forEach(item => {
      const cats = (item.dataset.cat || '').split(' ');
      item.style.display = (filter === 'all' || cats.includes(filter)) ? '' : 'none';
    });
  }

  function convDisplayName(c){
    const nm = (c && c.name || '').trim();
    if(nm && !/^usu[aá]rio$/i.test(nm)) return nm;
    if(c && c.tag && c.tag.trim()) return '@' + c.tag.trim().replace(/^@/,'');
    const em = (c && c.email || '').trim();
    if(em) return em.split('@')[0];
    return 'Usuário';
  }

  // ══ LOCAL STORAGE CHAT PERSISTENCE ══
  // Cache em memória + flush debounced (300ms). Antes, cada mensagem em
  // realtime triggava read+parse+stringify+write síncronos (~5-10ms cada
  // em mobile). Em rajada de 10 msgs = 50-100ms travados na main thread.
  function getLocalConvKey(){
    return currentUser ? 'quc_convs_' + currentUser.id : null;
  }
  function getLocalMsgsKey(convId){
    return currentUser ? 'quc_msgs_' + currentUser.id + '_' + convId : null;
  }

  let _convsCache = null;     // dict completo de convs do usuário atual
  let _convsCacheUid = null;  // pra invalidar quando trocar de usuário
  let _convsDirty = false;
  let _convsFlushTimer = null;
  const _msgsCache = new Map(); // convId -> array de msgs
  const _msgsDirty = new Set();
  let _msgsFlushTimer = null;

  function _ensureConvsCache(){
    const uid = currentUser ? currentUser.id : null;
    if(_convsCache && _convsCacheUid === uid) return _convsCache;
    const key = getLocalConvKey();
    try { _convsCache = key ? (JSON.parse(localStorage.getItem(key) || '{}')) : {}; }
    catch(_){ _convsCache = {}; }
    _convsCacheUid = uid;
    return _convsCache;
  }

  function _flushConvs(){
    _convsFlushTimer = null;
    if(!_convsDirty) return;
    _convsDirty = false;
    const key = getLocalConvKey();
    if(!key || !_convsCache) return;
    try { localStorage.setItem(key, JSON.stringify(_convsCache)); }
    catch(e){ console.warn('flushConvs:', e && e.message); }
  }

  function _flushMsgs(){
    _msgsFlushTimer = null;
    if(!_msgsDirty.size) return;
    for(const convId of _msgsDirty){
      const key = getLocalMsgsKey(convId);
      if(!key) continue;
      try { localStorage.setItem(key, JSON.stringify(_msgsCache.get(convId) || [])); }
      catch(e){ console.warn('flushMsgs:', e && e.message); }
    }
    _msgsDirty.clear();
  }

  // Garante flush antes do usuário fechar / trocar de aba (pagehide é mais
  // confiável que beforeunload em mobile).
  window.addEventListener('pagehide', () => { _flushConvs(); _flushMsgs(); });
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden'){ _flushConvs(); _flushMsgs(); }
  });

  function saveConvLocal(convId, convMeta){
    if(!getLocalConvKey()) return;
    const all = _ensureConvsCache();
    all[convId] = { ...convMeta, updatedAt: new Date().toISOString() };
    _convsDirty = true;
    if(!_convsFlushTimer) _convsFlushTimer = setTimeout(_flushConvs, 300);
  }
  function loadConvsLocal(){
    return Object.assign({}, _ensureConvsCache());
  }
  function saveMsgLocal(convId, msg){
    if(!getLocalMsgsKey(convId)) return;
    let msgs = _msgsCache.get(convId);
    if(!msgs){
      const key = getLocalMsgsKey(convId);
      try { msgs = JSON.parse(localStorage.getItem(key) || '[]'); } catch(_){ msgs = []; }
      _msgsCache.set(convId, msgs);
    }
    const isDup = msgs.some(m => m.content === msg.content && m.time === msg.time && m.from === msg.from);
    if(isDup) return;
    msgs.push(msg);
    if(msgs.length > 100) msgs.splice(0, msgs.length - 100);
    _msgsDirty.add(convId);
    if(!_msgsFlushTimer) _msgsFlushTimer = setTimeout(_flushMsgs, 300);
  }
  function loadMsgsLocal(convId){
    let msgs = _msgsCache.get(convId);
    if(msgs) return msgs.slice();
    const key = getLocalMsgsKey(convId);
    if(!key) return [];
    try { msgs = JSON.parse(localStorage.getItem(key) || '[]'); } catch(_){ msgs = []; }
    _msgsCache.set(convId, msgs);
    return msgs.slice();
  }

  // ══ LOAD CHAT LIST (localStorage primary + Supabase background sync) ══
  async function loadChatList(){
    const container = document.getElementById('conv-list');
    if(!currentUser || !container) return;
    const myId = currentUser.id;
    loadArchivedConvs();

    // 1) Render from localStorage FIRST (instant)
    const localConvs = loadConvsLocal();
    renderConvList(container, localConvs, myId);

    // 2) Try Supabase in background to sync + merge
    const sb = getSupabase();
    if(!sb) return;

    // 2a) Caminho rápido: RPC agrega as conversas no Postgres (1 chamada).
    try {
      const { data: rows, error: rpcErr } = await sb.rpc('get_conversations');
      if(!rpcErr && Array.isArray(rows)){
        rows.forEach(r => {
          const convId = r.conv_id || r.other_id || '';
          if(!convId) return;
          const existing = localConvs[convId] || {};
          saveConvLocal(convId, {
            name: r.name || existing.name || '',
            avatar: r.avatar_url || existing.avatar || '',
            tag: r.tag || existing.tag || '',
            email: r.email || existing.email || '',
            role: r.role || r.user_type || existing.role || '',
            otherId: r.other_id,
            is3way: r.is3way || existing.is3way || false,
            lastMsg: r.last_msg || existing.lastMsg || '',
            lastMsgFrom: r.last_sender === myId ? 'me' : 'other',
            lastMsgTime: r.last_msg_time || existing.lastMsgTime || ''
          });
        });
        renderConvList(container, loadConvsLocal(), myId);
        return;
      }
      // RPC indisponível (função não criada ainda) → cai no método antigo
    } catch(e){ console.warn('get_conversations RPC indisponível, usando fallback:', e && e.message || e); }

    // 2b) Fallback legado (sem a RPC): busca mensagens e agrupa no cliente
    try {
      const [sentRes, recvRes] = await Promise.all([
        sb.from('messages').select('id, sender_id, receiver_id, conversation_id, content, type, created_at').eq('sender_id', myId).order('created_at',{ascending:false}).limit(100),
        sb.from('messages').select('id, sender_id, receiver_id, conversation_id, content, type, created_at').eq('receiver_id', myId).order('created_at',{ascending:false}).limit(100)
      ]);
      if(sentRes.error) console.warn('loadChatList sent err:', sentRes.error.message);
      if(recvRes.error) console.warn('loadChatList recv err:', recvRes.error.message);

      const allMsgs = [...(sentRes.data||[]), ...(recvRes.data||[])];
      const seen = new Set();
      const msgs = [];
      allMsgs.forEach(m => { if(!seen.has(m.id)){ seen.add(m.id); msgs.push(m); } });

      if(msgs.length > 0){
        // Group by conversation and save to localStorage
        const convGroups = {};
        msgs.forEach(m => {
          const otherId = m.sender_id === myId ? m.receiver_id : m.sender_id;
          const key = m.conversation_id || otherId || m.id;
          if(!convGroups[key]) convGroups[key] = { lastMsg: m, otherId, is3way: false };
          if(new Date(m.created_at) > new Date(convGroups[key].lastMsg.created_at)) convGroups[key].lastMsg = m;
          if(m.type === 'system' && m.content === '__STORE_ADDED__') convGroups[key].is3way = true;
        });

        // Fetch profiles
        const otherIds = [...new Set(Object.values(convGroups).map(c => c.otherId).filter(Boolean))];
        let profileMap = {};
        if(otherIds.length > 0){
          const profs = await DB.profiles.getMany(otherIds, 'id, name, avatar_url, role, user_type, tag, email');
          if(profs) profs.forEach(p => { profileMap[p.id] = p; });
        }

        // Merge into localStorage
        Object.entries(convGroups).forEach(([convId, cg]) => {
          const other = profileMap[cg.otherId] || {};
          const existing = localConvs[convId] || {};
          saveConvLocal(convId, {
            name: other.name || existing.name || '',
            avatar: other.avatar_url || existing.avatar || '',
            tag: other.tag || existing.tag || '',
            email: other.email || existing.email || '',
            role: other.role || other.user_type || existing.role || '',
            otherId: cg.otherId,
            is3way: cg.is3way || existing.is3way || false,
            lastMsg: cg.lastMsg.content || existing.lastMsg || '',
            lastMsgFrom: cg.lastMsg.sender_id === myId ? 'me' : 'other',
            lastMsgTime: cg.lastMsg.created_at || existing.lastMsgTime || ''
          });
        });

        // Re-render with merged data
        renderConvList(container, loadConvsLocal(), myId);
      }
    } catch(e){ console.warn('loadChatList supabase sync error:', e && e.message || e); }
  }

  function _proLabel(role){
    const r = (role||'').toLowerCase();
    if(/grafit/.test(r)) return 'Grafiteiro';
    if(/automotiv|funile/.test(r)) return 'Pintor Automotivo';
    if(/pintor/.test(r)) return 'Pintor';
    return 'Profissional';
  }

  function renderConvList(container, convMap, myId){
    const convList = Object.entries(convMap).sort((a,b) => new Date(b[1].updatedAt||0) - new Date(a[1].updatedAt||0));
    if(convList.length === 0){
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Sem conversas</div><div style="font-size:13px;">Suas mensagens aparecerão aqui</div></div>';
      return;
    }
    container.innerHTML = convList.map(([convId, c]) => {
      const name = convDisplayName(c);
      const avatar = c.avatar || avatarUrl(name);
      const isPintor = isProfessionalRole(c.role);
      const is3way = c.is3way || false;
      const isStore = !is3way && (
        (c.otherId && c.otherId === calicolorsUserId) ||
        /cali\s*colors?/i.test(c.name || '') ||
        /cali/i.test(c.tag || '') ||
        String(convId).startsWith('store_calicolors_')
      );
      const lowPrev = ((c.lastMsg||'') + ' ' + (c.name||'')).toLowerCase();
      const isOrcamento = /or[çc]ament/.test(lowPrev);
      const cats = ['all'];
      if(is3way) cats.push('trio');
      if(isStore) cats.push('store');
      if(isOrcamento) cats.push('orcamento');
      const preview = c.lastMsg || '';
      const isMine = c.lastMsgFrom === 'me';
      const time = c.lastMsgTime ? new Date(c.lastMsgTime).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';

      // Populate chatData so openChat() works
      if(!chatData[convId]){
        chatData[convId] = {
          type: is3way ? '3way' : 'direct',
          otherId: c.otherId || '',
          name: is3way ? name + ' + Cali Colors' : name,
          sub: is3way ? '3 participantes · Chat 3-way ativo' : (c.tag ? '@' + c.tag : ''),
          participants: is3way
            ? [{logo:true,name:'Cali Colors',role:'Loja Oficial'},{img:avatar,name:name,role:isPintor?_proLabel(c.role):'Cliente'}]
            : [{img:avatar,name:name,role:isPintor?_proLabel(c.role):'Cliente'}],
          messages: []
        };
      }
      const displayName = is3way ? name + ' + Cali Colors' : name;
      const storeAvatar = is3way
        ? '<div class="conv-av-store" style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center;border:2px solid var(--bg);z-index:2;"><span style="font-size:7px;font-weight:800;color:var(--p1);font-family:\'Syne\',sans-serif;">CC</span></div>'
        : '';
      const threewayBadge = is3way ? ' <span style="background:var(--ink);color:var(--p1);font-size:9px;padding:2px 6px;border-radius:10px;font-weight:700;">+ CALI</span>' : '';
      return '<div class="conv-item" data-cat="'+escapeHtml(cats.join(' '))+'" onclick="openChat(\''+escapeJsArg(convId)+'\')">'
        + '<div class="conv-avatars" style="position:relative;"><div class="conv-av-main"><img src="'+escapeHtml(avatar)+'" alt=""></div>'+storeAvatar+'</div>'
        + '<div class="conv-info"><div class="conv-name">'+escapeHtml(displayName)+threewayBadge+(isPintor && !is3way?' <span style="background:var(--p1);color:#fff;font-size:9px;padding:2px 6px;border-radius:10px;font-weight:700;">'+escapeHtml(_proLabel(c.role).toUpperCase())+'</span>':'')+'</div>'
        + '<div class="conv-preview">'+(isMine?'Voce: ':'')+escapeHtml(preview.substring(0,50))+'</div></div>'
        + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;"><div class="conv-time">'+time+'</div></div>'
        + '</div>';
    }).join('');
    const activeTab = document.querySelector('.chat-tab.active');
    applyChatFilter(activeTab ? (activeTab.dataset.filter || 'all') : 'all');
  }

  // ══ NEW CHAT MODAL ══
  const CALICOLORS_EMAIL = 'calicolortintas@gmail.com';

  let _searchNewChatToken = 0;
  async function _searchNewChatUsersImpl(query){
    const container = document.getElementById('new-chat-users-list');
    if(!query || query.trim().length < 2){ container.innerHTML = ''; return; }
    const sb = getSupabase();
    if(!sb) return;
    const myToken = ++_searchNewChatToken;
    try {
      const q = query.replace('@','').trim().toLowerCase();
      const res = await sb.from('profiles_public').select('id, name, tag, avatar_url, role, user_type').limit(200);
      if(myToken !== _searchNewChatToken) return; // resposta velha, ignora
      const all = res.data || [];
      const filtered = all.filter(p => {
        if(currentUser && p.id === currentUser.id) return false;
        const n = (p.name||'').toLowerCase();
        const t = (p.tag||'').toLowerCase();
        return n.includes(q) || t.includes(q);
      });
      if(filtered.length === 0){
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">Nenhum usuário encontrado</div>';
        return;
      }
      container.innerHTML = filtered.map(p => {
        const avatar = avatarOf(p);
        const isPintor = isProfessionalRole(p.role) || isProfessionalRole(p.user_type);
        return `<div onclick="startNewChat('${escapeJsArg(p.id)}')" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <img src="${escapeHtml(avatar)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">
          <div style="flex:1;"><div style="font-size:14px;font-weight:700;">${escapeHtml(p.name||'Sem nome')}</div><div style="font-size:12px;color:var(--muted);">${p.tag ? '@'+escapeHtml(p.tag) : ''}</div></div>
          ${isPintor ? '<span style="background:var(--ink);color:var(--p1);font-size:9px;font-weight:700;padding:3px 8px;border-radius:10px;">PINTOR</span>' : ''}
        </div>`;
      }).join('');
    } catch(e){ console.warn('searchNewChatUsers error:', e && e.message || e); }
  }
  const searchNewChatUsers = (window.debounce ? window.debounce(_searchNewChatUsersImpl, 250) : _searchNewChatUsersImpl);

  // Resolve o destinatário de uma conversa de forma confiável.
  // Antes o receiver_id era deduzido quebrando o conversation_id por "_",
  // o que falhava em chat com a loja/3-way (virava null e a mensagem não
  // era entregue). Agora usa o otherId guardado em chatData/localStorage,
  // cai para a loja em conversas store/3-way, e só por último faz o parse
  // antigo (compatível com conversas 1:1 uuidA_uuidB).
  function getChatReceiverId(convId, myId){
    if(!convId) return null;
    const cd = chatData[convId];
    if(cd && cd.otherId && cd.otherId !== myId) return cd.otherId;
    try {
      const lc = (typeof loadConvsLocal === 'function') ? (loadConvsLocal()[convId] || null) : null;
      if(lc && lc.otherId && lc.otherId !== myId) return lc.otherId;
    } catch(e){ console.warn('[other-id-from-local]', e && e.message); }
    if((cd && (cd.type === 'store' || cd.type === '3way')) || String(convId).startsWith('store_calicolors_')){
      if(calicolorsUserId && calicolorsUserId !== myId) return calicolorsUserId;
    }
    const uuidParts = String(convId).split('_').filter(p => p.includes('-'));
    return uuidParts.find(id => id !== myId) || null;
  }

  async function startNewChat(userId){
    closeModals();
    const ctx = requireSession('Faça login para enviar mensagens');
    if(!ctx) return;
    const sb = ctx.sb;

    if(userId === 'calicolors'){
      // Find or use Cali Colors user ID
      if(!calicolorsUserId){
        try {
          const { data } = await sb.from('profiles_public').select('id').eq('tag', 'calicolorstintas').limit(1);
          if(data && data.length > 0) calicolorsUserId = data[0].id;
        } catch(e){ console.warn('[calicolors-by-tag]', e && e.message); }
      }
      if(!calicolorsUserId){
        // Try finding by email as fallback
        try {
          const { data } = await sb.from('profiles_public').select('id').ilike('name', '%cali%').limit(1);
          if(data && data.length > 0) calicolorsUserId = data[0].id;
        } catch(e){ console.warn('[calicolors-by-name]', e && e.message); }
      }
      if(!calicolorsUserId){
        // Create a temporary store chat without DB user
        const convId = 'store_calicolors_' + currentUser.id;
        chatData[convId] = {
          type: 'store',
          name: 'Cali Colors Tintas',
          sub: '@calicolorstintas · Loja Oficial',
          participants: [{logo:true,name:'Cali Colors',role:'Loja Oficial'}],
          messages: [{from:'store',sender:'Cali Colors',text:'Ola! 👋 Bem-vindo a Cali Colors! Como posso ajudar?',time:new Date().getHours()+':'+(new Date().getMinutes()<10?'0':'')+new Date().getMinutes()}]
        };
        openChat(convId);
        return;
      }
      userId = calicolorsUserId;
    }

    // Open chat with this user
    const convId = [currentUser.id, userId].sort().join('_');
    chatData[convId] = chatData[convId] || {
      type: 'direct',
      name: 'Carregando...',
      sub: '',
      participants: [{img:'',name:'',role:''}],
      messages: []
    };
    chatData[convId].otherId = userId;

    // Load the other user's profile
    try {
      const { data: prof } = await sb.from('profiles_public').select('name, avatar_url, tag, role, user_type').eq('id', userId).single();
      if(prof){
        const name = prof.name || 'Usuário';
        chatData[convId].name = name;
        chatData[convId].sub = prof.tag ? '@' + prof.tag : '';
        chatData[convId].participants = [{
          img: avatarOf({ avatar_url: prof.avatar_url, name: name }),
          name: name,
          role: isProfessionalRole(prof.role||prof.user_type) ? ({pintor:'Pintor',grafiteiro:'Grafiteiro',automotivo:'Pintor Automotivo'}[prof.role||prof.user_type]||'Profissional') : 'Usuário'
        }];
      }
    } catch(e){ console.warn('[open-chat-with-user]', e && e.message); }

    openChat(convId);
  }

  // Bridge function for starting chat from profile.
  // Chamado por startChatWith (head.js) depois de showScreen('chat').
  // Mantido como impl separada pra evitar recursão com startChatWith.
  function openChatConversation(userId, userName){
    startNewChat(userId);
  }

  // ══ REALTIME GLOBAL MSG SUBSCRIPTION ══
  let _globalMsgSub = null;
  const _processedMsgIds = new Map(); // id -> true (Map preserves insertion order for LRU)
  const MAX_PROCESSED_IDS = 500;
  function _markProcessed(id){
    if(_processedMsgIds.has(id)){
      // already seen — refresh recency
      _processedMsgIds.delete(id);
      _processedMsgIds.set(id, true);
      return false;
    }
    _processedMsgIds.set(id, true);
    if(_processedMsgIds.size > MAX_PROCESSED_IDS){
      const oldest = _processedMsgIds.keys().next().value;
      _processedMsgIds.delete(oldest);
    }
    return true; // was new
  }
  let _chatListDebounce = null;

  // Global realtime subscription for messages - ensures new messages show up
  async function setupGlobalMsgSubscription(){
    if(_globalMsgSub) return;
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    try {
      const myId = currentUser.id;
      // Subscribe to messages where I'm the receiver (sent by others to me)
      // Also subscribe to messages I sent (for multi-device sync)
      _globalMsgSub = sb.channel('my-messages-' + myId)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'receiver_id=eq.' + myId
        }, handleRealtimeMsg)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'sender_id=eq.' + myId
        }, handleRealtimeMsg)
        .subscribe();
    } catch(e){ console.error('setupGlobalMsgSubscription error:', e && e.message || e); }
  }

  async function handleRealtimeMsg(payload){
    const m = payload.new;
    if(!m || !currentUser) return;
    // Dedup: a mesma mensagem pode chegar pelos dois filtros (receiver/sender)
    if(m.id){
      if(!_markProcessed(m.id)) return;
    }
    const myId = currentUser.id;
    const isMine = m.sender_id === myId;

    // Save incoming message to localStorage so it persists
    if(!isMine && m.type !== 'system'){
      const t = new Date(m.created_at || Date.now());
      const time = t.getHours()+':'+(t.getMinutes()<10?'0':'')+t.getMinutes();
      saveMsgLocal(m.conversation_id, { from:'other', content: m.content, type: m.type || 'text', time });

      if(m.type !== 'store') maybeAutoReply(m);

      // Ensure conversation exists in localStorage for the receiver
      const localConvs = loadConvsLocal();
      if(!localConvs[m.conversation_id]){
        // New conversation - fetch sender profile to populate it
        try {
          const sb = getSupabase();
          if(sb){
            const prof = await DB.profiles.getById(m.sender_id, 'id, name, avatar_url, role, user_type, tag, email');
            if(prof){
              saveConvLocal(m.conversation_id, {
                name: prof.name || '',
                avatar: prof.avatar_url || '',
                tag: prof.tag || '',
                email: prof.email || '',
                role: prof.role || prof.user_type || '',
                otherId: m.sender_id,
                is3way: false,
                lastMsg: m.content,
                lastMsgFrom: 'other',
                lastMsgTime: m.created_at || new Date().toISOString()
              });
              // Also populate chatData so openChat works immediately
              chatData[m.conversation_id] = {
                type: 'direct',
                otherId: m.sender_id,
                name: prof.name || 'Usuário',
                sub: prof.tag ? '@' + prof.tag : '',
                participants: [{img: prof.avatar_url || '', name: prof.name || 'Usuário', role: isProfessionalRole(prof.role) ? ({pintor:'Pintor',grafiteiro:'Grafiteiro',automotivo:'Pintor Automotivo'}[prof.role]||'Profissional') : 'Usuário'}],
                messages: []
              };
            }
          }
        } catch(e){ console.warn('handleRealtimeMsg profile fetch:', e && e.message || e); }
      } else {
        // Update existing conversation with latest message
        saveConvLocal(m.conversation_id, {
          ...localConvs[m.conversation_id],
          lastMsg: m.content,
          lastMsgFrom: 'other',
          lastMsgTime: m.created_at || new Date().toISOString()
        });
      }
    }

    // Atualiza a lista de chats só se a tela estiver visível, com debounce
    const chatScreen = document.getElementById('screen-chat');
    if(chatScreen && chatScreen.classList.contains('active')){
      clearTimeout(_chatListDebounce);
      _chatListDebounce = setTimeout(loadChatList, 400);
    }

    // If we're in this conversation, append the message
    if(currentChat && m.conversation_id === currentChat && !isMine && m.type !== 'system'){
      const t = new Date(m.created_at || Date.now());
      const time = t.getHours()+':'+(t.getMinutes()<10?'0':'')+t.getMinutes();
      if(m.type === 'store'){
        appendMsg({ id: m.id, from:'store', text: m.content, time, type: m.type, sender:'Cali Colors' });
      } else {
        // Fetch sender profile for correct name in 3-way
        let senderName = '', senderImg = '';
        try {
          const sb = getSupabase();
          const { data: sp } = await sb.from('profiles_public').select('name, avatar_url, portal_access').eq('id', m.sender_id).single();
          if(sp && sp.portal_access){
            appendMsg({ id: m.id, from:'store', text: m.content, time, type: m.type || 'text', sender:'Cali Colors' });
            return;
          }
          senderName = sp ? sp.name : '';
          senderImg = sp ? (sp.avatar_url || '') : '';
        } catch(e){ console.warn('[chat-sender-name]', e && e.message); }
        if(!senderName){
          const conv = chatData[currentChat];
          const otherPart = conv ? (conv.participants.find(p => !p.logo) || conv.participants[0]) : {};
          senderName = otherPart ? otherPart.name : '';
          senderImg = otherPart ? otherPart.img : '';
        }
        appendMsg({
          id: m.id,
          from: 'other',
          text: m.content,
          time,
          type: m.type || 'text',
          sender: senderName,
          img: senderImg
        });
      }
    }

    // Show notification if message is from someone else and we're NOT in that conversation
    if(!isMine && m.conversation_id !== currentChat && m.type !== 'system'){
      // Show badge dot on chat nav button
      const badge = document.getElementById('chat-badge-dot');
      if(badge) badge.style.display = 'block';

      // Show toast notification with sender name
      const conv = chatData[m.conversation_id];
      const localConvs = loadConvsLocal();
      const localConv = localConvs[m.conversation_id];
      const senderName = (conv && conv.name) || (localConv && localConv.name) || 'Alguém';
      const preview = m.content && m.content.length > 40 ? m.content.substring(0, 40) + '...' : (m.content || '');
      toast('💬 ' + senderName + ': ' + preview);
    }
  }

  // ══ SIMPLE CHAT (pintor↔cliente) ══
  async function sendChatMsg(){
    const inp=document.getElementById('chat-input-field');
    if(!inp)return;
    const msg=inp.value.trim();
    if(!msg)return;
    const mod = await moderateContentAsync(msg, null);
    if (!mod.approved) {
      inp.value = msg;  // devolve o texto
      toast('Mensagem bloqueada pela moderação');
      return;
    }
    const body=document.getElementById('chat-body');
    const typing=document.getElementById('chat-typing');
    const div=document.createElement('div');
    div.className='chat-msg sent';
    div.innerHTML='<div class="chat-bubble">'+escapeHtml(msg)+'</div><div class="chat-time">Voce · agora</div>';
    body.insertBefore(div,typing);
    inp.value='';
    body.scrollTop=body.scrollHeight;

    // Save to Supabase — só persiste no localStorage se o insert tiver sucesso
    const sb = getSupabase();
    if(sb && currentUser){
      try {
        const receiverId = getChatReceiverId(currentChat, currentUser.id);
        const insertData = {
          sender_id: currentUser.id,
          receiver_id: receiverId,
          conversation_id: currentChat,
          content: msg,
          type: 'text'
        };
        const { data: res, error } = await sb.from('messages').insert(insertData).select();
        if(error){
          showError('send-chat-msg', error, 'Não foi possível enviar a mensagem.');
          div.classList.add('failed');
          div.querySelector('.chat-time').textContent = 'Não enviada — toque para tentar';
          div.onclick = () => { div.remove(); inp.value = msg; sendChatMsg(); };
          return;
        }
        // sucesso → agora sim grava local
        if(currentChat){
          saveMsgLocal(currentChat, { from:'me', content: msg, time: new Date().toISOString() });
          const existing = loadConvsLocal()[currentChat] || {};
          saveConvLocal(currentChat, { ...existing, lastMsg: msg, lastMsgFrom: 'me', lastMsgTime: new Date().toISOString() });
        }
      } catch(e){
        console.error('sendChatMsg save error:', e && e.message || e);
        toast('Erro ao enviar mensagem');
        div.classList.add('failed');
        div.querySelector('.chat-time').textContent = 'Não enviada — toque para tentar';
        div.onclick = () => { div.remove(); inp.value = msg; sendChatMsg(); };
      }
    }
  }

  // ══ RENDERIZAÇÃO DE MENSAGENS ══
  function _msgKind(role){
    if(role==='loja') return { label:'LOJA', fg:'#7a30d6', chip:'#efe7fb', bub:'#f3edfb', bd:'#d9c7f5' };
    if(role==='profissional') return { label:'PROFISSIONAL', fg:'#d2541f', chip:'#fff1e8', bub:'#fff3ec', bd:'#f6d4bf' };
    return { label:'CLIENTE', fg:'#2563eb', chip:'#e8f0fe', bub:'#eef4ff', bd:'#cdddfb' };
  }

  // Cor do balao por PESSOA (cada participante uma cor estavel), nao por papel.
  const _msgMeColor    = { fg:'#0f9d6b', chip:'#dff5ec', bub:'#e7f8f1', bd:'#bfe8d7' };
  const _msgStoreColor = { fg:'#7a30d6', chip:'#efe7fb', bub:'#f3edfb', bd:'#d9c7f5' };
  const _msgPalette = [
    { fg:'#2563eb', chip:'#e8f0fe', bub:'#eef4ff', bd:'#cdddfb' }, // azul
    { fg:'#d2541f', chip:'#fff1e8', bub:'#fff3ec', bd:'#f6d4bf' }, // laranja
    { fg:'#be1e63', chip:'#fde8f1', bub:'#fef3f8', bd:'#f5c9dd' }, // rosa
    { fg:'#15803d', chip:'#e3f9ec', bub:'#ecfdf3', bd:'#b8e8cd' }, // verde
    { fg:'#a16207', chip:'#fdf6dd', bub:'#fffbeb', bd:'#f3e3a8' }, // amarelo
    { fg:'#4338ca', chip:'#e6ecff', bub:'#f0f5ff', bd:'#c7d2fe' }, // indigo
  ];
  let _msgColorMap = {};
  let _msgColorIdx = 0;
  function _resetMsgColors(){ _msgColorMap = {}; _msgColorIdx = 0; }
  function _msgColors(m){
    if(m.from==='me') return _msgMeColor;
    if(m.from==='store' || m.role==='loja') return _msgStoreColor;
    const key = String(m.sender || m.img || 'anon');
    if(!_msgColorMap[key]){
      _msgColorMap[key] = _msgPalette[_msgColorIdx % _msgPalette.length];
      _msgColorIdx++;
    }
    return _msgColorMap[key];
  }

  function renderMessages(msgs){
    const area = document.getElementById('msgs-area');
    area.innerHTML = msgs.map(m=>{
      const isImg = m.type === 'image' || (m.text && m.text.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i));
      const contentHtml = isImg
        ? '<img src="'+escapeHtml(m.text)+'" style="max-width:200px;border-radius:10px;display:block;" alt="foto">'
        : escapeHtml(m.text);
      const k = _msgKind(m.role);
      const c = _msgColors(m);
      const bubbleStyle = `background:${c.bub};color:var(--ink);border:1px solid ${c.bd};`;
      const tag = `<div class="msg-tag" style="color:${c.fg};background:${c.chip};">${escapeHtml(m.sender||k.label)} · ${k.label}</div>`;

      if(m.from==='me') return `
        <div class="msg-row me">
          <div class="msg-col">
            <div style="text-align:right;">${tag}</div>
            <div class="msg-bubble" style="${bubbleStyle}">${contentHtml}</div>
            <div class="msg-time">${m.time}</div>
          </div>
        </div>`;

      if(m.from==='store'){
        let extra='';
        if(m.product) extra=`
          <div class="chat-product" style="margin-top:8px;">
            <img src="https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300" alt="tinta">
            <div class="chat-product-info">
              <div class="chat-product-name">Terracota Premium — 3 opções</div>
              <div class="chat-product-price">A partir de R$89,90</div>
              <button class="chat-product-btn" onclick="toast('Abrindo catálogo Cali Colors 🎨')">Ver cores</button>
            </div>
          </div>`;
        if(m.product2) extra=`
          <div class="chat-product" style="margin-top:8px;">
            <img src="https://images.unsplash.com/photo-1562663474-6cbb3eaa4d14?w=300" alt="tinta">
            <div class="chat-product-info">
              <div class="chat-product-name">Areia Premium 18L</div>
              <div class="chat-product-price">R$189,90</div>
              <button class="chat-product-btn" onclick="toast('Adicionado ao carrinho! 🛒')">Comprar</button>
            </div>
          </div>`;
        return `
          <div class="msg-row">
            <div class="msg-av store-av">CC</div>
            <div class="msg-col">
              ${tag}
              <div class="msg-bubble" style="${bubbleStyle}">${isImg ? contentHtml : escapeHtml(m.text)}${extra}</div>
              <div class="msg-time">${m.time}</div>
            </div>
          </div>`;
      }

      return `
        <div class="msg-row">
          <div class="msg-av" style="background:${c.chip};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${c.fg};">${m.img ? '<img src="'+escapeHtml(m.img)+'" alt="">' : escapeHtml((m.sender||'?').charAt(0).toUpperCase())}</div>
          <div class="msg-col">
            ${tag}
            <div class="msg-bubble" style="${bubbleStyle}">${contentHtml}</div>
            <div class="msg-time">${m.time}</div>
          </div>
        </div>`;
    }).join('');
    setTimeout(()=>{ area.scrollTop = area.scrollHeight; }, 50);
  }

  async function sendMsg(){
    const input = document.getElementById('chat-input');
    const txt = input.value.trim();
    if(!txt) return;
    input.value='';

    const now = new Date();
    const time = now.getHours()+':'+(now.getMinutes()<10?'0':'')+now.getMinutes();

    // Show immediately (optimistic)
    const myName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.name) || currentUser?.email?.split('@')[0] || 'Eu';
    appendMsg({ from:'me', text: txt, time, sender: myName });

    // Save to Supabase
    const sb = getSupabase();
    if(!sb){ toast('Conexão indisponível. Tente de novo.'); return; }
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ toast('Sessão expirada. Faça login novamente.'); return; }

    const receiverId = getChatReceiverId(currentChat, session.user.id);

    const insertData = {
      sender_id: session.user.id,
      receiver_id: receiverId,
      conversation_id: currentChat,
      content: txt,
      type: 'text'
    };
    const { data: insertResult, error } = await sb.from('messages').insert(insertData).select();
    if(error){
      showError('send-msg', error, 'Não foi possível enviar a mensagem.');
      return;
    }
    // sucesso → grava no localStorage só agora
    if(currentChat){
      saveMsgLocal(currentChat, { from:'me', content: txt, time: new Date().toISOString() });
      const existing = loadConvsLocal()[currentChat] || {};
      saveConvLocal(currentChat, { ...existing, lastMsg: txt, lastMsgFrom: 'me', lastMsgTime: new Date().toISOString() });
    }
  }

  function appendMsg(m){
    // Prevent duplicate messages — usa o Set global renderedMsgIds (definido
    // em modules/orcamento-form.js, pois openChat — quem limpa o Set — vive lá).
    if(typeof renderedMsgIds !== 'undefined'){
      if(m.id && renderedMsgIds.has(m.id)) return;
      if(m.id) renderedMsgIds.add(m.id);
    }
    const area = document.getElementById('msgs-area');
    if(!area) return;

    const isImg = m.type === 'image' || (m.text && m.text.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i));
    const contentHtml = isImg
      ? '<img src="'+escapeHtml(m.text)+'" style="max-width:200px;border-radius:10px;display:block;" alt="foto">'
      : escapeHtml(m.text);

    const div = document.createElement('div');
    const k = _msgKind(m.role);
    const c = _msgColors(m);
    const bubbleStyle = `background:${c.bub};color:var(--ink);border:1px solid ${c.bd};`;
    const tag = `<div class="msg-tag" style="color:${c.fg};background:${c.chip};">${escapeHtml(m.sender||k.label)} · ${k.label}</div>`;
    if(m.from==='me'){
      div.className='msg-row me';
      div.innerHTML=`<div class="msg-col"><div style="text-align:right;">${tag}</div><div class="msg-bubble" style="${bubbleStyle}">${contentHtml}</div><div class="msg-time">${m.time}</div></div>`;
    } else if(m.from==='store'){
      div.className='msg-row';
      div.innerHTML=`<div class="msg-av store-av">CC</div><div class="msg-col">${tag}<div class="msg-bubble" style="${bubbleStyle}">${contentHtml}</div><div class="msg-time">${m.time}</div></div>`;
    } else {
      div.className='msg-row';
      div.innerHTML=`<div class="msg-av" style="background:${c.chip};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${c.fg};">${m.img ? '<img src="'+escapeHtml(m.img)+'" alt="">' : escapeHtml((m.sender||'?').charAt(0).toUpperCase())}</div><div class="msg-col">${tag}<div class="msg-bubble" style="${bubbleStyle}">${contentHtml}</div><div class="msg-time">${m.time}</div></div>`;
    }
    area.appendChild(div);
    area.scrollTop=area.scrollHeight;

    // Save received messages to localStorage too
    if(currentChat && m.from !== 'me'){
      saveMsgLocal(currentChat, { from: m.from, content: m.text, type: isImg ? 'image' : 'text', time: new Date().toISOString() });
      const localConvs = loadConvsLocal();
      const existing = localConvs[currentChat] || {};
      saveConvLocal(currentChat, { ...existing, lastMsg: isImg ? '📷 Foto' : (m.text||'').substring(0,50), lastMsgFrom: 'other', lastMsgTime: new Date().toISOString() });
    }
  }

  async function handleChatAttachment(input){
    const file = input.files[0];
    if(!file) return;
    input.value = '';
    const ctx = requireSession('Faça login primeiro');
    if(!ctx) return;
    const sb = ctx.sb;
    toast('Enviando imagem...');
    try {
      const ext = file.name.split('.').pop();
      // B4.4: user_id tem que ser o 1º segmento pra storage policy aceitar
      const path = currentUser.id + '/chat/' + Date.now() + '.' + ext;
      const { data, error } = await sb.storage.from('posts').upload(path, file, { upsert: true });
      if(error) throw error;
      const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
      const imgUrl = urlData.publicUrl;
      const now = new Date();
      const time = now.getHours()+':'+(now.getMinutes()<10?'0':'')+now.getMinutes();
      // Show image in chat
      const area = document.getElementById('msgs-area');
      const div = document.createElement('div');
      div.className = 'msg-row me';
      div.innerHTML = '<div><div class="msg-bubble"><img src="'+escapeHtml(imgUrl)+'" style="max-width:200px;border-radius:10px;display:block;" alt="foto"></div><div class="msg-time">'+escapeHtml(time)+'</div></div>';
      area.appendChild(div);
      area.scrollTop = area.scrollHeight;

      // Save to localStorage
      if(currentChat){
        saveMsgLocal(currentChat, { from:'me', content: imgUrl, type:'image', time: new Date().toISOString() });
        const localConvs = loadConvsLocal();
        const existing = localConvs[currentChat] || {};
        saveConvLocal(currentChat, { ...existing, lastMsg: '📷 Foto', lastMsgFrom: 'me', lastMsgTime: new Date().toISOString() });
      }

      // Save to DB
      const receiverId = getChatReceiverId(currentChat, currentUser.id);
      await sb.from('messages').insert({
        sender_id: currentUser.id,
        receiver_id: receiverId,
        conversation_id: currentChat,
        content: imgUrl,
        type: 'image'
      });
      toast('Imagem enviada!');
    } catch(e){
      console.error('handleChatAttachment error:', e && e.message || e);
      toast('Erro ao enviar imagem');
    }
  }

  // ══ ADD STORE TO CHAT (3-way) ══
  function addStoreToChat(){
    // chatStoreAdded vive em modules/orcamento-form.js (openChat zera ele),
    // então acessamos como global. Se ainda não existir (cenário improvável),
    // só seguimos em frente — o pior caso é mandar a msg duas vezes.
    if(typeof chatStoreAdded !== 'undefined' && chatStoreAdded) return;
    if(typeof chatStoreAdded !== 'undefined') chatStoreAdded = true;
    const conv=chatData[currentChat];
    conv.type='3way';
    conv.name=conv.name.includes('Cali Colors') ? conv.name : conv.name+' + Cali Colors';
    conv.sub='3 participantes · Chat 3-way ativo';
    if(!conv.participants.some(p => p.logo)){
      conv.participants.unshift({logo:true,name:'Cali Colors',role:'Loja Oficial'});
    }
    document.getElementById('chat-header-name').textContent = stripEmail(conv.name);
    document.getElementById('chat-header-sub').textContent=conv.sub;
    document.getElementById('invite-store-bar').style.display='none';

    // Update header avatars for 3-way
    const avatarsEl = document.getElementById('chat-header-avatars');
    const parts = conv.participants.slice(0,3);
    avatarsEl.innerHTML = parts.map((p,i)=>`
      <div class="cha-av" style="left:${i*10}px;z-index:${3-i}">
        ${p.logo
          ? '<div style="width:100%;height:100%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><span style="font-size:10px;font-weight:800;color:var(--p1);font-family:\'Syne\',sans-serif;">CC</span></div>'
          : '<img src="'+escapeHtml(p.img||'')+'" alt="'+escapeHtml(p.name||'')+'">'}
      </div>`).join('');
    avatarsEl.style.width=(parts.length*10+22)+'px';

    const partRow=document.getElementById('participant-row');
    partRow.style.display='flex';
    partRow.innerHTML=conv.participants.map(p=>`
      <div class="part-chip ${p.logo?'store':''}">
        ${p.logo?'<div style="width:22px;height:22px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><span style="font-size:8px;font-weight:800;color:var(--p1);font-family:\'Syne\',sans-serif;">CC</span></div>':'<img src="'+escapeHtml(p.img||'')+'" alt="'+escapeHtml(p.name||'')+'">'}
        <div><div class="part-chip-name">${escapeHtml(stripEmail(p.name))}</div><div class="part-chip-role">${escapeHtml(p.role||'')}</div></div>
      </div>`).join('');

    // APPEND store welcome message to existing messages (don't wipe!)
    const time=new Date().getHours()+':'+(new Date().getMinutes()<10?'0':'')+new Date().getMinutes();
    const storeText = 'Olá! 👋 Fui convidado para ajudar nesta conversa. Como posso auxiliar com tintas e materiais?';
    const area=document.getElementById('msgs-area');
    const div=document.createElement('div');
    div.className='msg-row';
    div.innerHTML='<div class="msg-av store-av">CC</div><div><div class="msg-sender" style="color:var(--p1);">Cali Colors</div><div class="msg-bubble store">'+storeText+'</div><div class="msg-time">'+time+'</div></div>';
    area.appendChild(div);
    area.scrollTop=area.scrollHeight;

    // Save 3-way status + store welcome message to DB
    (async()=>{
      const sb=getSupabase();
      const { data:{ session } } = await sb.auth.getSession();
      if(!session) return;
      const receiverId = getChatReceiverId(currentChat, session.user.id);
      // Save system marker so we know this is 3-way
      await sb.from('messages').insert({
        sender_id: session.user.id,
        receiver_id: receiverId,
        conversation_id: currentChat,
        content: '__STORE_ADDED__',
        type: 'system'
      });
      // Save the store welcome message
      await sb.from('messages').insert({
        sender_id: session.user.id,
        receiver_id: receiverId,
        conversation_id: currentChat,
        content: storeText,
        type: 'store'
      });
    })();

    toast('Cali Colors foi adicionada ao chat! 🎨');
  }

  window.Modules = window.Modules || {};
  window.Modules.chat = {
    // Tabs / filtro
    chatTab, applyChatFilter, convDisplayName,
    // Local storage helpers
    getLocalConvKey, getLocalMsgsKey,
    saveConvLocal, loadConvsLocal, saveMsgLocal, loadMsgsLocal,
    // Lista
    loadChatList, renderConvList, _proLabel,
    // Novo chat
    _searchNewChatUsersImpl, searchNewChatUsers, startNewChat, openChatConversation,
    getChatReceiverId,
    // Realtime
    setupGlobalMsgSubscription, handleRealtimeMsg, _markProcessed,
    // Envio
    sendChatMsg, sendMsg, handleChatAttachment,
    // Renderização
    renderMessages, appendMsg, _msgKind, _msgColors, _resetMsgColors,
    // 3-way
    addStoreToChat,
    // Constantes
    CALICOLORS_EMAIL
  };
})();
