// modules/feed.js — feature "Feed" (timeline principal) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada; próximo PR
// migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, DB, withTimeout,
// reportError, escapeHtml, escapeJsArg, getTimeAgo, isVideoUrl, cfImg,
// avatarImgTag, loadStories, filterFeedPosts (auto), observeFeedVideos
// (auto), buildFeedPostHTML (auto).
//
// State guardado dentro do IIFE (sem leitura de outros módulos):
//   _lastFeedLoad, _feedRoleFilter, _feedOffset, _followingIdsCache,
//   _followingIdsCacheTime, _feedMuted, _feedVideoObserver, _obsVideos.
// Obs: `_lastFeedLoad` é lido pelo router de telas em app.js (linha 69) —
// quando migrar call sites, esse ponto vira `window.Modules.feed.shouldReload()`
// ou similar. Por enquanto o app.js segue com a cópia original.
(function(){
  'use strict';

  // ══ FEED — estado interno ══
  let _lastFeedLoad = 0;
  let _feedRoleFilter = '';
  let _feedOffset = 0;
  const FEED_PAGE = 30;
  const POST_COLS = 'id, user_id, caption, media_url, media_type, status, for_sale, price, art_type, created_at';

  // ══ FOLLOWING IDS — cache (compartilhado com a feature feed) ══
  let _followingIdsCache = null;
  let _followingIdsCacheTime = 0;

  // ══ AUTOPLAY DE VÍDEOS NO FEED (estilo Instagram) ══
  let _feedMuted = true;
  let _feedVideoObserver = null;
  let _obsVideos = new WeakSet();

  function setFeedFilter(btn, role){
    _feedRoleFilter = role;
    document.querySelectorAll('.feed-filter').forEach(b=>{
      b.style.background = '#fff'; b.style.color = 'var(--ink)'; b.style.borderColor = 'var(--border)';
      b.classList.remove('active');
    });
    btn.style.background = 'var(--ink)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--ink)';
    btn.classList.add('active');
    // Re-filter posts without reloading from DB
    filterFeedPosts();
  }

  function filterFeedPosts(){
    const posts = document.querySelectorAll('#feed-posts-area .mpost');
    posts.forEach(p=>{
      if(!_feedRoleFilter){ p.style.display = ''; return; }
      const role = p.dataset.authorRole || '';
      p.style.display = (role === _feedRoleFilter) ? '' : 'none';
    });
  }

  // Busca perfis públicos com fallback: tenta profiles_public (view) primeiro;
  // se a view não existir/retornar vazio (acontece em DBs que não rodaram a
  // migration), cai pra tabela profiles direto — que tem RLS "viewable by
  // everyone" e expõe as mesmas colunas seguras.
  async function fetchPublicProfiles(sb, ids, cols){
    cols = cols || 'id, name, tag, avatar_url, role, user_type';
    if(!ids || !ids.length) return [];
    try {
      const r = await sb.from('profiles_public').select(cols).in('id', ids);
      if(!r.error && r.data && r.data.length > 0) return r.data;
      if(r.error) console.warn('profiles_public falhou, fallback p/ profiles:', r.error.message);
      const fb = await sb.from('profiles').select(cols).in('id', ids);
      if(fb.error) { console.warn('profiles fallback err:', fb.error.message); return []; }
      return fb.data || [];
    } catch(e){
      console.warn('fetchPublicProfiles:', e && e.message || e);
      return [];
    }
  }

  // ─── Cache do feed (stale-while-revalidate) ────────────────────────────────
  // Guarda DADOS compactos (JSON), não HTML, e grava fora do main thread
  // (requestIdleCallback) pra não travar a rolagem como o cache antigo de
  // ~400KB de HTML. Chave por usuário; expira em 1h. O próximo load do feed
  // pinta instantâneo daqui e revalida em background.
  function _feedCacheKey(){ return 'feedCache_v3_' + (currentUser ? currentUser.id : 'anon'); }

  function paintFeedFromCache(){
    try {
      const raw = localStorage.getItem(_feedCacheKey());
      if(!raw) return false;
      const c = JSON.parse(raw);
      if(!c || !Array.isArray(c.posts) || c.posts.length === 0) return false;
      if(Date.now() - (c.ts || 0) > 3600000) return false; // > 1h: velho demais
      const container = document.getElementById('feed-posts-area');
      if(!container) return false;
      const profMap = c.profMap || {};
      c.posts.forEach(p => { p.profiles = profMap[p.user_id] || p.profiles || {}; });
      const ctx = { profMap, myLikes: c.myLikes || [], likeCounts: c.likeCounts || {}, savedPosts: c.savedPosts || [], commentsMap: c.commentsMap || {} };
      container.innerHTML = c.posts.map(p => buildFeedPostHTML(p, ctx)).join('');
      const emptyEl = document.getElementById('feed-empty');
      if(emptyEl) emptyEl.style.display = 'none';
      if(typeof observeFeedVideos === 'function') observeFeedVideos(true);
      if(typeof filterFeedPosts === 'function') filterFeedPosts();
      return true;
    } catch(e){ console.warn('[feed-cache-read]', e && e.message); return false; }
  }

  function scheduleFeedCacheSave(posts, profMap, enrich){
    enrich = enrich || {};
    const doSave = () => {
      try {
        // posts sem .profiles (rehidratados do profMap no paint) pra encolher.
        const slim = posts.map(p => { const o = Object.assign({}, p); delete o.profiles; return o; });
        const obj = { v: 3, ts: Date.now(), posts: slim, profMap: profMap || {},
          myLikes: enrich.myLikes || [], likeCounts: enrich.likeCounts || {},
          savedPosts: enrich.savedPosts || [], commentsMap: enrich.commentsMap || {} };
        const json = JSON.stringify(obj);
        if(json.length > 300000) return; // grande demais — não cacheia (evita quota)
        localStorage.setItem(_feedCacheKey(), json);
      } catch(e){ console.warn('[feed-cache-write]', e && e.message); /* quota/serialize — ignora */ }
    };
    if(typeof requestIdleCallback === 'function') requestIdleCallback(doSave, { timeout: 2000 });
    else setTimeout(doSave, 300);
  }

  async function loadFeed(){
    _lastFeedLoad = Date.now();
    // O cache v2 guardava ~400KB de HTML e engasgava o main thread no
    // setItem/getItem síncrono. Foi substituído pelo v3 (paintFeedFromCache),
    // que guarda DADOS compactos e grava via requestIdleCallback. Limpamos as
    // chaves v2 legadas pra liberar quota (storage cap em iOS Safari).
    try {
      const uid = currentUser ? currentUser.id : 'anon';
      localStorage.removeItem('feedCache_v2_' + uid);
      localStorage.removeItem('storiesCache_v2_' + uid);
    } catch(e){ console.warn('[clear-feed-cache]', e && e.message); }
    // Stale-while-revalidate: pinta o feed da última visita INSTANTANEAMENTE
    // (do cache compacto) e revalida em background logo abaixo. Se pintou, o
    // usuário já vê conteúdo — não mostramos skeleton nem "conexão lenta".
    const paintedFromCache = paintFeedFromCache();
    // Após 5s sem renderizar nada, adiciona um aviso "conexão lenta" no
    // skeleton pra reduzir ansiedade. Cancelado quando o feed carrega ou
    // quando o retry-UI substitui. Pulado se já pintamos do cache.
    const slowHint = paintedFromCache ? null : setTimeout(() => {
      const container = document.getElementById('feed-posts-area');
      if(container && container.querySelector('.skel-post') && !container.querySelector('.feed-slow-hint')){
        const hint = document.createElement('div');
        hint.className = 'feed-slow-hint';
        hint.style.cssText = 'text-align:center;padding:14px;color:var(--muted);font-size:12px;font-style:italic;';
        hint.textContent = 'Conexão lenta — aguardando o servidor responder…';
        container.insertBefore(hint, container.firstChild);
      }
    }, 5000);
    const t0 = Date.now();
    try {
      // Fetch followingIds once, share with both
      const feedIds = await (typeof withTimeout === 'function'
        ? withTimeout(getFollowingIds(), 10000, 'followingIds').catch(e => {
            if(typeof reportError === 'function') reportError({ type:'feed-step-timeout', ctx:'followingIds', msg: e && e.message });
            console.warn('followingIds:', e && e.message);
            return currentUser ? [currentUser.id] : [];
          })
        : getFollowingIds());
      await (typeof withTimeout === 'function'
        ? withTimeout(Promise.all([loadStories(feedIds), loadPosts(feedIds, false, paintedFromCache)]), 15000, 'loadFeed')
        : Promise.all([loadStories(feedIds), loadPosts(feedIds, false, paintedFromCache)]));
      if(slowHint) clearTimeout(slowHint);
      const elapsed = Date.now() - t0;
      if(elapsed > 5000 && typeof reportError === 'function'){
        // Carregou mas demorou — sinal de query slow ou rede ruim. Logar.
        reportError({ type:'feed-slow', ctx: elapsed + 'ms / ' + document.querySelectorAll('#feed-posts-area .mpost').length + ' posts' });
      }
    } catch(e){
      if(slowHint) clearTimeout(slowHint);
      const elapsed = Date.now() - t0;
      console.warn('loadFeed timeout/erro (' + elapsed + 'ms):', e && e.message || e);
      if(typeof reportError === 'function'){
        reportError({ type:'feed-fail', ctx: elapsed + 'ms', msg: e && e.message || String(e) });
      }
      // Se já pintamos do cache, o usuário tem conteúdo — não troca por erro.
      if(!paintedFromCache) renderFeedRetry();
    }
  }

  // Mostra estado de erro no lugar do skeleton quando o feed não carrega
  // (timeout de 15s, rede caiu, Supabase fora do ar etc.). O botão chama
  // loadFeed() de novo e re-injeta o skeleton enquanto tenta.
  function renderFeedRetry(){
    const container = document.getElementById('feed-posts-area');
    if(!container) return;
    // Se já renderizou posts, não mexe — só age quando ainda está no skeleton.
    if(container.querySelector('.mpost')) return;
    container.innerHTML =
      '<div style="text-align:center;padding:60px 24px;color:var(--muted);">'
      + '<div style="font-size:42px;margin-bottom:10px;">🌐</div>'
      + '<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Não conseguimos carregar o feed</div>'
      + '<div style="font-size:13px;margin-bottom:16px;">Verifique sua conexão e tente de novo.</div>'
      + '<button onclick="retryLoadFeed(this)" style="padding:10px 22px;background:var(--ink);color:#fff;border:none;border-radius:20px;font-size:13px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Tentar de novo</button>'
      + '</div>';
  }

  function retryLoadFeed(btn){
    if(btn){ btn.textContent = 'Carregando...'; btn.disabled = true; }
    const container = document.getElementById('feed-posts-area');
    if(container){
      container.innerHTML =
        '<div class="skel-post"><div class="skel-row"><div class="skel skel-circle"></div><div style="flex:1"><div class="skel skel-line" style="width:40%"></div></div></div><div class="skel skel-img"></div><div class="skel skel-line" style="width:60%;margin-bottom:8px"></div><div class="skel skel-line" style="width:30%"></div></div>'
        + '<div class="skel-post"><div class="skel-row"><div class="skel skel-circle"></div><div style="flex:1"><div class="skel skel-line" style="width:50%"></div></div></div><div class="skel skel-img"></div><div class="skel skel-line" style="width:45%;margin-bottom:8px"></div><div class="skel skel-line" style="width:25%"></div></div>';
    }
    _lastFeedLoad = 0;
    loadFeed();
  }

  // Invalidar via invalidateFollowingIds() depois de seguir/desfollow.
  function invalidateFollowingIds(){ _followingIdsCache = null; _followingIdsCacheTime = 0; }

  async function getFollowingIds(){
    if(_followingIdsCache && Date.now() - _followingIdsCacheTime < 60000) return _followingIdsCache;
    if(!currentUser) return [];
    try {
      // Fase 1 da refatoração: query agora via DB.follows.listFollowingIds.
      const ids = await DB.follows.listFollowingIds(currentUser.id);
      ids.push(currentUser.id);
      _followingIdsCache = ids;
      _followingIdsCacheTime = Date.now();
      return ids;
    } catch(e) {
      console.warn('getFollowingIds error:', e && e.message || e);
      return [currentUser.id];
    }
  }

  function _feedVolIcon(muted){
    return muted
      ? '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  }

  function toggleFeedVideoMute(btn){
    _feedMuted = !_feedMuted;
    document.querySelectorAll('#feed-posts-area .feed-video').forEach(v => { v.muted = _feedMuted; });
    document.querySelectorAll('#feed-posts-area .feed-video-mute').forEach(b => { b.innerHTML = _feedVolIcon(_feedMuted); });
  }

  function toggleFeedVideoPlay(video){
    if(video.paused){ const pr = video.play(); if(pr) pr.catch(()=>{}); }
    else video.pause();
  }

  function observeFeedVideos(reset){
    if(!('IntersectionObserver' in window)) return;
    if(!_feedVideoObserver){
      _feedVideoObserver = new IntersectionObserver(entries => {
        entries.forEach(en => {
          const v = en.target;
          if(en.isIntersecting && en.intersectionRatio >= 0.55){
            v.muted = _feedMuted;
            const pr = v.play(); if(pr) pr.catch(()=>{});
          } else {
            v.pause();
          }
        });
      }, { threshold: [0, 0.55, 1] });
    }
    if(reset){ _feedVideoObserver.disconnect(); _obsVideos = new WeakSet(); }
    document.querySelectorAll('#feed-posts-area .feed-video').forEach(v => {
      if(_obsVideos.has(v)) return;
      _obsVideos.add(v);
      v.muted = _feedMuted;
      _feedVideoObserver.observe(v);
    });
  }

  // Monta o HTML de um post do feed. Extraído do loop de loadPosts pra ser
  // reaproveitado tanto no render progressivo quanto no paint do cache.
  // ctx = { myLikes, likeCounts, savedPosts, commentsMap, profMap }
  function buildFeedPostHTML(p, ctx){
    ctx = ctx || {};
    const myLikes = ctx.myLikes || [];
    const likeCounts = ctx.likeCounts || {};
    const savedPosts = ctx.savedPosts || [];
    const commentsMap = ctx.commentsMap || {};
    const profMap = ctx.profMap || {};
    let html = '';
        const prof = p.profiles || {};
        let name = prof.name || (prof.tag ? '@' + prof.tag : 'Usuário');
        if(name.includes('@') && !prof.tag) name = name.split('@')[0];
        const tag = prof.tag ? '@' + prof.tag : '';
        const time = getTimeAgo(p.created_at);
        const caption = p.caption || '';
        const liked = myLikes.includes(p.id);
        const saved = savedPosts.includes(p.id);
        const isVideo = !!p.media_url && (isVideoUrl(p.media_url) || p.media_type === 'video');
        const mediaSrc = escapeHtml(p.media_url || ''); // <video src> mantém raw (CF Image só serve imagens)
        const mediaImgSrc = p.media_url && !isVideo ? escapeHtml(cfImg(p.media_url, { w: 500 })) : mediaSrc;
        // preload="metadata": só baixa o cabeçalho (~50KB). O play é disparado
        // pelo IntersectionObserver quando o post entra em vista (observeFeedVideos).
        // Antes era preload="auto" que baixava 5-30MB POR vídeo no DOM, mesmo sem rolar.
        const imgHtml = p.media_url ? (isVideo ? '<div class="feed-video-wrap" style="position:relative;width:100%;background:#000;aspect-ratio:1/1;"><video class="feed-video" src="'+mediaSrc+'" muted loop playsinline preload="metadata" onclick="toggleFeedVideoPlay(this)" style="width:100%;height:100%;display:block;object-fit:cover;"></video><button class="feed-video-mute" onclick="event.stopPropagation();toggleFeedVideoMute(this)" aria-label="Som" style="position:absolute;right:10px;bottom:10px;width:34px;height:34px;border-radius:50%;border:none;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">'+_feedVolIcon(true)+'</button></div>' : '<img src="'+mediaImgSrc+'" alt="" loading="lazy" onerror="if(this.dataset.fb!==\'1\'){this.dataset.fb=\'1\';this.src=\''+mediaSrc+'\'}" style="width:100%;display:block;object-fit:cover;aspect-ratio:1/1;">') : '';
        const likeCount = likeCounts[p.id] || 0;
        const brushFill = liked ? 'var(--p4)' : 'none';
        const brushStroke = liked ? 'var(--p4)' : 'var(--ink)';
        const paletteFill = saved ? 'var(--p1)' : 'none';
        const paletteStroke = saved ? 'var(--p1)' : 'var(--ink)';

        html += '<div class="mpost" data-post-id="'+escapeHtml(p.id)+'" data-author-role="'+escapeHtml(prof.role||'')+'">';
        html += '<div class="mpost-head">';
        html += '<div class="av-ring"><div class="av-inner">'+avatarImgTag(prof, 96)+'</div></div>';
        html += '<div class="post-meta"><span class="post-uname">'+escapeHtml(name)+'</span>';
        if(tag) html += ' <span class="post-city">'+escapeHtml(tag)+'</span>';
        html += '</div>';
        html += '<span class="post-dots" onclick="event.stopPropagation();openPostOpts(\''+escapeJsArg(p.id)+'\',\''+escapeJsArg(p.user_id)+'\')">···</span>';
        html += '</div>';
        if(imgHtml) html += '<div class="ba-wrap" style="position:relative;">'+imgHtml
          +(p.for_sale?'<div style="position:absolute;top:12px;right:12px;background:linear-gradient(135deg,#8338ec,var(--p1));color:#fff;font-size:11px;font-weight:800;padding:5px 12px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.3);">🖼️ À VENDA · R$ '+(p.price||0).toLocaleString('pt-BR')+'</div>':'')
          +'</div>';
        html += '<div class="mpost-actions">';
        // Pincel (like)
        html += '<button class="act-btn" onclick="togglePostLike(this)">'
          +'<svg viewBox="0 0 24 24" style="fill:'+brushFill+';stroke:'+brushStroke+';">'
          +'<path d="M3 22v-3.5l10.5-10.5 3 3L6.5 22H3z"/>'
          +'<path d="m15 6 3-3a2.12 2.12 0 0 1 3 3l-3 3-3-3z"/>'
          +'</svg>'
          +'<span class="act-label">Curtir'+(likeCount>0?' · '+likeCount:'')+'</span>'
          +'</button>';
        // Comentar
        html += '<button class="act-btn" onclick="toggleCommentInput(this)">'
          +'<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
          +'<span class="act-label">Comentar</span>'
          +'</button>';
        // Compartilhar (seta)
        html += '<button class="act-btn" onclick="sharePost(\''+escapeJsArg(p.id)+'\')">'
          +'<svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>'
          +'<span class="act-label">Compartilhar</span>'
          +'</button>';
        // Orçamento (qualquer post que não seja o seu próprio)
        if(!currentUser || p.user_id !== currentUser.id){
          html += '<button class="act-btn" onclick="abrirOrcamentoChat(\''+escapeJsArg(p.user_id)+'\',\''+escapeJsArg(name)+'\')">'
            +'<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
            +'<span class="act-label">Orçar</span>'
            +'</button>';
        }
        // Salvar (paleta)
        html += '<button class="act-btn save-btn" onclick="toggleSavePost(this)" style="margin-left:auto">'
          +'<svg viewBox="0 0 24 24" style="fill:'+paletteFill+';stroke:'+paletteStroke+';"><circle cx="12" cy="12" r="10"/><circle cx="8" cy="9" r="1.5" fill="var(--p4)" stroke="none"/><circle cx="15" cy="8" r="1.5" fill="var(--p5)" stroke="none"/><circle cx="16" cy="13" r="1.5" fill="var(--p3)" stroke="none"/><circle cx="9" cy="14" r="1.5" fill="var(--p1)" stroke="none"/></svg>'
          +'<span class="act-label">Salvar</span>'
          +'</button>';
        html += '</div>';
        if(likeCount > 0) html += '<div style="padding:0 14px 2px;font-size:12px;font-weight:700;color:var(--ink);">'+likeCount+' curtida'+(likeCount>1?'s':'')+'</div>';
        if(caption) html += '<div class="post-cap"><b>'+escapeHtml(name)+'</b> '+escapeHtml(caption)+'</div>';
        // Render persisted comments
        const postComments = commentsMap[p.id] || [];
        if(postComments.length > 0){
          html += '<div class="comments-area" style="padding:4px 14px 2px;">';
          postComments.forEach(c => {
            const cp = profMap[c.user_id] || {};
            let cName = cp.name || (cp.tag ? '@' + cp.tag : 'Usuário');
            if(cName.includes('@') && !cp.tag) cName = cName.split('@')[0];
            const canDelete = currentUser && (currentUser.id === c.user_id || currentUser.id === p.user_id);
            const delBtn = canDelete ? ' <span onclick="deleteComment(this,\''+escapeJsArg(c.id)+'\')" style="cursor:pointer;color:var(--muted);font-size:16px;padding:2px 4px;" title="Apagar">&times;</span>' : '';
            html += '<div data-comment-id="'+escapeHtml(c.id)+'" style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink);margin-bottom:4px;">';
            html += '<span style="flex:1"><b>'+escapeHtml(cName)+'</b> '+escapeHtml(c.text)+'</span>'+delBtn;
            html += '</div>';
          });
          html += '</div>';
        }
        html += '<div class="post-time">'+time+'</div>';
        // Buy button for art/sale posts
        if(p.for_sale && p.price > 0 && currentUser && p.user_id !== currentUser.id){
          html += '<div style="padding:6px 14px 4px;display:flex;gap:8px;">';
          html += '<button onclick="comprarObra(\''+escapeJsArg(p.id)+'\',\''+escapeJsArg(name)+'\',\''+escapeJsArg(p.user_id)+'\',\''+escapeJsArg(p.art_type||'Obra')+'\')" style="flex:1;padding:10px;background:linear-gradient(135deg,#8338ec,var(--p1));color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">🎨 Interesse · R$ '+p.price.toLocaleString('pt-BR')+'</button>';
          html += '<button onclick="openChatWithUser(\''+escapeJsArg(p.user_id)+'\')" style="padding:10px 14px;background:var(--white);color:var(--ink);border:1.5px solid var(--border);border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">💬</button>';
          html += '</div>';
        }
        html += '</div>';
    return html;
  }

  async function loadPosts(feedIds, append, skipFirstPaint){
    try {
      const sb = getSupabase();
      if(!sb) return;
      if(!feedIds) feedIds = await getFollowingIds();
      const offset = append ? _feedOffset : 0;
      // Fase 3: feed via DB.posts.getFeedPosts (mesma query, encapsulada).
      const query = DB.posts.getFeedPosts({ feedIds, offset, limit: FEED_PAGE });
      let posts = [], error = null;
      try {
        const res = await (typeof withTimeout === 'function' ? withTimeout(query, 12000, 'posts') : query);
        posts = res.data || [];
        error = res.error || null;
      } catch(e){
        console.warn('loadPosts timeout:', e && e.message);
        throw e; // sobe pro loadFeed renderizar o retry
      }
      if(error){
        console.warn('loadPosts error:', error.message);
        posts = [];
      }
      const container = document.getElementById('feed-posts-area');
      const emptyEl = document.getElementById('feed-empty');
      if(!container) return;
      if(!posts || posts.length === 0){
        if(append){
          // Acabaram os posts — remove o botão "Ver mais"
          const mb = document.getElementById('feed-more-btn');
          if(mb && mb.closest('div')) mb.closest('div').remove();
        } else {
          container.innerHTML = '';
          _feedOffset = 0;
          if(emptyEl) emptyEl.style.display = 'block';
        }
        return;
      }
      if(emptyEl) emptyEl.style.display = 'none';

      // Render progressivo: o 1º paint precisa só de posts + perfis (autor,
      // avatar, legenda, mídia). Curtidas/comentários/salvos entram depois e
      // re-pintam o feed. Dispara TODAS as queries em paralelo (mesmas idas
      // de rede de antes), mas espera só os perfis pro primeiro paint —
      // tirando ~1-2 RTTs do caminho crítico. Cada query tem timeout próprio
      // (8s) + log via reportError pra investigar qual fatia travou.
      const userIds = [...new Set(posts.map(p => p.user_id))];
      const postIds = posts.map(p => p.id);
      const _wt = (pr, label) => (typeof withTimeout === 'function')
        ? withTimeout(pr, 8000, label).catch(e => {
            if(typeof reportError === 'function') reportError({ type:'feed-step-timeout', ctx: label, msg: e && e.message });
            console.warn('feed step timeout:', label, e && e.message);
            return { data: null, error: e }; // segue sem essa fatia em vez de explodir
          })
        : pr;
      // Dispara tudo já (paralelo). Só os perfis entram no caminho crítico.
      const pProfiles = _wt(DB.profiles.getMany(userIds, 'id, name, tag, avatar_url, role, user_type'), 'profiles');
      const pComments = _wt(sb.from('comments').select('id, post_id, user_id, text, created_at').in('post_id', postIds).order('created_at', { ascending: true }).limit(postIds.length * 5), 'comments');
      const pMyLikes  = currentUser ? _wt(sb.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds), 'my-likes') : null;
      const pAllLikes = currentUser ? _wt(sb.from('likes').select('post_id').in('post_id', postIds), 'all-likes') : null;
      const pSaved    = currentUser ? _wt(sb.from('saved_posts').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds), 'saved') : null;

      const profMap = {};
      // Helper de pintura (fecha sobre posts/container/append).
      const renderInto = (ctx) => {
        let html = posts.map(p => buildFeedPostHTML(p, ctx)).join('');
        if(posts.length === FEED_PAGE){
          html += '<div style="text-align:center;padding:16px 0 28px;"><button id="feed-more-btn" onclick="loadMoreFeed(this)" style="background:none;border:1.5px solid var(--border);border-radius:20px;padding:10px 24px;font-size:13px;font-weight:700;color:var(--ink);cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ver mais publicações</button></div>';
        }
        if(append){
          const oldBtn = document.getElementById('feed-more-btn');
          if(oldBtn && oldBtn.closest('div')) oldBtn.closest('div').remove();
          container.insertAdjacentHTML('beforeend', html);
          observeFeedVideos(false);
        } else {
          container.innerHTML = html;
          observeFeedVideos(true);
        }
        if(typeof filterFeedPosts === 'function') filterFeedPosts();
      };

      // Wave A (crítica): perfis → PRIMEIRO PAINT (só no load inicial; no
      // append esperamos os dados completos pra anexar uma vez só).
      const profsRes = await pProfiles;
      const profsArr = Array.isArray(profsRes) ? profsRes : (profsRes && profsRes.data) || [];
      profsArr.forEach(pr => { profMap[pr.id] = pr; });
      posts.forEach(p => { p.profiles = profMap[p.user_id] || {}; });
      // Primeiro paint só no load inicial E quando o cache não pintou antes
      // (se pintou, evitamos o flicker de tirar curtidas/comentários por ~1s
      // até o paint completo chegar).
      if(!append && !skipFirstPaint){
        renderInto({ profMap, myLikes: [], likeCounts: {}, savedPosts: [], commentsMap: {} });
      }

      // Wave B (diferida): comentários + curtidas + salvos (já estavam em voo).
      const [cRes, mlRes, alRes, svRes] = await Promise.all([
        pComments,
        pMyLikes  || Promise.resolve(null),
        pAllLikes || Promise.resolve(null),
        pSaved    || Promise.resolve(null)
      ]);
      const commentsMap = {};
      const commentsArr = (cRes && cRes.data) || [];
      commentsArr.forEach(c => {
        if(!commentsMap[c.post_id]) commentsMap[c.post_id] = [];
        commentsMap[c.post_id].push(c);
      });
      // Resolve nomes de autores de comentário ainda não carregados.
      const commentUserIds = [...new Set(commentsArr.map(c => c.user_id).filter(id => !profMap[id]))];
      if(commentUserIds.length > 0){
        try {
          const cProfs = await (typeof withTimeout === 'function' ? withTimeout(DB.profiles.getMany(commentUserIds, 'id, name, tag, avatar_url'), 5000, 'comment-profiles') : DB.profiles.getMany(commentUserIds, 'id, name, tag, avatar_url'));
          (cProfs || []).forEach(pr => { profMap[pr.id] = pr; });
        } catch(e){ console.warn('comment-profiles timeout:', e && e.message); /* segue sem nomes resolvidos */ }
      }
      let myLikes = [], likeCounts = {}, savedPosts = [];
      if(currentUser){
        if(mlRes && mlRes.data) myLikes = mlRes.data.map(l => l.post_id);
        if(alRes && alRes.data) alRes.data.forEach(l => { likeCounts[l.post_id] = (likeCounts[l.post_id]||0)+1; });
        if(svRes && svRes.data) savedPosts = svRes.data.map(s => s.post_id);
      }

      // PAINT COMPLETO (com curtidas/comentários/salvos).
      renderInto({ profMap, myLikes, likeCounts, savedPosts, commentsMap });
      _feedOffset = offset + posts.length;

      // Cache stale-while-revalidate (só página inicial): próximo load pinta
      // instantâneo do cache enquanto revalida. Gravação assíncrona e compacta
      // (JSON de dados, não HTML de 400KB como o cache antigo que engasgava).
      if(!append){
        scheduleFeedCacheSave(posts, profMap, { myLikes, likeCounts, savedPosts, commentsMap });
      }
    } catch(e){
      console.error('loadPosts error:', e && e.message || e);
      // Se ainda nem chegou na primeira página, o skeleton segue na tela —
      // propaga pro loadFeed mostrar o botão de tentar de novo.
      if(!append) throw e;
    }
  }

  async function loadMoreFeed(btn){
    // Evita duplicar a página 1 se clicado antes do feed inicial estabelecer o offset
    if(_feedOffset === 0) return;
    if(btn){ btn.textContent = 'Carregando...'; btn.disabled = true; }
    await loadPosts(null, true);
    filterFeedPosts();
  }

  window.Modules = window.Modules || {};
  window.Modules.feed = {
    setFeedFilter, filterFeedPosts,
    fetchPublicProfiles,
    paintFeedFromCache, scheduleFeedCacheSave,
    loadFeed, renderFeedRetry, retryLoadFeed,
    invalidateFollowingIds, getFollowingIds,
    toggleFeedVideoMute, toggleFeedVideoPlay, observeFeedVideos,
    buildFeedPostHTML, loadPosts, loadMoreFeed
  };
})();
