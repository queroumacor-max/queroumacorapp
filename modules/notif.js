// modules/notif.js — feature "Notificações in-app" (sininho) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Ranges originais no app.js: 728-742 (notify), 3646-3728 (loadNotifications +
// updateNotifBadge), 3730-3785 (setupNotifSubscription + _notifSub).
// Depende de globals do app.js: getSupabase, currentUser, escapeHtml,
// avatarUrl, getTimeAgo, toast.
// IMPORTANTE: `window._notifSub` é referenciado em head.js (lines 600, 657
// no logout/cleanup) — mantemos como global, igual `_pipelineSub`.
(function(){
  'use strict';

  // Notificação in-app: cria uma linha em notifications para o usuário destino.
  async function notify(userId, type, title, body, refId){
    try {
      const sb = getSupabase();
      if(!sb || !currentUser || !userId || userId === currentUser.id) return;
      // Usa RPC notify_user (SECURITY DEFINER) que valida que caller e
      // destinatário compartilham quote/conversa — fecha spam in-app.
      await sb.rpc('notify_user', {
        p_user_id: userId,
        p_type:    type || 'info',
        p_title:   title || '',
        p_body:    body || '',
        p_ref_id:  refId || null
      });
    } catch(e){ console.warn('notify:', e && e.message || e); }
  }

  // ══ LOAD NOTIFICATIONS FROM SUPABASE ══
  async function loadNotifications(){
    const sb = getSupabase();
    const container = document.getElementById('notif-list');
    if(!sb || !currentUser || !container) return;
    // Mark as read: clear badge
    updateNotifBadge(false);
    // Skeleton enquanto carrega (5 rows de ~56px — altura de .notif-card).
    container.innerHTML = skeletonRows(5, { height: '56px' });
    try {
      const myId = currentUser.id;
      // Join server-side via PostgREST nested filter (posts!inner) em vez de
      // puxar TODOS os post IDs do usuário só pra alimentar .in(). Antes:
      // 1 query extra de "select id from posts where user_id = me" (~500 UUIDs
      // = ~18KB inútil pra conta ativa). Agora as queries de likes/comments
      // já filtram pelo dono do post no servidor.
      const queries = [
        sb.from('follows').select('id, follower_id, created_at, profiles:follower_id(name, avatar_url, tag)').eq('following_id', myId).order('created_at', { ascending: false }).limit(15),
        sb.from('announcements').select('id, title, message, created_at').eq('active', true).order('created_at', { ascending: false }).limit(5).then(r=>r).catch(()=>({data:[]})),
        sb.from('likes').select('id, user_id, post_id, created_at, posts!inner(user_id), profiles:user_id(name, avatar_url, tag)').eq('posts.user_id', myId).neq('user_id', myId).order('created_at', { ascending: false }).limit(20),
        sb.from('comments').select('id, user_id, post_id, text, created_at, posts!inner(user_id), profiles:user_id(name, avatar_url, tag)').eq('posts.user_id', myId).neq('user_id', myId).order('created_at', { ascending: false }).limit(20)
      ];
      const results = await Promise.all(queries);
      const [followsRes, announcementsRes, likesRes, commentsRes] = results;

      const notifs = [];
      (followsRes.data || []).forEach(f => {
        const p = f.profiles || {};
        notifs.push({ type:'follow', name: p.name||'Alguém', avatar: p.avatar_url, time: f.created_at, id: f.id });
      });
      ((likesRes||{}).data || []).forEach(l => {
        const p = l.profiles || {};
        notifs.push({ type:'like', name: p.name||'Alguém', avatar: p.avatar_url, time: l.created_at, id: 'l'+l.id });
      });
      ((commentsRes||{}).data || []).forEach(c => {
        const p = c.profiles || {};
        notifs.push({ type:'comment', name: p.name||'Alguém', avatar: p.avatar_url, text: c.text, time: c.created_at, id: 'c'+c.id });
      });
      (announcementsRes.data || []).forEach(a => {
        notifs.push({ type:'announcement', name: 'QueroUmaCor', title: a.title, message: a.message, time: a.created_at, id: a.id });
      });
      try {
        const { data: notifRows } = await sb.from('notifications')
          .select('*').eq('user_id', myId).order('created_at', { ascending:false }).limit(20);
        (notifRows || []).forEach(nr => {
          notifs.push({ type:'app', appType:nr.type, name:nr.title||'QueroUmaCor', text:nr.body, time:nr.created_at, id:'n'+nr.id });
        });
      } catch(e){ /* tabela notifications pode não existir ainda */ }
      notifs.sort((a,b) => new Date(b.time) - new Date(a.time));
      if(notifs.length === 0){
        container.innerHTML = emptyState({
          icon: '🔔',
          title: 'Sem notificações',
          message: 'Você está em dia. Curtidas, comentários e mensagens aparecem aqui.'
        });
        return;
      }
      container.innerHTML = notifs.map(n => {
        const timeAgo = getTimeAgo(n.time);
        if(n.type === 'announcement'){
          return '<div class="notif-card" style="background:linear-gradient(135deg,rgba(255,107,53,.08),rgba(255,107,53,.02));border-left:3px solid var(--p1);">'
            + '<div class="notif-av" style="background:var(--p1);border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="font-size:18px;">📢</span></div>'
            + '<div class="notif-txt"><b>'+escapeHtml(n.title||'Aviso')+'</b><br><span style="font-size:12px;color:#555;">'+escapeHtml(n.message||'')+'</span></div>'
            + '<div class="notif-time">'+timeAgo+'</div></div>';
        }
        if(n.type === 'app'){
          const icon = n.appType==='quote_approved' ? '🎉' : (n.appType==='quote_sent' ? '📄' : '🔔');
          return '<div class="notif-card">'
            + '<div class="notif-av" style="background:var(--ink);border-radius:10px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="font-size:18px;">'+icon+'</span></div>'
            + '<div class="notif-txt"><b>'+escapeHtml(n.name)+'</b>'+(n.text?'<br><span style="font-size:12px;color:#555;">'+escapeHtml(n.text)+'</span>':'')+'</div>'
            + '<div class="notif-time">'+timeAgo+'</div></div>';
        }
        const avatar = n.avatar || avatarUrl(n.name);
        let text = '';
        if(n.type === 'follow')   text = '<b>'+escapeHtml(n.name)+'</b> começou a te seguir.';
        else if(n.type === 'like') text = '<b>'+escapeHtml(n.name)+'</b> curtiu seu post. 🖌️';
        else if(n.type === 'comment') text = '<b>'+escapeHtml(n.name)+'</b> comentou: <i>'+escapeHtml((n.text||'').slice(0,60))+'</i>';
        return '<div class="notif-card"><div class="notif-av"><img src="'+escapeHtml(avatar)+'" alt=""></div><div class="notif-txt">'+text+'</div><div class="notif-time">'+timeAgo+'</div></div>';
      }).join('');
    } catch(e){
      console.error('loadNotifications error:', e && e.message || e);
      container.innerHTML = errorState(
        'Não foi possível carregar as notificações. Tente de novo.',
        () => loadNotifications()
      );
    }
  }

  function updateNotifBadge(show){
    const dot = document.getElementById('notif-badge-dot');
    if(!dot) return;
    dot.style.display = show ? 'block' : 'none';
  }

  // `_notifSub` é referenciado em head.js (logout/cleanup) — mantemos global.
  async function setupNotifSubscription(){
    if(window._notifSub || !currentUser) return;
    const sb = getSupabase();
    if(!sb) return;
    const myId = currentUser.id;
    // Cache lazy de post IDs próprios: só carrega na 1ª curtida/comentário
    // que chegar (raro). Antes baixava TODOS os IDs no boot pra todo mundo.
    // _myPostIdsInflight dedupa rajada de eventos (3 likes em sequência não
    // disparam 3 SELECTs paralelos).
    let _myPostIds = null;
    let _myPostIdsAt = 0;
    let _myPostIdsInflight = null;
    async function _ownsPost(postId){
      if(!_myPostIds || Date.now() - _myPostIdsAt > 60000){
        if(!_myPostIdsInflight){
          _myPostIdsInflight = sb.from('posts').select('id').eq('user_id', myId)
            .then(({ data }) => {
              _myPostIds = new Set((data || []).map(p => p.id));
              _myPostIdsAt = Date.now();
              _myPostIdsInflight = null;
              return _myPostIds;
            })
            .catch(e => { _myPostIdsInflight = null; throw e; });
        }
        try { await _myPostIdsInflight; } catch(_){ return false; }
      }
      return _myPostIds.has(postId);
    }

    window._notifSub = sb.channel('notif-'+myId)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'likes' }, async payload => {
        const l = payload.new;
        if(!l || l.user_id === myId) return;
        if(!await _ownsPost(l.post_id)) return;
        updateNotifBadge(true);
        toast('🖌️ Alguém curtiu seu post!');
      })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'comments' }, async payload => {
        const c = payload.new;
        if(!c || c.user_id === myId) return;
        if(!await _ownsPost(c.post_id)) return;
        updateNotifBadge(true);
        toast('💬 Alguém comentou no seu post!');
      })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'follows', filter:'following_id=eq.'+myId }, payload => {
        updateNotifBadge(true);
        toast('👤 Alguém começou a te seguir!');
      })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:'user_id=eq.'+myId }, payload => {
        const n = payload.new || {};
        updateNotifBadge(true);
        toast('🔔 ' + (n.title || 'Nova notificação'));
      })
      .subscribe();
  }

  // ══ EVENTS WIRING — post.liked + auth.logged_out ══
  // post.liked: cria notificação in-app pro autor do post (notify() chama a
  //   RPC notify_user com SECURITY DEFINER). Não substitui a curtida em si,
  //   só notifica. Skip se o curtidor é o próprio dono.
  // auth.logged_out: limpa o badge + desinscreve o realtime channel.
  //   Cleanup direto no head.js (linhas ~657) permanece como fallback
  //   durante rollout — eventos são aditivos.
  if(window.Events){
    window.Events.on('post.liked', async function(p){
      try {
        if(!p || !p.postOwnerId || !p.likedByUserId) return;
        if(p.postOwnerId === p.likedByUserId) return;
        await notify(p.postOwnerId, 'like', 'curtiu seu post', '', p.postId || null);
      } catch(e){ console.warn('[events] post.liked handler:', e && e.message); }
    });
    window.Events.on('auth.logged_out', function(){
      try { updateNotifBadge(false); } catch(_){}
      if(window._notifSub){
        try { window._notifSub.unsubscribe(); } catch(_){}
        window._notifSub = null;
      }
    });
  }

  window.Modules = window.Modules || {};
  window.Modules.notif = { notify, loadNotifications, updateNotifBadge, setupNotifSubscription };
})();
