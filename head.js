const SUPABASE_URL = 'https://uwqebaqweehiljsqkifm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cWViYXF3ZWVoaWxqc3FraWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjYzMjgsImV4cCI6MjA4OTgwMjMyOH0.yp-z4iMifiOV3ftLVIHOFEQBLcMBdU8VFok7VKlSFg8';
let _supabase = null;
let currentUser = null;

function getSupabase() {
  if (!_supabase && window.supabase) {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

// Cache curto do perfil do usuário logado. Evita várias queries idênticas
// a 'profiles' no login — loadMyProfileData, refreshProStatus, loadUserState
// e updateMyStoryAvatar disparam quase juntas. Com o dedup do _inflight,
// todas compartilham UMA requisição.
let _myProfileCache = null;
let _myProfileCacheAt = 0;
let _myProfileInflight = null;
async function getMyProfile(force){
  const sb = getSupabase();
  if(!sb || !currentUser) return null;
  if(!force && _myProfileCache && Date.now() - _myProfileCacheAt < 15000) return _myProfileCache;
  if(!force && _myProfileInflight) return _myProfileInflight;
  _myProfileInflight = sb.from('profiles').select('*').eq('id', currentUser.id).single()
    .then(({ data }) => {
      _myProfileCache = data || null;
      _myProfileCacheAt = Date.now();
      _myProfileInflight = null;
      return _myProfileCache;
    })
    .catch(e => {
      _myProfileInflight = null;
      console.warn('getMyProfile:', e && e.message || e);
      return _myProfileCache;
    });
  return _myProfileInflight;
}
function invalidateMyProfile(){ _myProfileCache = null; _myProfileCacheAt = 0; }

let _feedLoaded = false;
async function initAuth() {
  const sb = getSupabase();
  if (!sb) return;

  // Detect password recovery redirect via URL hash (Supabase appends #type=recovery)
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const isRecovery = hashParams.get('type') === 'recovery';

  const { data: { session } } = await sb.auth.getSession();

  if (isRecovery) {
    currentUser = session ? session.user : null;
    // Clean the recovery hash from URL without triggering navigation
    history.replaceState(null, '', window.location.pathname + window.location.search);
    showScreen('feed');
    // Small delay so the feed screen renders before the modal opens
    setTimeout(() => { if(typeof showModal === 'function') showModal('reset-pw-modal'); }, 80);
    sb.auth.onAuthStateChange((event, session) => {
      if(event === 'PASSWORD_RECOVERY') return; // already handled above
      currentUser = session ? session.user : null;
      invalidateMyProfile();
      if(currentUser){
        if(typeof loadUserState==='function') loadUserState();
        autoDetectRole();
        setupGlobalMsgSubscription();
        setupNotifSubscription();
        setupPipelineSubscription();
        refreshProStatus();
        checkAdminEntry();
        if(!_feedLoaded){ _feedLoaded = true; loadFeed(); }
      } else {
        _isPro = false; _isAdmin = false; _feedLoaded = false;
        if(_globalMsgSub){ _globalMsgSub.unsubscribe(); _globalMsgSub=null; }
        if(typeof _notifSub !== 'undefined' && _notifSub){ _notifSub.unsubscribe(); _notifSub=null; }
        if(typeof _pipelineSub !== 'undefined' && _pipelineSub){ _pipelineSub.unsubscribe(); _pipelineSub=null; }
      }
    });
    return;
  }

  if (session) {
    currentUser = session.user;
    if(typeof loadUserState==='function') loadUserState();
    showScreen('feed');
    autoDetectRole();
    setupGlobalMsgSubscription();
    setupNotifSubscription();
    setupPipelineSubscription();
    refreshProStatus();
    checkAdminEntry();
    handleProReturn();
    // Load feed once right after auth
    _feedLoaded = true;
    loadFeed();
  } else {
    loadFeed();
  }
  handleReferralParam();
  sb.auth.onAuthStateChange((event, session) => {
    currentUser = session ? session.user : null;
    invalidateMyProfile();
    if(event === 'PASSWORD_RECOVERY'){
      if(typeof showScreen === 'function') showScreen('feed');
      setTimeout(() => { if(typeof showModal === 'function') showModal('reset-pw-modal'); }, 80);
      return;
    }
    if(currentUser){
      if(typeof loadUserState==='function') loadUserState();
      autoDetectRole();
      setupGlobalMsgSubscription();
      setupNotifSubscription();
      setupPipelineSubscription();
      refreshProStatus();
      checkAdminEntry();
      if(!_feedLoaded){ _feedLoaded = true; loadFeed(); }
    } else {
      _isPro = false;
      _isAdmin = false;
      _feedLoaded = false;
      if(_globalMsgSub){ _globalMsgSub.unsubscribe(); _globalMsgSub=null; }
      if(typeof _notifSub !== 'undefined' && _notifSub){ _notifSub.unsubscribe(); _notifSub=null; }
      if(typeof _pipelineSub !== 'undefined' && _pipelineSub){ _pipelineSub.unsubscribe(); _pipelineSub=null; }
    }
  });
}
function autoDetectRole(){
  if(!currentUser) return;
  const meta = currentUser.user_metadata || {};
  const userType = meta.user_type || meta.role || 'cliente';
  if(isProfessionalRole(userType)) setMode(userType);
  else setMode('cliente');
  // Load full profile from DB
  loadMyProfileData();
  updateMyStoryAvatar();
}

async function loadMyProfileData(){
  if(!currentUser) return;
  const sb = getSupabase();
  if(!sb) return;
  try {
    const prof = await getMyProfile();
    const nameEl = document.getElementById('myprofile-name');
    const subEl = document.getElementById('myprofile-sub');
    const avatarEl = document.querySelector('#screen-feed .ph-avatar img, #screen-feed img[style*="border-radius"]');
    if(prof){
      let name = prof.name || currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'Seu Nome';
      if(name.includes('@')) name = name.split('@')[0];
      name = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const tag = prof.tag || currentUser.user_metadata?.tag || '';
      const city = [prof.city, prof.state].filter(Boolean).join(', ');
      const _meta = currentUser.user_metadata || {};
      const role = prof.role || prof.user_type || _meta.user_type || _meta.role || 'cliente';
      if(nameEl) nameEl.textContent = name;
      if(subEl){
        const roleLabels = {pintor:'Pintor',grafiteiro:'Grafiteiro/Muralista',automotivo:'Pintor Automotivo',cliente:'Cliente'};
        const roleColors = {pintor:'#ff6b35',grafiteiro:'#8338ec',automotivo:'#2ec4b6',cliente:'rgba(255,255,255,.4)'};
        let subHtml = '';
        if(tag) subHtml += '@' + escapeHtml(tag);
        if(city) subHtml += (subHtml?' · ':'') + escapeHtml(city);
        if(roleLabels[role]){
          subHtml += ' <span style="display:inline-block;background:'+(roleColors[role]||'var(--muted)')+';color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;vertical-align:middle;">'+roleLabels[role]+'</span>';
        }
        subEl.innerHTML = subHtml || 'Configure seu perfil';
      }
      // Update myprofile avatar
      const avatarFallback = 'https://ui-avatars.com/api/?name='+encodeURIComponent(name)+'&background=e8e2d9&color=1a1a2e&size=96';
      const avatarSrc = prof.avatar_url || avatarFallback;
      const myAvatar = document.getElementById('myprofile-avatar');
      if(myAvatar){
        myAvatar.onerror = function(){ this.onerror=null; this.src=avatarFallback; };
        myAvatar.src = avatarSrc;
      }
      // Also update story circle avatar
      const storyAv = document.getElementById('my-story-avatar');
      if(storyAv){
        storyAv.onerror = function(){ this.onerror=null; this.src=avatarFallback; };
        storyAv.src = avatarSrc;
      }
      // Set mode based on DB role (only if changed to avoid flash)
      const targetMode = isProfessionalRole(role) ? role : 'cliente';
      if(targetMode !== currentMode) setMode(targetMode);
    } else {
      // Fallback to user_metadata
      const meta = currentUser.user_metadata || {};
      let fallbackName = meta.name || currentUser.email?.split('@')[0] || 'Seu Nome';
      if(fallbackName.includes('@')) fallbackName = fallbackName.split('@')[0];
      fallbackName = fallbackName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if(nameEl) nameEl.textContent = fallbackName;
      if(subEl) subEl.textContent = meta.tag ? '@' + meta.tag : 'Configure seu perfil';
    }
    // Load stats (posts, followers, following)
    loadMyProfileStats();
  } catch(e){ console.warn('loadMyProfileData error:', e); }
}

async function loadMyProfileStats(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  try {
    // Count posts
    const { count: postCount } = await sb.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).neq('media_type', 'story');
    const postsEl = document.getElementById('myprofile-posts-count');
    if(postsEl) postsEl.textContent = postCount || 0;

    // Count followers (people following me)
    const { count: followersCount } = await sb.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', currentUser.id);
    const followersEl = document.getElementById('myprofile-followers-count');
    if(followersEl) followersEl.textContent = followersCount || 0;

    // Count following (people I follow)
    const { count: followingCount } = await sb.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', currentUser.id);
    const followingEl = document.getElementById('myprofile-following-count');
    if(followingEl) followingEl.textContent = followingCount || 0;
  } catch(e){ console.warn('loadMyProfileStats error:', e); }
  loadMyPortfolio();
}

async function loadMyPortfolio(){
  const box = document.getElementById('myprofile-portfolio');
  if(!box) return;
  const sb = getSupabase();
  if(!sb || !currentUser){ box.innerHTML = ''; return; }
  try {
    const { data: posts, error } = await sb.from('posts').select(POST_COLS)
      .eq('user_id', currentUser.id).neq('media_type','story')
      .order('created_at',{ascending:false}).limit(60);
    if(error) throw error;
    if(!posts || posts.length === 0){
      box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px;">Você ainda não publicou trabalhos.<br>Toque em <b>+ Adicionar</b> para postar fotos e vídeos.</div>';
      return;
    }
    box.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">' + posts.map(p => {
      const cap = (p.caption || '').replace(/</g,'&lt;');
      const isVid = p.media_type === 'video';
      const pending = p.status === 'pending';
      const media = p.media_url
        ? (isVid
            ? `<video src="${p.media_url}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video>`
            : `<img src="${p.media_url}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">`)
        : `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:8px;font-size:11px;color:var(--muted);text-align:center;">${cap || 'Post'}</div>`;
      return `<div onclick="showScreen('feed')" style="position:relative;aspect-ratio:1;background:var(--ink);border-radius:8px;overflow:hidden;cursor:pointer;">
        ${media}
        ${isVid ? '<div style="position:absolute;top:6px;right:6px;color:#fff;font-size:13px;text-shadow:0 1px 3px rgba(0,0,0,.6);">▶</div>' : ''}
        ${pending ? '<div style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,.7);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;">EM ANÁLISE</div>' : ''}
        ${cap ? `<div style="position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;font-size:10px;padding:14px 6px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cap}</div>` : ''}
      </div>`;
    }).join('') + '</div>';
  } catch(e){
    console.warn('loadMyPortfolio:', e);
    box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px;">Erro ao carregar portfólio.</div>';
  }
}

async function openFollowersModal(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const list = document.getElementById('followers-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Carregando...</div>';
  showModal('followers-modal');
  try {
    const { data } = await sb.from('follows').select('follower_id').eq('following_id', currentUser.id);
    if(!data || data.length === 0){
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);">Nenhum seguidor ainda</div>';
      return;
    }
    const ids = data.map(f => f.follower_id);
    const { data: profs } = await sb.from('profiles').select('id, name, tag, avatar_url').in('id', ids);
    list.innerHTML = '';
    (profs||[]).forEach(p => {
      const name = p.name || 'Usuário';
      const tag = p.tag ? '@' + p.tag : '';
      const avatar = p.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(name)+'&background=e8e2d9&color=1a1a2e&size=96';
      list.innerHTML += `<div onclick="hideModal('followers-modal');openUserProfile('${p.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;flex-shrink:0;"><img src="${avatar}" style="width:100%;height:100%;object-fit:cover"></div>
        <div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>${tag ? '<div style="font-size:12px;color:var(--muted);">'+tag+'</div>' : ''}</div>
      </div>`;
    });
  } catch(e){ list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Erro ao carregar</div>'; }
}

async function openFollowingModal(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const list = document.getElementById('following-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Carregando...</div>';
  showModal('following-modal');
  try {
    const { data } = await sb.from('follows').select('following_id').eq('follower_id', currentUser.id);
    if(!data || data.length === 0){
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);">Voce nao segue ninguem ainda</div>';
      return;
    }
    const ids = data.map(f => f.following_id);
    const { data: profs } = await sb.from('profiles').select('id, name, tag, avatar_url').in('id', ids);
    list.innerHTML = '';
    (profs||[]).forEach(p => {
      const name = p.name || 'Usuário';
      const tag = p.tag ? '@' + p.tag : '';
      const avatar = p.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(name)+'&background=e8e2d9&color=1a1a2e&size=96';
      list.innerHTML += `<div onclick="hideModal('following-modal');openUserProfile('${p.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;flex-shrink:0;"><img src="${avatar}" style="width:100%;height:100%;object-fit:cover"></div>
        <div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>${tag ? '<div style="font-size:12px;color:var(--muted);">'+tag+'</div>' : ''}</div>
        <button onclick="event.stopPropagation();toggleFollowFromList(this,'${p.id}')" class="following" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif;background:rgba(0,0,0,.05);border:1px solid var(--border);color:var(--ink);">Seguindo</button>
      </div>`;
    });
  } catch(e){ list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Erro ao carregar</div>'; }
}

async function toggleFollowFromList(btn, userId){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  if(btn.classList.contains('following')){
    await sb.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', userId);
    btn.textContent = 'Seguir';
    btn.classList.remove('following');
    btn.style.background = 'var(--p1)';
    btn.style.color = '#fff';
    btn.style.border = 'none';
  } else {
    await sb.from('follows').insert({ follower_id: currentUser.id, following_id: userId });
    btn.textContent = 'Seguindo';
    btn.classList.add('following');
    btn.style.background = 'rgba(0,0,0,.05)';
    btn.style.color = 'var(--ink)';
    btn.style.border = '1px solid var(--border)';
  }
  loadMyProfileStats();
}

async function shareProfile(){
  if(!currentUser){ toast('Faça login primeiro'); return; }
  const sb = getSupabase();
  let prof = {};
  try {
    if(sb){
      const { data } = await sb.from('profiles')
        .select('name, role, user_type, city, state, specialties')
        .eq('id', currentUser.id).single();
      prof = data || {};
    }
  } catch(e){ console.warn('shareProfile profile fetch:', e); }
  const name = prof.name || document.getElementById('myprofile-name')?.textContent || 'Profissional';
  const roleMap = { pintor:'Pintor', grafiteiro:'Grafiteiro/Muralista', automotivo:'Pintor Automotivo', funileiro:'Funileiro', cliente:'Cliente' };
  const role = roleMap[String(prof.role||prof.user_type||'').toLowerCase()] || 'Profissional';
  const local = [prof.city, prof.state].filter(Boolean).join(' - ');
  const link = window.location.origin + '/?ref=' + currentUser.id;
  let brief = '🎨 ' + name + ' — ' + role + ' no QueroUmaCor\n';
  if(local) brief += '📍 ' + local + '\n';
  if(prof.specialties) brief += '🛠️ ' + prof.specialties + '\n';
  brief += '\nVeja meu portfólio completo e crie sua conta gratuita por este link:\n' + link;
  if(navigator.share){
    navigator.share({ title: name + ' — QueroUmaCor', text: brief }).catch(()=>{});
  } else if(navigator.clipboard){
    navigator.clipboard.writeText(brief).then(()=>toast('Perfil e link copiados!')).catch(()=>toast('Link: '+link));
  } else {
    prompt('Copie e compartilhe:', brief);
  }
}

async function updateMyStoryAvatar(){
  const el = document.getElementById('my-story-avatar');
  const nameEl = document.getElementById('my-story-name');
  if(!el || !currentUser) return;
  const sb = getSupabase();
  if(!sb) return;
  try {
    const profile = await getMyProfile();
    const fullName = (profile && profile.name) || currentUser.user_metadata?.name || '';
    const firstName = fullName.split(' ')[0] || 'Seu story';
    if(nameEl) nameEl.textContent = firstName;
    if(profile && profile.avatar_url){
      el.src = profile.avatar_url;
    } else {
      el.src = 'https://ui-avatars.com/api/?name='+encodeURIComponent(fullName || 'U')+'&background=e8e2d9&color=1a1a2e&size=96';
    }
  } catch(e){ console.warn('updateMyStoryAvatar error:', e); }
}

async function doLoginSupabase(email, password) {
  const sb = getSupabase();
  if (!sb) { toast('Erro: Supabase não carregou'); return; }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { toast('Erro: ' + error.message); }
    else { currentUser = data.user; autoDetectRole(); showScreen('feed'); }
  } catch(e) {
    toast('Erro de conexão: ' + e.message);
  }
}
function doLogin(){
  const email=document.getElementById('login-email').value.trim();
  const pw=document.getElementById('login-pw').value;
  if(!email||!pw){toast('⚠️ Preencha email e senha');return;}
  doLoginSupabase(email,pw);
}

async function doRegisterSupabase(name, email, password, type, tag) {
  const sb = getSupabase();
  if (!sb) { showScreen('feed'); return; }
  const phone = document.getElementById('s-phone') ? document.getElementById('s-phone').value.trim() : '';
  const cityName = document.getElementById('s-city') ? document.getElementById('s-city').value.trim() : '';
  const stateName = document.getElementById('s-state') ? document.getElementById('s-state').value.trim() : '';
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name: name, user_type: type || 'cliente', tag: tag } } });
  if (error) {
    // Caso comum: a pessoa já tem conta com esse e-mail. Tenta logar
    // com as mesmas credenciais (se for ela mesma) e segue o fluxo.
    if (/already registered|already exists|user_already_exists/i.test(error.message || '')) {
      const { data: si, error: siErr } = await sb.auth.signInWithPassword({ email, password });
      if (!siErr && si && si.user) {
        currentUser = si.user;
        autoDetectRole();
        toast('Bem-vindo de volta!');
        if (validatedInviteCode && validatedInviteCode.created_by && typeof openUserProfile === 'function') {
          openUserProfile(validatedInviteCode.created_by);
        } else {
          showScreen('feed');
        }
        return;
      }
      alert('Esse e-mail já tem conta. Entre com sua senha na tela de login.');
      showScreen('login');
      const emEl = document.getElementById('login-email');
      if (emEl) emEl.value = email;
      return;
    }
    alert('Erro: ' + error.message);
    return;
  }
  // Upload avatar if selected
  let avatarUrl = null;
  if(data && data.user){
    const avatarFile = document.getElementById('signup-avatar-input').files[0];
    if(avatarFile){
      try {
        const ext = avatarFile.name.split('.').pop();
        const path = data.user.id + '/avatar.' + ext;
        await sb.storage.from('posts').upload(path, avatarFile, { upsert: true });
        const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
        avatarUrl = urlData.publicUrl;
      } catch(e){ console.warn('Avatar upload error:', e); }
    }
    // Create profile record with referral tracking
    const profileData = {
      id: data.user.id,
      name: name,
      tag: tag || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.]/g, ''),
      user_type: type || 'cliente',
      role: type || 'cliente',
      city: cityName,
      state: stateName,
      phone: phone,
      avatar_url: avatarUrl,
      created_at: new Date().toISOString()
    };
    // Profession only applies to professionals, not clients
    if(isProfessionalRole(type)){
      profileData.profession = getSelectedProfession();
      const specs = [...document.querySelectorAll('#spec-grid .spec-chip.sel')].map(c=>c.textContent.trim());
      if(specs.length) profileData.specialties = specs.join(', ');
    }
    // Track who invited this user
    if(validatedInviteCode){
      if(validatedInviteCode.code) profileData.invite_code_used = validatedInviteCode.code;
      if(validatedInviteCode.created_by) profileData.invited_by = validatedInviteCode.created_by;
    }
    try {
      await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
    } catch(e){ console.warn('Profile create error:', e); }
    // Registra a indicação — o indicador ganha pontos via trigger no banco
    if(validatedInviteCode && validatedInviteCode.created_by && validatedInviteCode.created_by !== data.user.id){
      try {
        await sb.from('referrals').insert({
          referrer_id: validatedInviteCode.created_by,
          referred_id: data.user.id,
          status: 'completed',
          bonus_points: 20
        });
      } catch(e){ console.warn('Referral insert error:', e); }
    }
  }
  currentUser = data.user;
  autoDetectRole();
  toast('Conta criada com sucesso!');
  // Se veio por convite, mostra direto o perfil de quem convidou —
  // o cadastrado vê quem o trouxe pro app e pode seguir / pedir orçamento.
  if (validatedInviteCode && validatedInviteCode.created_by && typeof openUserProfile === 'function') {
    openUserProfile(validatedInviteCode.created_by);
  } else {
    showScreen('feed');
  }
}

function previewSignupAvatar(input){
  const file = input.files[0];
  if(!file) return;
  const url = URL.createObjectURL(file);
  const preview = document.getElementById('signup-avatar-preview');
  preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
}

async function doLogoutSupabase() {
  // Limpa o estado local imediatamente — não aguarda o servidor. Se o
  // signOut travar na rede, a UI já volta pra tela de login sem ficar
  // pendurada em "Saindo...".
  currentUser = null;
  if(typeof invalidateMyProfile === 'function') invalidateMyProfile();
  showScreen('login');
  const sb = getSupabase();
  if (sb) sb.auth.signOut().catch(e => console.warn('signOut:', e));
}
function doLogout() {
  doLogoutSupabase();
  toast('Você saiu da conta');
}

// ══ SEARCH PEOPLE ══
function getSearchEmpty(){
  setTimeout(loadPeopleSuggestions, 0);
  return `<div style="padding:14px 14px 4px;">
    <div style="font-size:13px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.5px;">Sugestões para você</div>
    <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">Pessoas que você pode seguir</div>
  </div>
  <div id="people-suggestions"><div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Carregando sugestões...</div></div>`;
}

async function loadPeopleSuggestions(){
  const box = document.getElementById('people-suggestions');
  if(!box) return;
  const sb = getSupabase();
  if(!sb){ setTimeout(loadPeopleSuggestions, 500); return; }
  try {
    const res = await sb.from('profiles').select('id, name, tag, avatar_url, user_type, role, city, created_at').order('created_at', { ascending: false }).limit(60);
    if(res.error){ box.innerHTML='<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Não foi possível carregar sugestões.</div>'; return; }
    let people = res.data || [];
    const myId = currentUser ? currentUser.id : null;
    let followingIds = [];
    if(myId){
      const { data: fd } = await sb.from('follows').select('following_id').eq('follower_id', myId);
      if(fd) followingIds = fd.map(f => f.following_id);
    }
    let myCity = '';
    if(myId){
      const { data: mp } = await sb.from('profiles').select('city').eq('id', myId).maybeSingle();
      myCity = ((mp && mp.city) || '').toLowerCase();
    }
    people = people.filter(p => p.id !== myId && !followingIds.includes(p.id));
    // Mesma cidade primeiro (proxy de "distância" enquanto não temos lat/lng)
    if(myCity){
      people.sort((a,b) => {
        const sa = ((a.city||'').toLowerCase()===myCity)?0:1;
        const sb_ = ((b.city||'').toLowerCase()===myCity)?0:1;
        return sa - sb_;
      });
    }
    people = people.slice(0, 18);
    if(people.length === 0){
      box.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Sem sugestões no momento.</div>';
      return;
    }
    box.innerHTML = people.map(p => {
      const isPintor = isProfessionalRole(p.role) || isProfessionalRole(p.user_type);
      const roleBadge = isPintor ? '<span style="background:var(--ink);color:var(--p1);font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:.3px;margin-left:5px;">PINTOR</span>' : '';
      const avatarUrl = p.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(p.name||'?') + '&background=e8e2d9&color=1a1a2e&size=96';
      const tagDisplay = p.tag ? '@' + p.tag : '';
      return `<div class="search-result-item" onclick="openUserProfile('${p.id}')">
        <div class="search-result-avatar"><img src="${avatarUrl}" alt=""></div>
        <div class="search-result-info">
          <div class="search-result-tag">${escapeHtml(p.name||'Sem nome')}${roleBadge}</div>
          <div class="search-result-name">${escapeHtml(tagDisplay)}${tagDisplay && p.city ? ' · ' : ''}${escapeHtml(p.city||'')}</div>
        </div>
        <button class="search-result-follow follow" onclick="event.stopPropagation();toggleFollow('${p.id}',this)">Seguir</button>
      </div>`;
    }).join('');
  } catch(e){
    box.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Erro ao carregar sugestões.</div>';
  }
}

let searchTimeout;
function searchPeople(query){
  clearTimeout(searchTimeout);
  const container=document.getElementById('search-results');
  if(!query||query.trim().length<2){
    container.innerHTML=getSearchEmpty();
    return;
  }
  searchTimeout=setTimeout(async()=>{
    const sb=getSupabase();
    if(!sb)return;
    // sanitiza para o padrão ilike do PostgREST (remove caracteres que quebram o .or())
    const cleanQuery=query.replace('@','').trim().toLowerCase().replace(/[,%()*]/g,' ').trim();
    if(!cleanQuery){ container.innerHTML=getSearchEmpty(); return; }
    let data = [];
    try {
      // Busca no servidor (escala sem baixar a tabela inteira)
      const pat = '%' + cleanQuery + '%';
      const res = await sb.from('profiles')
        .select('id, name, tag, avatar_url, user_type, role, city')
        .or('name.ilike.'+pat+',tag.ilike.'+pat+',city.ilike.'+pat)
        .limit(25);
      if(res.error) console.warn('searchPeople error:', res.error.message);
      data = res.data || [];
    } catch(e) { console.warn('searchPeople exception:', e); }
    if(!data||data.length===0){
      container.innerHTML=`<div style="text-align:center;padding:60px 20px;color:var(--muted);">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="var(--border)" stroke-width="1.5" style="margin-bottom:14px;"><path d="M16 16l-3.5-3.5"/><circle cx="10" cy="10" r="7"/></svg>
        <div style="font-size:14px;font-weight:600;color:var(--ink);margin-bottom:4px;">Nenhum resultado</div>
        <div style="font-size:13px;">Ninguem encontrado para "${escapeHtml(query)}"</div>
      </div>`;
      return;
    }
    let followingIds=[];
    if(currentUser){
      const {data:followData}=await sb.from('follows').select('following_id').eq('follower_id',currentUser.id);
      if(followData) followingIds=followData.map(f=>f.following_id);
    }
    container.innerHTML=data.map(p=>{
      const isFollowing=followingIds.includes(p.id);
      const isSelf=currentUser&&currentUser.id===p.id;
      const isPintor=isProfessionalRole(p.role)||isProfessionalRole(p.user_type);
      const roleBadge=isPintor?'<span style="background:var(--ink);color:var(--p1);font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:.3px;margin-left:5px;">PINTOR</span>':'';
      const avatarUrl=p.avatar_url||'https://ui-avatars.com/api/?name='+encodeURIComponent(p.name||'?')+'&background=e8e2d9&color=1a1a2e&size=96';
      const tagDisplay=p.tag?'@'+p.tag:'';
      return `<div class="search-result-item" onclick="openUserProfile('${p.id}')">
        <div class="search-result-avatar"><img src="${avatarUrl}" alt=""></div>
        <div class="search-result-info">
          <div class="search-result-tag">${p.name||'Sem nome'}${roleBadge}</div>
          <div class="search-result-name">${tagDisplay}${tagDisplay&&p.city?' · ':''}${p.city||''}</div>
        </div>
        ${isSelf?'':`<button class="search-result-follow ${isFollowing?'following':'follow'}" onclick="event.stopPropagation();toggleFollow('${p.id}',this)">${isFollowing?'Seguindo':'Seguir'}</button>`}
      </div>`;
    }).join('');
  },300);
}

async function openUserProfile(userId, preview){
  const sb = getSupabase();
  if(!sb) return;
  try {
    const { data: prof } = await sb.from('profiles').select('*').eq('id', userId).single();
    if(!prof){ toast('Perfil não encontrado'); return; }
    // Check if it's own profile (preview mostra a visão pública do próprio perfil)
    if(currentUser && userId === currentUser.id && !preview){
      showScreen('myprofile'); return;
    }
    // For DB profiles, update profile screen elements directly
    const screen = document.getElementById('screen-profile');
    const nameEl = screen.querySelector('.ph-name');
    const bioEl = screen.querySelector('.ph-bio');
    const avatarEl = screen.querySelector('.ph-avatar img');
    const name = prof.name || 'Usuário';
    const avatar = prof.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(name)+'&background=e8e2d9&color=1a1a2e&size=200';
    const location = (prof.city||'')+(prof.state?' · '+prof.state:'');
    const _rl = prof.role||prof.user_type||'cliente';
    const role = {pintor:'Pintor',grafiteiro:'Grafiteiro/Muralista',automotivo:'Pintor Automotivo',cliente:'Cliente'}[_rl]||'Cliente';
    if(nameEl) nameEl.textContent = name;
    if(bioEl) bioEl.textContent = (prof.tag?'@'+prof.tag+' · ':'')+role+(location?' · '+location:'');
    if(avatarEl) avatarEl.src = avatar;

    // Load stats for this user
    const { count: postCount } = await sb.from('posts').select('*',{count:'exact',head:true}).eq('user_id',userId).neq('media_type','story');
    const { count: followersCount } = await sb.from('follows').select('*',{count:'exact',head:true}).eq('following_id',userId);
    const { count: followingCount } = await sb.from('follows').select('*',{count:'exact',head:true}).eq('follower_id',userId);
    const statsEl = screen.querySelector('.ph-stats');
    if(statsEl){
      statsEl.innerHTML = `
        <div class="ph-stat"><div class="ph-stat-n">${postCount||0}</div><div class="ph-stat-l">posts</div></div>
        <div class="ph-stat"><div class="ph-stat-n">${followersCount||0}</div><div class="ph-stat-l">seguidores</div></div>
        <div class="ph-stat"><div class="ph-stat-n">${followingCount||0}</div><div class="ph-stat-l">seguindo</div></div>
      `;
    }

    // Check if currently following
    let isFollowing = false;
    if(currentUser){
      const { data: fol } = await sb.from('follows').select('id').eq('follower_id',currentUser.id).eq('following_id',userId).limit(1);
      isFollowing = fol && fol.length > 0;
    }

    // Update buttons: Follow/Following + Chat + Cali Colors
    const btnsEl = screen.querySelector('.ph-btns');
    if(btnsEl){
      const followClass = isFollowing ? 'following' : 'follow';
      const followText = isFollowing ? 'Seguindo' : 'Seguir';
      const followStyle = isFollowing
        ? 'background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;'
        : 'background:var(--p1);border:none;color:#fff;';
      btnsEl.innerHTML = `
        <button class="ph-btn ${followClass}" onclick="toggleFollow('${userId}',this)" style="${followStyle}flex:1;padding:9px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">${followText}</button>
        <button class="ph-btn msg" onclick="startChatWith('${userId}','${name.replace(/'/g,"\\'")}')" style="padding:9px 14px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#fff;font-size:16px;cursor:pointer;">💬</button>
        <button class="ph-btn" onclick="showScreen('mkt')" style="padding:9px 14px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">🛒 Cali</button>
      `;
    }

    switchTab('works');
    renderRealProfileTabs(userId, name);
    showScreen('profile');
  } catch(e){
    console.error('openUserProfile error:', e);
    toast('Erro ao abrir perfil');
  }
}

// Preenche as abas do perfil público (screen-profile) com dados reais
async function renderRealProfileTabs(userId, name){
  const sb = getSupabase();
  if(!sb) return;
  const screen = document.getElementById('screen-profile');
  if(!screen) return;
  const esc = s => String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  // Empty state amigável reutilizável
  const emptyState = (icon, msg) => `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px 20px;"><div style="font-size:36px;margin-bottom:10px;">${icon}</div><div style="font-size:14px;">${msg}</div></div>`;

  try {
    const { data: posts } = await sb.from('posts').select(POST_COLS)
      .eq('user_id', userId).neq('media_type','story')
      .or('status.eq.approved,status.is.null')
      .order('created_at',{ascending:false}).limit(60);
    const all = posts || [];
    const imgs = all.filter(p => p.media_type !== 'video');
    const vids = all.filter(p => p.media_type === 'video');

    const worksGrid = screen.querySelector('#tab-works .works-grid');
    if(worksGrid){
      worksGrid.innerHTML = imgs.length
        ? imgs.map(p => `<div class="works-grid-item"><img src="${esc(p.media_url)}" alt="" loading="lazy"></div>`).join('')
        : emptyState('🎨', 'Portfólio em construção');
    }
    const vidsGrid = screen.querySelector('#tab-vids .works-grid');
    if(vidsGrid){
      vidsGrid.innerHTML = vids.length
        ? vids.map(p => `<div class="works-grid-item" style="position:relative"><video src="${esc(p.media_url)}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video><div style="position:absolute;inset:0;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;"><span style="font-size:26px;color:#fff;">▶</span></div></div>`).join('')
        : emptyState('🎬', 'Nenhum vídeo publicado ainda');
    }
  } catch(e){ console.warn('renderRealProfileTabs posts:', e); }

  try {
    const { data: quals } = await sb.from('qualifications').select('*')
      .eq('user_id', userId).order('created_at',{ascending:false});
    const certList = screen.querySelector('#tab-certs .cert-list');
    if(certList){
      certList.innerHTML = (quals && quals.length)
        ? quals.map(q => `<div class="cert-card" style="border-left:3px solid var(--p1);">
            <div class="cert-ic" style="background:var(--cream);font-size:22px;">${esc(q.icon||'🎓')}</div>
            <div class="cert-txt" style="flex:1"><div class="cert-n">${esc(q.title)}</div><div class="cert-o">${esc(q.org||'')}${q.year?' · '+esc(q.year):''}</div></div>
          </div>`).join('')
        : emptyState('🎓', 'Nenhuma formação cadastrada');
    }
  } catch(e){ console.warn('renderRealProfileTabs quals:', e); }

  try {
    const { data: courses } = await sb.from('courses').select('*')
      .eq('user_id', userId).order('created_at',{ascending:false});
    const cursosTab = screen.querySelector('#tab-cursos');
    if(cursosTab){
      cursosTab.innerHTML = (courses && courses.length)
        ? `<div style="font-size:13px;color:var(--muted);margin-bottom:14px;">Cursos criados por ${esc(name)}</div>` +
          courses.map(c => `<div style="background:var(--white);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:12px;">
            ${c.cover_url?`<div style="position:relative;"><img src="${esc(c.cover_url)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;">${c.duration?`<div style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;padding:3px 9px;border-radius:20px;">${esc(c.duration)}</div>`:''}</div>`:''}
            <div style="padding:14px;">
              <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${esc(c.title)}</div>
              <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${esc(c.subtitle||'')}</div>
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:16px;font-weight:800;color:var(--ink);">${c.is_free?'Grátis':('R$'+Number(c.price||0).toFixed(2).replace('.',','))}</div>
                ${c.link?`<a href="${esc(c.link)}" target="_blank" rel="noopener" style="background:var(--p1);color:#fff;text-decoration:none;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:700;">Acessar</a>`:''}
              </div>
            </div>
          </div>`).join('')
        : emptyState('📚', 'Nenhum curso publicado');
    }
  } catch(e){ console.warn('renderRealProfileTabs courses:', e); }

  try {
    const { data: pq } = await sb.from('quotes').select('id').eq('painter_id', userId);
    const qIds = (pq || []).map(q => q.id);
    let reviews = [];
    if(qIds.length){
      const { data: rv } = await sb.from('reviews')
        .select('rating, criteria, comment, created_at, reviewer:profiles!reviewer_id(name, avatar_url)')
        .in('quote_id', qIds).order('created_at', { ascending:false }).limit(40);
      reviews = rv || [];
    }
    const revList = screen.querySelector('#tab-reviews .reviews-list');
    if(revList){
      if(reviews.length){
        const avg = reviews.reduce((s,r)=>s+(+r.rating||0),0) / reviews.length;
        const stars = v => { const f=Math.max(0,Math.min(5,Math.round(v))); return '★'.repeat(f)+'☆'.repeat(5-f); };
        let h = '<div style="display:flex;align-items:center;gap:14px;background:var(--white);border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:14px;">'
          + '<div style="text-align:center;"><div style="font-size:32px;font-weight:800;font-family:Syne,sans-serif;color:var(--ink);line-height:1;">'+avg.toFixed(1)+'</div>'
          + '<div style="color:#f4a300;font-size:13px;margin-top:3px;">'+stars(avg)+'</div></div>'
          + '<div style="font-size:13px;color:var(--muted);">'+reviews.length+' avalia'+(reviews.length>1?'ções':'ção')+'</div></div>';
        h += reviews.map(r => {
          const rv = r.reviewer || {};
          const av = rv.avatar_url || ('https://ui-avatars.com/api/?name='+encodeURIComponent(rv.name||'C')+'&background=e8e2d9&color=1a1a2e&size=64');
          const date = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '';
          const crit = Array.isArray(r.criteria) ? r.criteria : [];
          return '<div style="background:var(--white);border-radius:14px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:9px;">'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:'+((crit.length||r.comment)?'8px':'0')+';">'
            + '<img src="'+esc(av)+'" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
            + '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--ink);">'+esc(rv.name||'Cliente')+'</div>'
            + '<div style="color:#f4a300;font-size:12px;">'+stars(+r.rating||0)+'</div></div>'
            + '<div style="font-size:11px;color:var(--muted);white-space:nowrap;">'+date+'</div></div>'
            + (crit.length?'<div style="display:flex;flex-wrap:wrap;gap:5px;'+(r.comment?'margin-bottom:8px;':'')+'">'+crit.map(c=>'<span style="font-size:10px;background:var(--cream);color:var(--muted);padding:2px 8px;border-radius:20px;">'+esc(c)+'</span>').join('')+'</div>':'')
            + (r.comment?'<div style="font-size:13px;color:var(--ink);line-height:1.5;">'+esc(r.comment)+'</div>':'')
            + '</div>';
        }).join('');
        revList.innerHTML = h;
      } else {
        revList.innerHTML = emptyState('⭐', 'Nenhuma avaliação ainda');
      }
    }
  } catch(e){
    console.warn('renderRealProfileTabs reviews:', e);
    const revList = screen.querySelector('#tab-reviews .reviews-list');
    if(revList) revList.innerHTML = emptyState('⭐', 'Nenhuma avaliação ainda');
  }
}

// Start a chat with a user from their profile
async function startChatWith(userId, userName){
  // Navigate to chat screen and create/open conversation
  showScreen('chat');
  // If openChatConversation exists, use it; otherwise just navigate
  if(typeof openChatConversation === 'function'){
    openChatConversation(userId, userName);
  } else {
    toast('Chat com ' + userName);
  }
}

async function toggleFollow(userId,btn){
  const sb=getSupabase();
  if(!sb||!currentUser){toast('Faça login primeiro');return;}
  const isFollowing=btn.classList.contains('following');
  if(isFollowing){
    await sb.from('follows').delete().eq('follower_id',currentUser.id).eq('following_id',userId);
    btn.textContent='Seguir';
    btn.classList.remove('following');
    btn.classList.add('follow');
    btn.style.background='var(--p1)';
    btn.style.border='none';
    btn.style.color='#fff';
    toast('Deixou de seguir');
  } else {
    await sb.from('follows').insert({follower_id:currentUser.id,following_id:userId});
    btn.textContent='Seguindo';
    btn.classList.remove('follow');
    btn.classList.add('following');
    btn.style.background='rgba(255,255,255,.12)';
    btn.style.border='1px solid rgba(255,255,255,.2)';
    btn.style.color='#fff';
    toast('Seguindo!');
  }
}

function togglePw(id,btn){
  const inp=document.getElementById(id);
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  btn.style.opacity=show?'1':'.5';
}

window.addEventListener('DOMContentLoaded', () => { initAuth(); });
