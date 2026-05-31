// modules/profile-edit.js — feature "Edição de Perfil" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, requireSession,
// handleSbError, showError, toast, escapeHtml, escapeJsArg, showModal,
// closeModals, avatarOf, avatarUrl, DB, getMyProfile, invalidateMyProfile,
// loadMyProfileData, updateMyStoryAvatar, _applyOwnLogoToShirt, _roleSpecs,
// toggleSpec.
// Inclui também `sharePost` (compartilhamento de post via Web Share API),
// que estava intercalado no mesmo range no app.js.
(function(){
  'use strict';

  // ══ Estado local da edição de perfil ══
  let _epAvatarFile = null; // holds selected avatar file for upload
  let _epLogoFile = null;   // holds selected business logo file for upload
  let _epLogoClear = false; // user clicked "Remover" → wipe business_logo_url on save

  function previewAvatar(input){
    if(input.files && input.files[0]){
      _epAvatarFile = input.files[0];
      const reader = new FileReader();
      reader.onload = e => { document.getElementById('ep-avatar-preview').src = e.target.result; };
      reader.readAsDataURL(input.files[0]);
    }
  }

  function _epShowLogo(url){
    const img = document.getElementById('ep-logo-preview');
    const ph  = document.getElementById('ep-logo-placeholder');
    const rm  = document.getElementById('ep-logo-remove-btn');
    if(url){
      if(img){ img.src = url; img.style.display = 'block'; }
      if(ph) ph.style.display = 'none';
      if(rm) rm.style.display = 'inline-block';
    } else {
      if(img){ img.src = ''; img.style.display = 'none'; }
      if(ph) ph.style.display = 'block';
      if(rm) rm.style.display = 'none';
    }
  }

  function previewEpLogo(input){
    const f = input && input.files && input.files[0];
    if(!f) return;
    if(!f.type.startsWith('image/')){ toast('Selecione um arquivo de imagem'); return; }
    if(f.size > 5 * 1024 * 1024){ toast('Imagem muito grande (máx 5MB)'); return; }
    _epLogoFile = f;
    _epLogoClear = false;
    const reader = new FileReader();
    reader.onload = e => _epShowLogo(e.target.result);
    reader.readAsDataURL(f);
  }

  function removeEpLogo(){
    _epLogoFile = null;
    _epLogoClear = true;
    _epShowLogo(null);
    const inp = document.getElementById('ep-logo-input');
    if(inp) inp.value = '';
  }

  async function openEditProfile(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    _epAvatarFile = null; // reset
    _epLogoFile = null;
    _epLogoClear = false;
    _epShowLogo(null);
    try {
      const prof = await DB.profiles.getById(currentUser.id, 'name, tag, email, city, state, phone, specialties, avatar_url, role, user_type, business_logo_url');
      if(prof){
        document.getElementById('ep-name').value = prof.name || '';
        document.getElementById('ep-tag').value = prof.tag || '';
        document.getElementById('ep-email').value = prof.email || currentUser.email || '';
        document.getElementById('ep-city').value = prof.city || '';
        document.getElementById('ep-state').value = prof.state || '';
        if(prof.state) loadCidadesDoEstado(prof.state);
        document.getElementById('ep-phone').value = prof.phone || '';
        document.getElementById('ep-specs').value = prof.specialties || '';
        _epSpecsSetup(prof.role || prof.user_type, prof.specialties || '');
        // Show current avatar
        const preview = document.getElementById('ep-avatar-preview');
        if(preview) preview.src = avatarOf({ avatar_url: prof.avatar_url, name: prof.name || 'U' });
        // Show current business logo (synced with shirts/camisetas)
        let logoUrl = prof.business_logo_url || null;
        if(!logoUrl){ try { logoUrl = localStorage.getItem('business_logo_url'); } catch(e){} }
        _epShowLogo(logoUrl);
      } else {
        // Fallback to user_metadata
        const meta = currentUser.user_metadata || {};
        document.getElementById('ep-name').value = meta.name || '';
        document.getElementById('ep-tag').value = meta.tag || '';
        document.getElementById('ep-email').value = currentUser.email || '';
        document.getElementById('ep-city').value = '';
        document.getElementById('ep-state').value = '';
        document.getElementById('ep-phone').value = '';
        document.getElementById('ep-specs').value = '';
        _epSpecsSetup(meta.user_type || meta.role, '');
        const preview = document.getElementById('ep-avatar-preview');
        if(preview) preview.src = avatarUrl(meta.name || 'U');
      }
    } catch(e){ console.warn('openEditProfile error:', e && e.message || e); }
    const r = document.getElementById('ep-radius');
    if(r){
      r.value = '';
      try {
        const pr = await DB.profiles.getById(currentUser.id, 'service_radius');
        if(pr && pr.service_radius != null) r.value = pr.service_radius;
      } catch(e){ console.warn('load service_radius:', e && e.message || e); }
    }
    showModal('edit-profile-modal');
  }

  // ══ AUTOCOMPLETE: cidade pelo estado (IBGE) ══
  const _citiesCache = {};
  const _ufByName = {
    'acre':'AC','alagoas':'AL','amapa':'AP','amapá':'AP','amazonas':'AM',
    'bahia':'BA','ceara':'CE','ceará':'CE','distrito federal':'DF',
    'espirito santo':'ES','espírito santo':'ES','goias':'GO','goiás':'GO',
    'maranhao':'MA','maranhão':'MA','mato grosso':'MT','mato grosso do sul':'MS',
    'minas gerais':'MG','para':'PA','pará':'PA','paraiba':'PB','paraíba':'PB',
    'parana':'PR','paraná':'PR','pernambuco':'PE','piaui':'PI','piauí':'PI',
    'rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS',
    'rondonia':'RO','rondônia':'RO','roraima':'RR','santa catarina':'SC',
    'sao paulo':'SP','são paulo':'SP','sergipe':'SE','tocantins':'TO'
  };
  async function loadCidadesDoEstado(uf){
    if(!uf) return;
    uf = String(uf).trim().toUpperCase();
    if(uf.length !== 2) return;
    const dl = document.getElementById('ep-city-list');
    if(!dl) return;
    if(_citiesCache[uf]){ dl.innerHTML = _citiesCache[uf]; return; }
    try {
      const r = await fetch('/api/cidades?uf=' + uf);
      if(!r.ok) return;
      const data = await r.json();
      const arr = (data && data.cidades) || [];
      const html = arr.map(c => '<option value="'+escapeHtml(c.nome)+'">').join('');
      _citiesCache[uf] = html;
      dl.innerHTML = html;
    } catch(e){ console.warn('cidades:', e && e.message || e); }
  }
  function _epStateChanged(){
    const stEl = document.getElementById('ep-state');
    if(!stEl) return;
    const raw = (stEl.value || '').trim();
    if(raw.length > 2 && _ufByName[raw.toLowerCase()]){
      stEl.value = _ufByName[raw.toLowerCase()];
    } else if(raw.length === 2){
      stEl.value = raw.toUpperCase();
    }
    const uf = (stEl.value || '').toUpperCase();
    if(uf.length === 2) loadCidadesDoEstado(uf);
  }

  // ══ ESPECIALIDADES — modal dedicado ══
  async function openEditEspecialidades(){
    const ctx = requireSession('Faça login');
    if(!ctx) return;
    const sb = ctx.sb;
    const prof = (typeof getMyProfile === 'function') ? await getMyProfile() : null;
    const meta = (currentUser && currentUser.user_metadata) || {};
    const role = (prof && (prof.role || prof.user_type)) || meta.user_type || meta.role || 'pintor';
    const currentSpecs = (prof && prof.specialties)
      ? String(prof.specialties).split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const all = (typeof _roleSpecs === 'object' && _roleSpecs[role]) ? _roleSpecs[role] : (_roleSpecs && _roleSpecs.pintor) || [];
    const grid = document.getElementById('specs-modal-grid');
    if(grid){
      grid.innerHTML = all.map(s => {
        const sel = currentSpecs.includes(s);
        return '<div class="spec-chip'+(sel?' sel':'')+'" onclick="toggleSpec(this)" style="padding:8px 14px;border-radius:20px;background:'+(sel?'var(--ink)':'var(--cream)')+';color:'+(sel?'#fff':'var(--ink)')+';font-size:13px;cursor:pointer;border:1px solid '+(sel?'var(--ink)':'var(--border)')+';">'+escapeHtml(s)+'</div>';
      }).join('');
    }
    showModal('edit-specs-modal');
  }

  async function saveEspecialidades(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    const sel = [...document.querySelectorAll('#specs-modal-grid .spec-chip.sel')].map(c => c.textContent.trim());
    if(sel.length === 0){ toast('Selecione pelo menos uma especialidade'); return; }
    // Double-submit guard + loading visual no botão "Salvar" do modal.
    const btn = (typeof event !== 'undefined' && event && event.currentTarget) ||
                document.querySelector('#edit-specs-modal button[onclick*="saveEspecialidades"]');
    if(btn && btn.dataset._loading) return;
    const restore = (typeof setButtonLoading === 'function') ? setButtonLoading(btn, 'Salvando...') : () => {};
    try {
      const { error } = await sb.from('profiles').update({ specialties: sel.join(', ') }).eq('id', currentUser.id);
      if(handleSbError(error)) return;
      if(typeof invalidateMyProfile === 'function') invalidateMyProfile();
      toast('Especialidades salvas ✅');
      closeModals();
    } finally { restore(); }
  }

  // ══ RAIO DE ATENDIMENTO — modal dedicado ══
  async function openEditRaio(){
    const ctx = requireSession('Faça login');
    if(!ctx) return;
    const sb = ctx.sb;
    const sel = document.getElementById('radius-modal-select');
    if(sel){
      sel.value = '';
      try {
        const pr = await DB.profiles.getById(currentUser.id, 'service_radius');
        if(pr && pr.service_radius != null) sel.value = pr.service_radius;
      } catch(e){ console.warn('[load-service-radius]', e && e.message); }
    }
    showModal('edit-radius-modal');
  }

  async function saveRaio(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    const sel = document.getElementById('radius-modal-select');
    const value = sel ? sel.value : '';
    // service_radius é integer; 'estado' (sem limite) é gravado como null
    const valInt = (value === '' || value === 'estado') ? null : (parseInt(value, 10) || null);
    // Double-submit guard + loading visual no botão "Salvar" do modal.
    const btn = (typeof event !== 'undefined' && event && event.currentTarget) ||
                document.querySelector('#edit-radius-modal button[onclick*="saveRaio"]');
    if(btn && btn.dataset._loading) return;
    const restore = (typeof setButtonLoading === 'function') ? setButtonLoading(btn, 'Salvando...') : () => {};
    try {
      const { error } = await sb.from('profiles').update({ service_radius: valInt }).eq('id', currentUser.id);
      if(handleSbError(error)) return;
      if(typeof invalidateMyProfile === 'function') invalidateMyProfile();
      toast('Raio salvo ✅');
      closeModals();
    } catch(e){ showError('save-radius', e, 'Não foi possível salvar o raio. Tente novamente.'); }
    finally { restore(); }
  }

  function _epSpecRole(role){
    const r = (role||'').toLowerCase();
    if(r==='grafiteiro' || r==='graffiti') return 'grafiteiro';
    if(r==='automotivo' || r==='funileiro') return 'automotivo';
    if(r==='pintor') return 'pintor';
    return null; // cliente/admin: sem especialidades
  }

  function _epSpecsSetup(role, csv){
    const wrap = document.getElementById('ep-specs-wrap');
    const list = document.getElementById('ep-specs-list');
    const specRole = _epSpecRole(role);
    if(!wrap || !list) return;
    if(!specRole){ wrap.style.display='none'; document.getElementById('ep-specs').value=''; return; }
    wrap.style.display='';
    const selected = (csv||'').split(',').map(s=>s.trim()).filter(Boolean);
    const opts = _roleSpecs[specRole] || _roleSpecs['pintor'];
    list.innerHTML = opts.map(o=>{
      const ck = selected.includes(o) ? 'checked' : '';
      return '<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:14px;cursor:pointer;">'
        + '<input type="checkbox" value="'+o.replace(/"/g,'&quot;')+'" '+ck+' onchange="_epSpecsApply()" style="width:16px;height:16px;accent-color:var(--p1);"> '+o+'</label>';
    }).join('');
    document.getElementById('ep-specs-list').style.display='none';
    _epSpecsApply();
  }

  function toggleEpSpecs(){
    const l = document.getElementById('ep-specs-list');
    if(l) l.style.display = l.style.display==='none' ? 'block' : 'none';
  }

  function _epSpecsApply(){
    const list = document.getElementById('ep-specs-list');
    if(!list) return;
    const sel = [...list.querySelectorAll('input[type=checkbox]:checked')].map(c=>c.value);
    document.getElementById('ep-specs').value = sel.join(', ');
    const sum = document.getElementById('ep-specs-summary');
    if(sum) sum.textContent = sel.length ? sel.join(', ') : 'Selecione suas especialidades';
  }

  async function saveEditProfile(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    // Validacao: campos obrigatorios
    const vName = document.getElementById('ep-name').value.trim();
    const vTag = document.getElementById('ep-tag').value.trim().replace('@','');
    const vEmail = document.getElementById('ep-email').value.trim();
    const vCity = document.getElementById('ep-city').value.trim();
    const vState = document.getElementById('ep-state').value.trim();
    const vPhone = document.getElementById('ep-phone').value.trim();
    if(!vName || vName.includes('@')){ toast('Informe seu nome completo (não use o email como nome).'); return; }
    if(!vTag || vTag.length < 3){ toast('Informe sua @tag (mínimo 3 caracteres).'); return; }
    if(!vEmail || !/^\S+@\S+\.\S+$/.test(vEmail)){ toast('Informe um email válido.'); return; }
    if(!vCity){ toast('Informe sua cidade.'); return; }
    if(!vState){ toast('Informe seu estado (UF).'); return; }
    if(!vPhone){ toast('Informe seu telefone/WhatsApp.'); return; }
    const specsWrap = document.getElementById('ep-specs-wrap');
    if(specsWrap && specsWrap.style.display !== 'none' && !document.getElementById('ep-specs').value.trim()){
      toast('Selecione pelo menos uma especialidade.'); return;
    }
    const btn = document.getElementById('ep-save-btn');
    // Double-submit guard: ignora reentrada se já está salvando.
    if(btn && btn.dataset._loading) return;
    btn.textContent = 'Salvando...'; btn.disabled = true;
    if(btn) btn.dataset._loading = '1';
    const radiusEl = document.getElementById('ep-radius');
    const radiusToSave = (radiusEl && radiusEl.value) ? (parseInt(radiusEl.value,10) || null) : null;
    try {
      const updates = {
        name: document.getElementById('ep-name').value.trim(),
        tag: document.getElementById('ep-tag').value.trim().replace('@','').toLowerCase(),
        city: document.getElementById('ep-city').value.trim(),
        state: document.getElementById('ep-state').value.trim().toUpperCase(),
        phone: document.getElementById('ep-phone').value.trim(),
        specialties: document.getElementById('ep-specs').value.trim(),
        updated_at: new Date().toISOString(),
      };

      // Upload avatar if a new file was selected
      if(_epAvatarFile){
        btn.textContent = 'Enviando foto...';
        const ext = _epAvatarFile.name.split('.').pop() || 'jpg';
        const ts = Date.now();
        let avatarUploaded = false;

        // Try avatars bucket first
        try {
          const filePath = currentUser.id + '/' + ts + '.' + ext;
          const { error: upErr } = await sb.storage.from('avatars').upload(filePath, _epAvatarFile, { upsert: true });
          if(!upErr){
            const { data: urlData } = sb.storage.from('avatars').getPublicUrl(filePath);
            if(urlData && urlData.publicUrl){
              updates.avatar_url = urlData.publicUrl;
              avatarUploaded = true;
            }
          } else {
            console.warn('Avatars bucket upload failed:', upErr.message);
          }
        } catch(e){ console.warn('Avatars bucket error:', e && e.message || e); }

        // Fallback: try posts bucket
        if(!avatarUploaded){
          try {
            // B4.4: path tem que começar com user_id pra passar nas storage policies
            const fallbackPath = currentUser.id + '/avatar_fallback_' + ts + '.' + ext;
            const { error: upErr2 } = await sb.storage.from('posts').upload(fallbackPath, _epAvatarFile, { upsert: true });
            if(!upErr2){
              const { data: urlData } = sb.storage.from('posts').getPublicUrl(fallbackPath);
              if(urlData && urlData.publicUrl){
                updates.avatar_url = urlData.publicUrl;
                avatarUploaded = true;
              }
            } else {
              console.warn('Posts bucket upload failed:', upErr2.message);
            }
          } catch(e){ console.warn('Posts bucket error:', e && e.message || e); }
        }

        // Last resort: convert to data URL and store directly
        if(!avatarUploaded){
          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = e => resolve(e.target.result);
              reader.onerror = reject;
              reader.readAsDataURL(_epAvatarFile);
            });
            // Resize to max 200px to keep data URL small
            const canvas = document.createElement('canvas');
            const img = new Image();
            await new Promise((resolve, reject) => {
              img.onload = resolve; img.onerror = reject;
              img.src = dataUrl;
            });
            const maxSize = 200;
            let w = img.width, h = img.height;
            if(w > h){ h = Math.round(h * maxSize / w); w = maxSize; }
            else { w = Math.round(w * maxSize / h); h = maxSize; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            updates.avatar_url = canvas.toDataURL('image/jpeg', 0.7);
            avatarUploaded = true;
          } catch(e){ console.warn('Data URL fallback error:', e && e.message || e); }
        }

        if(!avatarUploaded){
          toast('Erro no upload da foto, mas salvando perfil...');
        }
        _epAvatarFile = null;
        btn.textContent = 'Salvando...';
      }

      // Business logo (sincronizado com a aba Camisetas / shirts)
      let _logoChanged = false;
      if(_epLogoFile){
        btn.textContent = 'Enviando logo...';
        try {
          const ext = (_epLogoFile.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
          const path = currentUser.id + '/business_logo.' + ext;
          const { error: upErr } = await sb.storage.from('posts').upload(path, _epLogoFile, { upsert: true, contentType: _epLogoFile.type });
          if(upErr) throw upErr;
          const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
          const publicUrl = urlData?.publicUrl ? urlData.publicUrl + '?t=' + Date.now() : null;
          if(publicUrl){
            updates.business_logo_url = publicUrl;
            try { localStorage.setItem('business_logo_url', publicUrl); } catch(e){}
            _logoChanged = true;
          }
        } catch(e){
          console.warn('business logo upload falhou:', e?.message || e);
          // Fallback: data URL
          try {
            const dataUrl = await new Promise((res, rej) => {
              const r = new FileReader();
              r.onload = ev => res(ev.target.result);
              r.onerror = rej;
              r.readAsDataURL(_epLogoFile);
            });
            updates.business_logo_url = dataUrl;
            try { localStorage.setItem('business_logo_url', dataUrl); } catch(e2){}
            _logoChanged = true;
          } catch(e2){ console.warn('logo data-url fallback falhou:', e2 && e2.message || e2); }
        }
        _epLogoFile = null;
        btn.textContent = 'Salvando...';
      } else if(_epLogoClear){
        updates.business_logo_url = null;
        try { localStorage.removeItem('business_logo_url'); } catch(e){}
        _logoChanged = true;
      }

      // Try update first, then insert if profile doesn't exist
      const existing = await DB.profiles.getById(currentUser.id, 'id');
      if(existing){
        const { error } = await sb.from('profiles').update(updates).eq('id', currentUser.id);
        if(error){
          console.error('Profile update error:', error && error.message || error);
          throw error;
        }
      } else {
        updates.id = currentUser.id;
        updates.role = currentUser.user_metadata?.role || currentUser.user_metadata?.user_type || 'cliente';
        updates.user_type = updates.role;
        const { error } = await sb.from('profiles').insert(updates);
        if(error){
          console.error('Profile insert error:', error && error.message || error);
          throw error;
        }
      }

      // Email: best-effort (coluna pode nao existir se o SQL nao foi rodado;
      // nao deve derrubar o resto do salvamento)
      const epEmail = document.getElementById('ep-email').value.trim();
      if(epEmail){
        try {
          const { error: emErr } = await sb.from('profiles').update({ email: epEmail }).eq('id', currentUser.id);
          if(emErr) console.warn('email nao persistido (rode o supabase_init.sql):', emErr.message);
        } catch(e){ console.warn('email update falhou:', e && e.message || e); }
      }
      // Raio de atendimento: best-effort (coluna pode nao existir se o SQL
      // nao foi rodado; nao deve derrubar o resto do salvamento)
      try {
        const { error: rErr } = await sb.from('profiles').update({ service_radius: radiusToSave }).eq('id', currentUser.id);
        if(rErr) console.warn('service_radius nao persistido (rode o SQL):', rErr.message);
      } catch(e){ console.warn('service_radius update falhou:', e && e.message || e); }
      toast('Perfil salvo!');
      closeModals();
      // Update all avatar locations after save
      if(updates.avatar_url){
        const myAvEl = document.getElementById('myprofile-avatar');
        if(myAvEl) myAvEl.src = updates.avatar_url;
        const storyAvEl = document.getElementById('my-story-avatar');
        if(storyAvEl) storyAvEl.src = updates.avatar_url;
      }
      // Sync business logo into shirts builder (if mounted)
      if(_logoChanged){
        const chest = document.getElementById('shirt-chest-logo');
        if(chest){
          if(updates.business_logo_url){
            if(typeof _applyOwnLogoToShirt === 'function'){
              _applyOwnLogoToShirt(updates.business_logo_url, document.getElementById('ai-logo-name')?.value?.trim() || null);
            }
          } else {
            chest.src = ''; chest.style.display = 'none';
            const ph = document.getElementById('shirt-chest-placeholder');
            if(ph) ph.style.display = 'flex';
            const chip = document.getElementById('shirt-logo-pintor-chip');
            if(chip){ chip.innerHTML = 'seu_perfil'; }
          }
        }
        _epLogoClear = false;
      }
      invalidateMyProfile();
      loadMyProfileData();
      updateMyStoryAvatar();
    } catch(e){
      console.error('saveEditProfile error:', e && e.message || e);
      toast('Erro ao salvar: ' + (e.message || 'tente novamente'));
    }
    btn.textContent = 'Salvar'; btn.disabled = false;
    if(btn) delete btn.dataset._loading;
  }

  function sharePost(postId){
    if(navigator.share){
      navigator.share({ title:'QueroUmaCor', text:'Confira este post no QueroUmaCor!', url:window.location.href }).catch(()=>{});
    } else {
      navigator.clipboard.writeText(window.location.href).then(()=>toast('Link copiado!')).catch(()=>toast('Compartilhar indisponível'));
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.profileEdit = {
    previewAvatar,
    _epShowLogo,
    previewEpLogo,
    removeEpLogo,
    openEditProfile,
    loadCidadesDoEstado,
    _epStateChanged,
    openEditEspecialidades,
    saveEspecialidades,
    openEditRaio,
    saveRaio,
    _epSpecRole,
    _epSpecsSetup,
    toggleEpSpecs,
    _epSpecsApply,
    saveEditProfile,
    sharePost
  };
})();
