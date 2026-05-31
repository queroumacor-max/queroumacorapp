// modules/stories.js — feature "Stories" (estilo Instagram) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
//
// Depende de globals do app.js / head.js: getSupabase, currentUser,
// getFollowingIds, withTimeout, reportError, DB, isVideoUrl, cfImg, avatarOf,
// avatarUrl, escapeHtml, escapeJsArg, updateMyStoryAvatar, getTimeAgo,
// showModal, openUserProfile, STORY_DURATION.
//
// Estado compartilhado com app.js (ainda declarado top-level em app.js, lido
// via shared script scope): storyGroups, currentStoryGroup, currentStoryIndex,
// _seenStories. `deleteCurrentStory()` (em app.js) precisa enxergar esses.
//
// Estado encapsulado no IIFE (era top-level em app.js, mas só usado dentro do
// bloco stories): storyTimer, _lastStoriesFp, _storyRafId.
//
// STORY_DURATION fica em window.Config.stories.DURATION_MS (config.js) — aqui
// referenciamos o symbol top-level que ainda existe em app.js.
(function(){
  'use strict';

  // Estado interno (era top-level no app.js mas usado só por essas funções).
  let storyTimer = null; // mantido pra compat; agora guarda rAF id
  let _lastStoriesFp = ''; // fingerprint do último render — pula re-render quando idêntico
  let _storyRafId = null;

  function _stopStoryAnim(){
    if(_storyRafId){ try { cancelAnimationFrame(_storyRafId); } catch(_){} _storyRafId = null; }
    if(storyTimer){ try { clearInterval(storyTimer); } catch(_){} storyTimer = null; }
  }

  async function loadStories(feedIds){
    try {
      const sb = getSupabase();
      if(!sb) return;
      const myId = currentUser ? currentUser.id : null;
      // Load stories from last 24h (like IG) from followed users + own
      const since = new Date(Date.now() - 24*60*60*1000).toISOString();
      if(!feedIds) feedIds = await getFollowingIds();
      // Fase 3: stories via DB.posts.getStories (filtra approved + media_url não-nula).
      const storyQuery = DB.posts.getStories({ feedIds, sinceISO: since, limit: 100 });
      let stories = [], error = null;
      try {
        const res = await (typeof withTimeout === 'function' ? withTimeout(storyQuery, 8000, 'stories') : storyQuery);
        stories = res.data || [];
        error = res.error || null;
      } catch(e){
        // Stories são opcionais — se travarem, segue sem elas (não derruba o feed).
        if(typeof reportError === 'function') reportError({ type:'feed-step-timeout', ctx: 'stories', msg: e && e.message });
        console.warn('loadStories timeout:', e && e.message);
      }
      if(error){
        console.warn('loadStories error:', error.message);
        stories = [];
      }

      // Load all needed profiles in a single query
      const followedIds = feedIds.filter(id => id !== myId);
      const storyUserIds = (stories && stories.length > 0) ? [...new Set(stories.map(s => s.user_id))] : [];
      const allNeededIds = [...new Set([...followedIds, ...storyUserIds])].filter(Boolean);
      let allFollowedProfiles = {};
      if(allNeededIds.length > 0){
        try {
          const profs = await (typeof withTimeout === 'function' ? withTimeout(DB.profiles.getMany(allNeededIds, 'id, name, tag, avatar_url'), 6000, 'story-profiles') : DB.profiles.getMany(allNeededIds, 'id, name, tag, avatar_url'));
          (profs || []).forEach(pr => { allFollowedProfiles[pr.id] = pr; });
        } catch(e){
          if(typeof reportError === 'function') reportError({ type:'feed-step-timeout', ctx: 'story-profiles', msg: e && e.message });
          console.warn('story-profiles timeout:', e && e.message);
        }
      }
      if(stories && stories.length > 0){
        stories.forEach(s => { s.profiles = allFollowedProfiles[s.user_id] || {}; });
      }

      // Group stories by user_id (like IG)
      const grouped = {};
      let myStoryGroup = null;
      (stories || []).forEach(s => {
        const uid = s.user_id;
        if(!grouped[uid]) grouped[uid] = { user_id: uid, profile: s.profiles || {}, stories: [] };
        grouped[uid].stories.push(s);
      });
      // Separate own stories from others
      if(myId && grouped[myId]){
        myStoryGroup = grouped[myId];
        delete grouped[myId];
      }
      storyGroups = [];
      // If user has stories, add as first group (index 0) so openStoryViewer works
      if(myStoryGroup) storyGroups.push(myStoryGroup);
      storyGroups.push(...Object.values(grouped));

      // Render circles
      const row = document.getElementById('stories-row');
      const addStoryEl = row.children[0];
      // Update add-story ring: colorido se tem stories, cinza se nao
      const addStoryRing = addStoryEl.querySelector('.story-ring');
      if(myStoryGroup){
        addStoryRing.classList.remove('seen');
        addStoryRing.style.background = 'conic-gradient(var(--p1),var(--p4),var(--p5),var(--p3),var(--p1))';
        // Make add-story also open own stories on tap (+ button still opens post modal)
        addStoryEl.setAttribute('onclick', 'openStoryViewer(0)');
      } else {
        addStoryRing.style.background = 'rgba(255,255,255,.15)';
        addStoryEl.setAttribute('onclick', "showModal('post-modal')");
      }
      // Fingerprint do estado renderizado: se nada mudou desde a última
      // chamada, pula o innerHTML (evita pisca/scroll-jump da story strip
      // quando o usuário volta pra tela do feed sem nenhuma story nova).
      // Inclui avatar_url pra detectar troca de foto do seguido.
      const fp = (myStoryGroup ? 'm:'+myStoryGroup.stories.length+':'+(myStoryGroup.profile.avatar_url||'')+'|' : 'a|')
        + storyGroups.slice(myStoryGroup ? 1 : 0).map(g =>
            g.user_id + ':' + g.stories.length + ':' + (g.profile.avatar_url||'') + ':' + (isStoryGroupSeen(g.user_id) ? 1 : 0)
          ).join(',')
        + '||' + followedIds.filter(id => !(stories||[]).some(s => s.user_id === id)).map(uid => {
            const ap = allFollowedProfiles[uid] || {};
            return uid + ':' + (ap.avatar_url || '');
          }).join(',');
      if(fp === _lastStoriesFp){
        // Empty state ainda pode precisar de atualização (raros casos).
        const emptyEl = document.getElementById('feed-empty');
        if(emptyEl) emptyEl.style.display = (storyGroups.length > 0 || followedIds.length > 0) ? 'none' : 'block';
        return;
      }
      _lastStoriesFp = fp;
      let html = addStoryEl.outerHTML;
      // Render users with stories (skip index 0 if it's own)
      const startIdx = myStoryGroup ? 1 : 0;
      const renderedUserIds = new Set();
      for(let gi = startIdx; gi < storyGroups.length; gi++){
        const g = storyGroups[gi];
        const p = g.profile;
        renderedUserIds.add(g.user_id);
        let name = p.tag ? '@' + p.tag : (p.name || 'User');
        if(!p.tag){
          if(name.includes('@')) name = name.split('@')[0];
          name = name.split(' ')[0];
        }
        const avatar = p.avatar_url || g.stories[0].media_url || avatarUrl(p.name||'U');
        const seen = isStoryGroupSeen(g.user_id) ? ' seen' : '';
        html += `<div class="story">
          <div class="story-ring${seen}" style="cursor:pointer" onclick="openStoryViewer(${gi})"><div class="story-inner"><img src="${escapeHtml(avatar)}" alt=""></div></div>
          <span class="story-name" style="cursor:pointer" onclick="openUserProfile('${escapeJsArg(g.user_id)}')">${escapeHtml(name)}</span>
        </div>`;
      }

      // Render followed users WITHOUT stories (profile circles).
      // Renderiza mesmo quando o profile está faltando (auth.users sem row em
      // profiles) — usa placeholder pra não esconder o seguido.
      for(const uid of followedIds){
        if(renderedUserIds.has(uid)) continue;
        const p = allFollowedProfiles[uid] || {};
        let name = p.tag ? '@' + p.tag : (p.name || 'User');
        if(!p.tag){
          if(name.includes('@')) name = name.split('@')[0];
          name = name.split(' ')[0];
        }
        const initials = (p.name || 'U').split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase();
        const avatar = p.avatar_url || avatarUrl(initials);
        html += `<div class="story" onclick="openUserProfile('${escapeJsArg(uid)}')">
          <div class="story-ring seen"><div class="story-inner"><img src="${escapeHtml(avatar)}" alt=""></div></div>
          <span class="story-name">${escapeHtml(name)}</span>
        </div>`;
      }

      row.innerHTML = html;

      // Re-apply user avatar/name after innerHTML rebuild
      updateMyStoryAvatar();

      // Update empty state
      const emptyEl = document.getElementById('feed-empty');
      if(emptyEl) emptyEl.style.display = (storyGroups.length > 0 || followedIds.length > 0) ? 'none' : 'block';
    } catch(e) {
      console.error('loadStories error:', e && e.message || e);
    }
  }

  function isStoryGroupSeen(userId){ return !!_seenStories[userId]; }
  function markStoryGroupSeen(userId){
    _seenStories[userId] = Date.now();
    _lastStoriesFp = ''; // invalida fp pra próximo loadStories re-renderizar o anel "visto"
    const sb = getSupabase();
    if(sb && currentUser){
      sb.from('profiles').update({ seen_stories: _seenStories }).eq('id', currentUser.id)
        .then(({ error }) => { if(error) console.warn('markStoryGroupSeen:', error.message); });
    }
  }

  function openStoryViewer(groupIndex){
    currentStoryGroup = groupIndex;
    currentStoryIndex = 0;
    const viewer = document.getElementById('story-viewer');
    viewer.style.display = 'flex';
    renderCurrentStory();
  }

  function closeStoryViewer(){
    document.getElementById('story-viewer').style.display = 'none';
    const vidEl = document.getElementById('story-viewer-video');
    if(vidEl){ vidEl.pause(); vidEl.removeAttribute('src'); }
    _stopStoryAnim();
    loadStories(); // refresh seen states
  }

  function renderCurrentStory(){
    const g = storyGroups[currentStoryGroup];
    if(!g) { closeStoryViewer(); return; }
    const s = g.stories[currentStoryIndex];
    if(!s) { closeStoryViewer(); return; }
    const p = g.profile;

    // Update media (image or video)
    const imgEl = document.getElementById('story-viewer-img');
    const vidEl = document.getElementById('story-viewer-video');
    const storyIsVideo = isVideoUrl(s.media_url) || s.media_type === 'video';
    const errEl = document.getElementById('story-viewer-err');
    if(errEl) errEl.style.display = 'none';
    // Mídia falhou de vez (img E vídeo): mostra aviso visível em vez de tela
    // preta silenciosa e loga a URL pra diagnóstico server-side.
    const showStoryMediaErr = (kind) => {
      if(errEl) errEl.style.display = 'flex';
      if(typeof reportError === 'function') reportError({ type: kind, ctx: s.media_url || '(sem media_url)' });
      console.warn('[story-media-fail]', kind, s.media_url);
    };
    if(storyIsVideo){
      imgEl.style.display = 'none';
      imgEl.src = '';
      vidEl.style.display = 'block';
      vidEl.onerror = function(){ showStoryMediaErr('story-video-fail'); };
      vidEl.src = s.media_url || ''; // video: sem resize (CF Image só serve imagens)
      vidEl.muted = false;
      vidEl.currentTime = 0;
      vidEl.play().catch(() => { vidEl.muted = true; vidEl.play().catch(()=>{}); });
    } else {
      vidEl.pause();
      vidEl.removeAttribute('src');
      vidEl.style.display = 'none';
      imgEl.style.display = 'block';
      const rawStoryImg = s.media_url || '';
      // Fallback: se a versão otimizada (cfImg) falhar, tenta a URL crua antes
      // de desistir — evita story preto se o CF Image Resizing estiver mal
      // configurado. Anti-loop via comparação de src. Se a crua TAMBÉM falhar,
      // mostra aviso + loga.
      imgEl.onload = function(){ if(errEl) errEl.style.display = 'none'; };
      imgEl.onerror = function(){
        if(rawStoryImg && imgEl.src !== rawStoryImg){ imgEl.src = rawStoryImg; }
        else { imgEl.onerror = null; showStoryMediaErr('story-img-fail'); }
      };
      imgEl.src = rawStoryImg ? cfImg(rawStoryImg, { w: 800 }) : '';
      if(!rawStoryImg) showStoryMediaErr('story-no-media');
    }
    // Update header
    const svAvatar = document.getElementById('story-viewer-avatar');
    svAvatar.onerror = function(){ svAvatar.onerror = null; svAvatar.src = avatarUrl(p.name||'U'); };
    svAvatar.src = avatarOf({ avatar_url: p.avatar_url, name: p.name||'U' });
    document.getElementById('story-viewer-name').textContent = p.name || 'User';
    document.getElementById('story-viewer-time').textContent = getTimeAgo(s.created_at);

    // Show delete button only for own stories
    const delBtn = document.getElementById('story-delete-btn');
    if(delBtn) delBtn.style.display = (currentUser && g.user_id === currentUser.id) ? 'block' : 'none';

    // Progress bars
    const barContainer = document.getElementById('story-progress-bar');
    barContainer.innerHTML = '';
    g.stories.forEach((_, i) => {
      const bar = document.createElement('div');
      bar.style.cssText = 'flex:1;height:2.5px;border-radius:2px;background:rgba(255,255,255,.35);overflow:hidden;';
      const fill = document.createElement('div');
      fill.style.cssText = 'height:100%;border-radius:2px;background:#fff;';
      if(i < currentStoryIndex) fill.style.width = '100%';
      else if(i === currentStoryIndex) { fill.style.width = '0%'; fill.id = 'story-progress-fill'; }
      else fill.style.width = '0%';
      bar.appendChild(fill);
      barContainer.appendChild(bar);
    });

    // Mark seen
    markStoryGroupSeen(g.user_id);

    // Start auto-advance timer via requestAnimationFrame: economiza CPU
    // (auto-pausa em tab background) e elimina o setInterval de 50ms que
    // forçava layout/style 20x/s mesmo sem mudança visível.
    _stopStoryAnim();
    if(storyIsVideo){
      // Vídeo: progresso e avanço seguem a duração real do vídeo
      vidEl.onended = () => storyNext();
      const tickVideo = () => {
        const fill = document.getElementById('story-progress-fill');
        if(fill && vidEl.duration) fill.style.width = (vidEl.currentTime / vidEl.duration * 100) + '%';
        _storyRafId = requestAnimationFrame(tickVideo);
      };
      _storyRafId = requestAnimationFrame(tickVideo);
    } else {
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const tickImg = () => {
        const elapsed = now() - t0;
        const fill = document.getElementById('story-progress-fill');
        if(fill) fill.style.width = Math.min(100, (elapsed / STORY_DURATION) * 100) + '%';
        if(elapsed >= STORY_DURATION){ _storyRafId = null; storyNext(); return; }
        _storyRafId = requestAnimationFrame(tickImg);
      };
      _storyRafId = requestAnimationFrame(tickImg);
    }
  }

  function storyNext(){
    const g = storyGroups[currentStoryGroup];
    if(!g) { closeStoryViewer(); return; }
    if(currentStoryIndex < g.stories.length - 1){
      currentStoryIndex++;
      renderCurrentStory();
    } else if(currentStoryGroup < storyGroups.length - 1){
      // Next user's stories (like IG)
      currentStoryGroup++;
      currentStoryIndex = 0;
      renderCurrentStory();
    } else {
      closeStoryViewer();
    }
  }

  function storyPrev(){
    if(currentStoryIndex > 0){
      currentStoryIndex--;
      renderCurrentStory();
    } else if(currentStoryGroup > 0){
      currentStoryGroup--;
      const g = storyGroups[currentStoryGroup];
      currentStoryIndex = g.stories.length - 1;
      renderCurrentStory();
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.stories = {
    _stopStoryAnim,
    loadStories,
    isStoryGroupSeen, markStoryGroupSeen,
    openStoryViewer, closeStoryViewer,
    renderCurrentStory,
    storyNext, storyPrev
  };
})();
