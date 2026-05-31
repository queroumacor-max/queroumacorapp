// modules/map.js — feature "Mapa / Explorar pintores" (Leaflet) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, escapeHtml, escapeJsArg,
// avatarUrl, avatarOf, openUserProfile, showPainterCard, painters,
// L (Leaflet, carregado sob demanda), window.debounce.
(function(){
  'use strict';

  // ══ ESTADO DO MAPA ══
  let leafletMap = null;
  let mapMarkers = [];

  // Carrega Leaflet sob demanda (não vem mais no <head> pra economizar ~160KB
  // no first paint — só usuário do mapa paga o custo).
  let _leafletInflight = null;
  async function ensureLeaflet(){
    if(typeof L !== 'undefined') return;
    // Dedup chamadas concorrentes: sem isso, abrir Explorar 2x rápido
    // injeta 2 <script> e baixa Leaflet duas vezes.
    if(_leafletInflight) return _leafletInflight;
    _leafletInflight = (async () => {
      // CSS
      if(!document.querySelector('link[data-leaflet]')){
        await new Promise((resolve) => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = '/leaflet.css?v=1.9.4';
          link.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
          link.crossOrigin = 'anonymous';
          link.dataset.leaflet = '1';
          link.onload = resolve;
          link.onerror = resolve;
          document.head.appendChild(link);
        });
      }
      // JS
      if(!document.querySelector('script[data-leaflet]')){
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = '/leaflet.js?v=1.9.4';
          s.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
          s.crossOrigin = 'anonymous';
          s.dataset.leaflet = '1';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
    })().catch(e => { _leafletInflight = null; throw e; });
    return _leafletInflight;
  }

  async function initLeafletMap(){
    if(leafletMap) return;
    const container = document.getElementById('leaflet-map');
    if(!container) return;
    try { await ensureLeaflet(); } catch(e){ console.error('Leaflet load fail:', e && e.message); return; }
    try {
      leafletMap = L.map('leaflet-map', {
        zoomControl: false,
        attributionControl: false
      }).setView([-14.235, -51.925], 4);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(leafletMap);

      L.control.zoom({ position: 'topright' }).addTo(leafletMap);

      // Load painters from Supabase
      loadMapPainters();
      // Also load from local painters data as fallback
      loadLocalPaintersOnMap();
    } catch(e) {
      console.error('Leaflet init error:', e && e.message || e);
    }
  }

  function createPinIcon(painter){
    const avatar = painter.avatar_url || painter.img || avatarUrl(painter.name||'U');
    const name = (painter.name || painter.name || '').split(' ')[0];
    const rating = painter.rating_avg || painter.rating || 0;
    const featured = rating >= 4.9;
    const html = `<div class="pin-bubble ${featured?'featured':''}">
      <div class="pin-avatar"><img src="${escapeHtml(avatar)}" alt=""></div>
      <div class="pin-info">
        <div class="pin-name">${escapeHtml(name)}</div>
        <div class="pin-rating">* ${Number(rating).toFixed(1)}</div>
      </div>
    </div>
    <div class="pin-tail ${featured?'featured':''}"></div>`;
    return L.divIcon({
      html: html,
      className: 'painter-pin-marker',
      iconSize: [120, 56],
      iconAnchor: [60, 56]
    });
  }

  let dbPainters = [];
  // Índice pré-construído pra buscar pintor em O(1) por inclusão. Evita
  // re-tokenizar 80 strings a cada tecla. Invalidado quando dbPainters muda.
  let _paintersIndex = null;
  function _invalidatePaintersIndex(){ _paintersIndex = null; }
  function _buildPaintersIndex(){
    _paintersIndex = (dbPainters || []).map(p => ({
      p,
      tokens: ((p.name||'') + ' ' + (p.tag||'') + ' ' + (p.city||'') + ' ' + (p.specialties||'')).toLowerCase()
    }));
  }
  // AbortController pra cancelar fetch fallback anterior se o usuário
  // digitar mais rápido que a rede responde.
  let _paintersSearchAbort = null;

  async function loadMapPainters(){
    try {
      const sb = getSupabase();
      if(!sb) return;
      const { data: profiles, error } = await sb.from('profiles')
        .select('id, name, tag, avatar_url, city, state, user_type, role, profession, specialties, rating_avg, lat, lng')
        .or('role.in.(pintor,grafiteiro,automotivo,funileiro),user_type.in.(pintor,grafiteiro,automotivo,funileiro)')
        .limit(80);
      if(error) throw error;
      if(!profiles || profiles.length === 0) return;

      dbPainters = profiles;
      _invalidatePaintersIndex();

      // Clear existing markers loaded from DB
      mapMarkers.forEach(m => { if(m._fromDB) leafletMap.removeLayer(m); });
      mapMarkers = mapMarkers.filter(m => !m._fromDB);

      profiles.forEach(p => {
        if(p.lat && p.lng){
          const icon = createPinIcon(p);
          const marker = L.marker([p.lat, p.lng], { icon }).addTo(leafletMap);
          marker._fromDB = true;
          marker._painterId = p.id;
          marker.on('click', () => {
            document.getElementById('pp-img').src = avatarOf({ avatar_url: p.avatar_url, name: p.name||'P' });
            document.getElementById('pp-name').textContent = p.name || 'Pintor';
            document.getElementById('pp-sub').textContent = [p.city, p.state].filter(Boolean).join(', ') + (p.specialties ? ' - ' + p.specialties : '');
            document.getElementById('pp-stars').textContent = _starStr(p.rating_avg||0) + ' ' + Number(p.rating_avg||0).toFixed(1);
            const pop = document.getElementById('painter-popup');
            pop.dataset.painterId = p.id;
            pop.classList.add('show');
            const ppBtn = document.querySelector('#painter-popup .pp-btn');
            if(ppBtn) ppBtn.onclick = () => { pop.classList.remove('show'); openUserProfile(p.id); };
          });
          mapMarkers.push(marker);
        }
      });

      // eslint-disable-next-line no-use-before-define -- _exploreType declarado abaixo, função executa via callback runtime
      renderPainterList((profiles||[]).filter(p=>_matchType(p,_exploreType)));
    } catch(e) {
      console.error('loadMapPainters error:', e && e.message || e);
    }
  }

  function _starStr(r){
    const n = Math.round(Number(r)||0);
    return '★★★★★'.slice(0,n) + '☆☆☆☆☆'.slice(0, 5-n);
  }

  let _exploreType = 'all';
  function _matchType(p, type){
    if(type === 'all') return true;
    const r = (p.role||p.user_type||'').toString().toLowerCase();
    const prof = (p.profession||'').toString().toLowerCase();
    if(type === 'funileiro') return prof === 'funileiro' || r === 'funileiro';
    if(type === 'automotivo') return r === 'automotivo' && prof !== 'funileiro';
    return r === type;
  }
  function exploreType(el, type){
    _exploreType = type;
    if(el && el.parentElement) el.parentElement.querySelectorAll('.map-chip').forEach(c=>c.classList.remove('active'));
    if(el) el.classList.add('active');
    const list = (dbPainters||[]).filter(p => _matchType(p, type));
    renderPainterList(list);
    // mostra/esconde marcadores do mapa conforme o tipo
    const ids = new Set(list.map(p=>p.id));
    (mapMarkers||[]).forEach(m => {
      if(!m._fromDB) return;
      const show = type === 'all' || ids.has(m._painterId);
      if(show){ if(!leafletMap.hasLayer(m)) m.addTo(leafletMap); }
      else { if(leafletMap.hasLayer(m)) leafletMap.removeLayer(m); }
    });
  }

  function renderPainterList(painters_list){
    const painterListEl = document.getElementById('painter-list');
    if(!painterListEl) return;
    if(!painters_list || painters_list.length === 0){
      painterListEl.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Nenhum profissional encontrado</div>';
      return;
    }
    painterListEl.innerHTML = painters_list.map(p => {
      const ratingNum = Number(p.rating_avg||p.rating||0);
      const stars = _starStr(ratingNum);
      const rating = ratingNum > 0 ? ratingNum.toFixed(1) : 'Novo';
      const av = p.avatar_url || p.img || avatarUrl(p.name||'P');
      const location = p.city ? [p.city, p.state].filter(Boolean).join(', ') : '';
      const tipo = ({pintor:'Pintor',grafiteiro:'Grafiteiro',automotivo:'Automotivo',funileiro:'Funileiro'})[((p.profession||'').toLowerCase()==='funileiro')?'funileiro':(p.role||p.user_type||'').toLowerCase()] || '';
      return `<div onclick="openUserProfile('${escapeJsArg(p.id)}')" style="background:var(--white);border-radius:14px;padding:12px;display:flex;align-items:center;gap:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.06);">
        <img src="${escapeHtml(av)}" style="width:52px;height:52px;border-radius:12px;object-fit:cover">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;"><span style="font-size:14px;font-weight:700;">${escapeHtml(p.name || 'Profissional')}</span>${tipo?'<span style="font-size:9px;font-weight:700;background:var(--cream);color:var(--muted);padding:2px 7px;border-radius:8px;">'+escapeHtml(tipo)+'</span>':''}</div>
          <div style="font-size:12px;color:var(--muted);">${escapeHtml(location)}</div>
          <div style="font-size:13px;color:var(--p1);margin-top:2px;letter-spacing:1px;">${stars} <span style="color:var(--ink);font-weight:700;letter-spacing:0;">${rating}</span></div>
        </div>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
    }).join('');
  }

  async function _filterExplorePaintersImpl(query){
    const q = (query||'').replace('@','').trim().toLowerCase();
    if(!q){
      // Show all: DB painters + local painters
      const allPainters = [...dbPainters];
      Object.entries(painters).forEach(([id, p]) => {
        const alreadyInDB = dbPainters.some(dp => dp.name === p.name);
        if(!alreadyInDB) allPainters.push({ id: id, name: p.name, img: p.img, city: p.city, specialties: p.specs.join(', '), rating: p.rating, rating_avg: p.rating });
      });
      renderPainterList(allPainters);
      return;
    }
    // Filter via índice (tokens já em lowercase, evita re-tokenizar a cada keystroke)
    if(!_paintersIndex) _buildPaintersIndex();
    const filtered = _paintersIndex.filter(x => x.tokens.includes(q)).map(x => x.p);
    // Also filter local painters
    Object.entries(painters).forEach(([id, p]) => {
      const alreadyInResults = filtered.some(dp => dp.name === p.name);
      if(alreadyInResults) return;
      const name = p.name.toLowerCase();
      const city = (p.city||'').toLowerCase();
      const specs = (p.specs||[]).join(' ').toLowerCase();
      const handle = (p.handle||'').toLowerCase();
      if(name.includes(q) || city.includes(q) || specs.includes(q) || handle.includes(q)){
        filtered.push({ id: id, name: p.name, img: p.img, city: p.city, specialties: p.specs.join(', '), rating: p.rating, rating_avg: p.rating });
      }
    });
    // If no results from cache, search Supabase directly (cancela fetch anterior)
    if(filtered.length === 0){
      try {
        if(_paintersSearchAbort){ try { _paintersSearchAbort.abort(); } catch(_){} }
        _paintersSearchAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const sb = getSupabase();
        if(sb){
          let req = sb.from('profiles_public')
            .select('id, name, tag, avatar_url, city, state, specialties, rating_avg, role, user_type')
            .or('role.eq.pintor,user_type.eq.pintor')
            .ilike('name', '%'+q+'%')
            .limit(20);
          if(_paintersSearchAbort && typeof req.abortSignal === 'function'){
            req = req.abortSignal(_paintersSearchAbort.signal);
          }
          const { data } = await req;
          if(data && data.length > 0){
            data.forEach(p => filtered.push(p));
          }
        }
      } catch(e){
        // AbortError é esperado quando o usuário digita rápido — não logar
        if(!(e && (e.name === 'AbortError' || /aborted/i.test(String(e.message||''))))){
          console.warn('filterExplorePainters search error:', e && e.message || e);
        }
      }
    }
    renderPainterList(filtered);
  }
  const filterExplorePainters = (window.debounce ? window.debounce(_filterExplorePaintersImpl, 250) : _filterExplorePaintersImpl);

  function loadLocalPaintersOnMap(){
    // Fallback: show local painter data on map
    const coords = {
      carlos: [-23.56, -46.63],
      joao: [-22.91, -43.17],
      marcia: [-22.91, -47.06],
      ana: [-19.92, -43.94],
      pedro: [-25.43, -49.27],
      fabio: [-30.03, -51.23]
    };

    Object.entries(painters).forEach(([id, p]) => {
      const c = coords[id];
      if(c && leafletMap){
        const icon = createPinIcon(p);
        const marker = L.marker(c, { icon }).addTo(leafletMap);
        marker._local = true;
        marker.on('click', () => {
          showPainterCard(id);
        });
        mapMarkers.push(marker);
      }
    });

    // Build combined list: DB painters + local painters not in DB
    const allPainters = [...dbPainters];
    Object.entries(painters).forEach(([id, p]) => {
      const alreadyInDB = dbPainters.some(dp => dp.name === p.name);
      if(!alreadyInDB) allPainters.push({ id: id, name: p.name, img: p.img, city: p.city, specialties: p.specs.join(', '), rating: p.rating, rating_avg: p.rating });
    });
    renderPainterList(allPainters);
  }

  window.Modules = window.Modules || {};
  window.Modules.map = {
    ensureLeaflet, initLeafletMap, createPinIcon,
    _invalidatePaintersIndex, _buildPaintersIndex,
    loadMapPainters, _matchType, exploreType, renderPainterList,
    _filterExplorePaintersImpl, filterExplorePainters,
    loadLocalPaintersOnMap
  };
})();
