// ══ SCREENS ══
const screens=['login','signup','feed','explore','search','profile','orcamento','myprofile','calc','notif','chat','chatconv','pedidos','chat-conv','avaliar','mkt','camisetas'];
const bnMap={feed:'bn-feed',search:'bn-search',mkt:'bn-mkt',notif:'bn-notif',myprofile:'bn-myprofile'};
const noNav=['login','signup'];
function showScreen(n){
  screens.forEach(s=>{
    const el=document.getElementById('screen-'+s);
    if(el)el.classList.toggle('active',s===n);
  });
  Object.values(bnMap).forEach(id=>{document.getElementById(id)?.classList.remove('active');});
  if(bnMap[n])document.getElementById(bnMap[n]).classList.add('active');
  if(['pedidos','chat-conv','avaliar','camisetas'].includes(n)){document.getElementById('bn-myprofile')?.classList.add('active');}
  if(['chatconv'].includes(n)){/* chat is in top nav, no bottom nav highlight */}
  const topNav=document.querySelector('.top-nav');
  const botNav=document.querySelector('.bot-nav');
  if(topNav)topNav.style.display=noNav.includes(n)?'none':'flex';
  if(botNav)botNav.style.display=noNav.includes(n)?'none':'flex';
  const scrollArea=document.getElementById('scroll-area');
  if(scrollArea)scrollArea.scrollTop=0;
  closeModals();
  const pp=document.getElementById('painter-popup');
  if(pp)pp.classList.remove('show');
  if(n==='chat-conv'){setTimeout(()=>{const b=document.getElementById('chat-body');if(b)b.scrollTop=b.scrollHeight;},150);}
  if(n==='chatconv'){setTimeout(()=>{const a=document.getElementById('msgs-area');if(a)a.scrollTop=a.scrollHeight;},150);}
  if(n==='feed' && (!_lastFeedLoad || Date.now()-_lastFeedLoad > 30000)){ _feedLimit = FEED_PAGE; loadFeed(); }
  if(n==='mkt') { loadMktProducts(); updateCartBadge(); }
  if(n==='myprofile'){ loadMyProfileData(); refreshProStatus(); }
  if(n==='chat'){ loadChatList(); const cb=document.getElementById('chat-badge-dot'); if(cb) cb.style.display='none'; }
  if(n==='notif') loadNotifications();
  if(n==='pedidos') loadPedidos();
  if(n==='avaliar') loadAvaliarScreen();
  if(n==='camisetas') loadBusinessLogo();
}


// ══ TOAST ══
let tt;
function toast(msg){
  const el=document.getElementById('toast-el');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(tt); tt=setTimeout(()=>el.classList.remove('show'),2200);
}

// ══ MODALS ══
function showModal(id){document.getElementById(id).classList.add('open');}
function closeModals(){document.querySelectorAll('.overlay').forEach(m=>m.classList.remove('open'));}
function hideModal(id){document.getElementById(id).classList.remove('open');}

// ══ BEFORE/AFTER ══
const baStates={};
function toggleBA(id){
  baStates[id]=!baStates[id];
  const a=document.getElementById(id+'-a'), b=document.getElementById(id+'-b');
  const la=document.getElementById(id+'-la'), ld=document.getElementById(id+'-ld');
  if(baStates[id]){a.style.opacity='0';b.style.opacity='1';if(la)la.style.opacity='.4';if(ld)ld.style.opacity='1';}
  else{a.style.opacity='1';b.style.opacity='0';if(la)la.style.opacity='1';if(ld)ld.style.opacity='.4';}
}

// ══ PAINT BUCKET LIKE ══
const likes={f:1284,1:836,2:2107};
const liked={};
function paintLike(e,btnId,countId,color){
  liked[btnId]=!liked[btnId];
  const btn=document.getElementById(btnId);
  const svg=btn.querySelector('svg path');
  if(liked[btnId]){
    svg.setAttribute('fill',color); svg.setAttribute('stroke',color);
    likes[btnId.replace('lk-','')]++;
    splashPaint(e.clientX||e.touches?.[0]?.clientX||200, e.clientY||e.touches?.[0]?.clientY||300, color);
  } else {
    svg.setAttribute('fill','none'); svg.setAttribute('stroke','var(--ink)');
    likes[btnId.replace('lk-','')]--;
  }
  const cnt=document.getElementById(countId);
  const key=btnId.replace('lk-','');
  const n=likes[key];
  cnt.textContent=(key==='f')?n.toLocaleString('pt-BR'):n.toLocaleString('pt-BR')+' curtidas';
}

function splashPaint(x,y,color){
  const canvas=document.getElementById('splash-canvas');
  const rect=canvas.getBoundingClientRect();
  canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const cx=x-rect.left, cy=y-rect.top;
  const blobs=16;
  const particles=[];
  for(let i=0;i<blobs;i++){
    const angle=Math.random()*Math.PI*2;
    const speed=2+Math.random()*6;
    const size=4+Math.random()*14;
    particles.push({x:cx,y:cy,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-3,size,alpha:1,color});
  }
  // Central burst
  ctx.beginPath(); ctx.arc(cx,cy,28,0,Math.PI*2);
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,28);
  g.addColorStop(0,color+'cc'); g.addColorStop(1,color+'00');
  ctx.fillStyle=g; ctx.fill();
  let frame=0;
  function animate(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    particles.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.3; p.alpha-=0.04;
      if(p.alpha<=0)return;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size*(1-frame/30),0,Math.PI*2);
      ctx.fillStyle=color+(Math.floor(p.alpha*255).toString(16).padStart(2,'0'));
      ctx.fill();
    });
    frame++;
    if(frame<32)requestAnimationFrame(animate);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  animate();
}

// ══ PAINTER DATA ══
const painters={};

// ══ LOAD PROFILE DYNAMICALLY ══
let currentPainter='carlos';
function openProfile(id){
  currentPainter=id;
  const p=painters[id];

  // Hero
  document.querySelector('.ph-avatar img').src=p.img;
  document.querySelector('.ph-stat-n:nth-child(1)').textContent=p.posts;
  document.querySelectorAll('.ph-stat-n')[0].textContent=p.posts;
  document.querySelectorAll('.ph-stat-n')[1].textContent=p.seguidores;
  document.querySelectorAll('.ph-stat-n')[2].textContent=p.obras;
  const phName=document.querySelector('.ph-name');
  phName.innerHTML=p.name+(p.name.includes('✓')?'':' ✓')+(p.pro?' <span style="background:var(--p1);color:#fff;font-size:10px;padding:2px 8px;border-radius:20px;font-family:\'DM Sans\',sans-serif;font-weight:600">PRO</span>':'');
  document.querySelector('.ph-bio').innerHTML=p.bio.replace('\n','<br>');

  // Palette
  const pal=document.querySelector('.ph-palette');
  pal.innerHTML=p.palette.map(c=>`<div class="palette-dot" style="background:${c}"></div>`).join('');

  // Rating summary
  const ratingTotal=p.r5+p.r4+p.r3+p.r2+p.r1||1;
  document.querySelector('.cr-big-score').textContent=p.rating.toFixed(1);
  document.querySelector('.cr-total').textContent=p.total+' avaliações';
  document.querySelectorAll('.cr-bar-fill')[0].style.width=(p.r5/ratingTotal*100)+'%';
  document.querySelectorAll('.cr-bar-count')[0].textContent=p.r5;
  document.querySelectorAll('.cr-bar-fill')[1].style.width=(p.r4/ratingTotal*100)+'%';
  document.querySelectorAll('.cr-bar-count')[1].textContent=p.r4;
  document.querySelectorAll('.cr-bar-fill')[2].style.width=(p.r3/ratingTotal*100)+'%';
  document.querySelectorAll('.cr-bar-count')[2].textContent=p.r3;
  document.querySelectorAll('.cr-bar-fill')[3].style.width=(p.r2/ratingTotal*100)+'%';
  document.querySelectorAll('.cr-bar-count')[3].textContent=p.r2;
  document.querySelectorAll('.cr-bar-fill')[4].style.width=(p.r1/ratingTotal*100)+'%';
  document.querySelectorAll('.cr-bar-count')[4].textContent=p.r1;
  document.querySelectorAll('.cr-cat-val')[0].textContent=p.rQual.toFixed(1);
  document.querySelectorAll('.cr-cat-val')[1].textContent=p.rPont.toFixed(1);
  document.querySelectorAll('.cr-cat-val')[2].textContent=p.rLimp.toFixed(1);

  // Portfolio BA
  document.getElementById('ba-p-a').src=p.baA;
  document.getElementById('ba-p-b').src=p.baB;
  baStates['ba-p']=false;
  document.getElementById('ba-p-a').style.opacity='1';
  document.getElementById('ba-p-b').style.opacity='0';

  // Portfolio grid
  const grid=document.querySelector('#tab-works .works-grid');
  grid.innerHTML=p.imgs.map(u=>`<div class="works-grid-item" onclick="toast('Ver trabalho')"><img src="${u}" alt=""></div>`).join('');

  // Specs
  document.querySelector('#tab-certs .spec-tags').innerHTML=p.specs.map(s=>`<span style="background:var(--ink);color:#fff;padding:7px 14px;border-radius:20px;font-size:12.5px;font-weight:600;">${s}</span>`).join('');

  // Certs
  document.querySelector('#tab-certs .cert-list').innerHTML=p.certs.map(c=>`
    <div class="cert-card" style="border-left:3px solid ${c.bc};">
      <div class="cert-ic" style="background:${c.bg};font-size:22px;">${c.ic}</div>
      <div class="cert-txt" style="flex:1"><div class="cert-n">${c.n}</div><div class="cert-o">${c.o}</div></div>
      <span style="background:#e8f5e9;color:#2e7d32;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;">✓ Verificado</span>
    </div>`).join('');

  // Reviews
  const revList=document.querySelector('#tab-reviews .reviews-list');
  revList.innerHTML=p.reviews.map(r=>{
    const filledStars='★'.repeat(r.stars)+'<span style="color:var(--border);">'+'★'.repeat(5-r.stars)+'</span>';
    return `<div class="rev-card">
      <div class="rev-head">
        <div class="rev-av"><img src="${r.img}" alt=""></div>
        <div style="flex:1"><div class="rev-name">${r.name}</div>
        <div style="display:flex;gap:10px;align-items:center;"><div style="color:var(--p1);font-size:14px;">${filledStars}</div><div class="rev-date" style="margin:0">${r.date}</div></div></div>
      </div>
      <div class="rev-text">${r.text}</div>
      ${r.photos?`<div style="display:flex;gap:6px;margin-top:8px;"><img src="${p.imgs[0]}" style="width:60px;height:60px;border-radius:8px;object-fit:cover;cursor:pointer" onclick="toast('Ver foto')"><img src="${p.imgs[1]}" style="width:60px;height:60px;border-radius:8px;object-fit:cover;cursor:pointer" onclick="toast('Ver foto')"></div>`:''}
      <div style="display:flex;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <div style="text-align:center;flex:1"><div style="font-size:12px;color:var(--p1);">${'★'.repeat(r.rQual)}</div><div style="font-size:10px;color:var(--muted);">Qualidade</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:12px;color:var(--p1);">${'★'.repeat(r.rPont)}</div><div style="font-size:10px;color:var(--muted);">Pontual</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:12px;color:var(--p1);">${'★'.repeat(r.rLimp)}</div><div style="font-size:10px;color:var(--muted);">Limpeza</div></div>
      </div>
    </div>`;
  }).join('')+`<div style="text-align:center;padding:14px 0;"><button onclick="toast('Carregando mais...')" style="background:none;border:1.5px solid var(--border);border-radius:20px;padding:9px 22px;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer;font-family:'DM Sans',sans-serif;">Ver todas as ${p.total} avaliações</button></div>`;

  // Cursos
  const cursosTab=document.querySelector('#tab-cursos');
  if(p.cursos.length===0){
    cursosTab.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:36px;margin-bottom:10px;">📚</div><div style="font-size:14px;">Este pintor ainda não criou cursos.</div></div>';
  } else {
    cursosTab.innerHTML='<div style="font-size:13px;color:var(--muted);margin-bottom:14px;">Cursos criados por '+p.name+'</div>'+
    p.cursos.map(c=>`
      <div onclick="toast('Abrindo curso...')" style="background:var(--white);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:12px;cursor:pointer;${c.free?'border:1.5px solid var(--p6)':''}">
        <div style="position:relative;">
          <img src="${c.img}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;${c.free?'filter:brightness(.85)':''}">
          ${c.tag?`<div style="position:absolute;top:10px;left:10px;background:${c.free?'var(--p6)':'var(--p1)'};color:${c.free?'var(--ink)':'#fff'};font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;">${c.tag}</div>`:''}
          <div style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;padding:3px 9px;border-radius:20px;">${c.dur}</div>
        </div>
        <div style="padding:14px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${c.title}</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${c.sub}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><span style="color:var(--p1);font-size:13px;">★★★★★</span><span style="font-size:12px;color:var(--muted);">${c.stars} (${c.alunos} alunos)</span></div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div>${c.free?'':'<span style="font-size:18px;font-weight:800;color:var(--ink);">'+c.preco+'</span>'}${c.old?`<span style="font-size:12px;color:var(--muted);text-decoration:line-through;margin-left:6px;">${c.old}</span>`:''}</div>
            <button onclick="event.stopPropagation();toast('${c.free?'Inscrito!':'Adicionado ao carrinho!'}')" style="background:${c.free?'var(--p6)':'var(--p1)'};color:${c.free?'var(--ink)':'#fff'};border:none;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">${c.free?'Inscrever Grátis':'Matricular'}</button>
          </div>
        </div>
      </div>`).join('');
  }

  // Reset to first tab
  switchTab('works');
  showScreen('profile');
}

// ══ EXPLORE MAP ══
function showPainterCard(id){
  const p=painters[id];
  document.getElementById('pp-img').src=p.img;
  document.getElementById('pp-name').textContent=p.name;
  document.getElementById('pp-sub').textContent=p.sub||p.city+' · '+p.specs?.[0];
  document.getElementById('pp-stars').textContent='★'.repeat(Math.floor(p.rating))+' '+p.rating.toFixed(1)+' · '+p.total+' avaliações';
  document.getElementById('painter-popup').classList.add('show');
  document.getElementById('painter-popup').querySelector('.pp-btn').onclick=()=>openProfile(id);
}
function mapChip(el){
  el.closest('.map-filters-row').querySelectorAll('.map-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
}

// ══ PROFILE TABS ══
function switchTab(n){
  ['works','vids','certs','reviews','cursos'].forEach(t=>{
    document.getElementById('ptab-'+t)?.classList.toggle('active',t===n);
    const el=document.getElementById('tab-'+t);
    if(el) el.style.display=t===n?'block':'none';
  });
}
function filterRev(el, rating){
  document.querySelectorAll('.rev-chip').forEach(c=>{c.style.background='var(--border)';c.style.color='var(--ink)';});
  el.style.background='var(--ink)'; el.style.color='#fff';
  const cards = document.querySelectorAll('#tab-reviews .rev-card, #tab-reviews [class*="rev"]');
  cards.forEach(c => {
    if(!rating || rating === 'all') c.style.display = '';
    else {
      const stars = (c.textContent.match(/⭐/g)||[]).length;
      c.style.display = stars === parseInt(rating) ? '' : 'none';
    }
  });
}

// ══ CALCULATOR ══
let demaos=2;
function setD(n){
  demaos=n;
  [1,2,3].forEach(i=>{
    const b=document.getElementById('db'+i);
    if(b){b.classList.toggle('active',i===n);}
  });
  calcTinta();
}
function calcTinta(){
  const area=parseFloat(document.getElementById('ci-area')?.value)||0;
  const fator=parseFloat(document.getElementById('ci-tipo')?.value)||1;
  const res=document.getElementById('calc-res');
  if(area<=0){res.style.display='none';return;}
  const litros=Math.ceil((area*fator*demaos)/11*1.1);
  const l36=Math.ceil(litros/3.6), l18=Math.ceil(litros/18);
  document.getElementById('cr-val').textContent=litros+'L';
  document.getElementById('cr-latas').textContent=`≈ ${l36} latas 3,6L  ou  ${l18} galão 18L`;
  res.style.display='block';
}

// ══ AI FEATURES (PRO) ══
let _isPro = false;
let _proExpires = null;

async function refreshProStatus(){
  try {
    const sb = getSupabase();
    if(!sb || !currentUser) { _isPro = false; _proExpires = null; applyProUI(); return false; }
    const { data } = await sb.from('profiles').select('is_pro, pro_expires_at').eq('id', currentUser.id).single();
    const notExpired = !data?.pro_expires_at || new Date(data.pro_expires_at) > new Date();
    _isPro = !!(data && data.is_pro && notExpired);
    _proExpires = data?.pro_expires_at || null;
    applyProUI();
    return _isPro;
  } catch(e){ console.warn('refreshProStatus:', e); applyProUI(); return _isPro; }
}

// Quando o perfil ja e PRO, troca o banner de upsell por "PRO ativo"
function applyProUI(){
  try {
    const banner = document.querySelector('#view-pintor .pro-banner');
    if(!banner) return;
    if(_isPro){
      banner.onclick = null;
      banner.style.cursor = 'default';
      let until = '';
      if(_proExpires){ try { until = ' · até ' + new Date(_proExpires).toLocaleDateString('pt-BR'); } catch(_){ } }
      banner.innerHTML =
        '<div class="pro-banner-icon">✅</div>' +
        '<div class="pro-banner-text"><div class="pro-banner-title">Plano PRO ativo</div>' +
        '<div class="pro-banner-sub">Recursos PRO liberados' + until + '</div></div>' +
        '<div class="pro-banner-arrow">★</div>';
    } else {
      banner.onclick = function(){ showModal('pro-modal'); };
      banner.style.cursor = 'pointer';
      banner.innerHTML =
        '<div class="pro-banner-icon">⚡</div>' +
        '<div class="pro-banner-text"><div class="pro-banner-title">Ative o Plano PRO</div>' +
        '<div class="pro-banner-sub">Destaque-se e receba mais clientes · R$39/mês</div></div>' +
        '<div class="pro-banner-arrow">›</div>';
    }
  } catch(e){ console.warn('applyProUI:', e); }
}

function checkProAccess(){
  return _isPro;
}

function handleProReturn(){
  try {
    const params = new URLSearchParams(window.location.search);
    if(params.get('pro') !== 'success') return;
    toast('Pagamento recebido! Ativando seu PRO...');
    // O webhook pode levar alguns segundos; tenta atualizar algumas vezes.
    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      const pro = await refreshProStatus();
      if(pro){ clearInterval(iv); toast('Plano PRO ativado! 🎉'); }
      else if(tries >= 6){ clearInterval(iv); toast('Pagamento em processamento. O PRO será liberado em instantes.'); }
    }, 4000);
    // Limpa o parâmetro da URL
    const clean = window.location.pathname;
    window.history.replaceState({}, '', clean);
  } catch(e){ console.warn('handleProReturn:', e); }
}

async function startProCheckout(){
  const btn = document.getElementById('pro-cta-btn');
  try {
    const sb = getSupabase();
    if(!sb){ toast('Erro: Supabase indisponível'); return; }
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ toast('Faça login para assinar'); return; }
    if(btn){ btn.textContent = 'Abrindo pagamento...'; btn.disabled = true; }
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: session.user.id,
        email: session.user.email,
        name: session.user.user_metadata?.name || ''
      })
    });
    const data = await r.json();
    if(!r.ok || !data.init_point){
      toast('Erro ao iniciar pagamento: ' + (data.error || 'tente novamente'));
      if(btn){ btn.textContent = 'Assinar Agora'; btn.disabled = false; }
      return;
    }
    window.location.href = data.init_point;
  } catch(e){
    console.error('startProCheckout:', e);
    toast('Erro ao iniciar pagamento');
    if(btn){ btn.textContent = 'Assinar Agora'; btn.disabled = false; }
  }
}

// ══ MODERAÇÃO ADMIN ══
let _isAdmin = false;

async function getAccessToken(){
  try {
    const sb = getSupabase();
    const { data:{ session } } = await sb.auth.getSession();
    return session?.access_token || '';
  } catch(e){ return ''; }
}

async function checkAdminEntry(){
  try {
    const token = await getAccessToken();
    if(!token) return;
    const r = await fetch('/api/admin-moderate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: token, action: 'check' })
    });
    if(!r.ok) return;
    const data = await r.json();
    _isAdmin = !!data.admin;
    const link = document.getElementById('mod-queue-link');
    if(link) link.style.display = _isAdmin ? '' : 'none';
  } catch(e){ console.warn('checkAdminEntry:', e); }
}

async function openModQueue(){
  showModal('mod-queue-modal');
  const list = document.getElementById('mod-queue-list');
  if(list) list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Carregando...</div>';
  try {
    const sb = getSupabase();
    const { data: posts, error } = await sb.from('posts').select(POST_COLS)
      .eq('status','pending').order('created_at',{ascending:true}).limit(50);
    if(error){ list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Erro ao carregar.</div>'; return; }
    if(!posts || posts.length === 0){
      list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Nada pendente. 🎉</div>';
      const cnt = document.getElementById('mod-queue-count'); if(cnt) cnt.textContent = 'Fila vazia';
      return;
    }
    const cnt = document.getElementById('mod-queue-count'); if(cnt) cnt.textContent = posts.length + ' pendente(s)';
    list.innerHTML = posts.map(p => {
      const cap = (p.caption || '').replace(/</g,'&lt;');
      const media = p.media_url
        ? (p.media_type === 'video'
            ? `<video src="${p.media_url}" controls style="width:100%;border-radius:12px;max-height:260px;background:#000;"></video>`
            : `<img src="${p.media_url}" style="width:100%;border-radius:12px;max-height:260px;object-fit:cover;">`)
        : '';
      return `<div style="background:var(--white);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:12px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">${p.media_type||'post'} · ${new Date(p.created_at).toLocaleString('pt-BR')}</div>
        ${media}
        ${cap ? `<div style="font-size:13px;color:var(--ink);margin:8px 0;">${cap}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button onclick="modAction('${p.id}','approve',this)" style="flex:1;padding:10px;border:none;border-radius:10px;background:#2ec4b6;color:#fff;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">Aprovar</button>
          <button onclick="modAction('${p.id}','reject',this)" style="flex:1;padding:10px;border:none;border-radius:10px;background:#e63946;color:#fff;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">Rejeitar</button>
        </div>
      </div>`;
    }).join('');
  } catch(e){
    console.error('openModQueue:', e);
    if(list) list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Erro ao carregar.</div>';
  }
}

async function modAction(postId, action, btn){
  try {
    const card = btn?.closest('div[style*="background:var(--white)"]');
    if(btn){ btn.disabled = true; btn.textContent = '...'; }
    const token = await getAccessToken();
    const r = await fetch('/api/admin-moderate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: token, action, postId })
    });
    const data = await r.json();
    if(!r.ok || !data.ok){ toast('Erro: ' + (data.error || 'falha')); if(btn){ btn.disabled=false; btn.textContent = action==='approve'?'Aprovar':'Rejeitar'; } return; }
    toast(action === 'approve' ? 'Post aprovado' : 'Post rejeitado');
    if(card) card.remove();
    if(typeof loadFeed === 'function') loadFeed();
  } catch(e){
    console.error('modAction:', e);
    toast('Erro ao processar');
    if(btn){ btn.disabled=false; btn.textContent = action==='approve'?'Aprovar':'Rejeitar'; }
  }
}

function openAiOrcamento(){
  // Fazer orçamento é livre; só a geração por IA exige PRO.
  showModal('ai-orc-modal');
}

function openAiChat(){
  if(!checkProAccess()){ showModal('pro-modal'); return; }
  showModal('ai-chat-modal');
}

// AI Chat - knowledge base for painting professionals
const _aiKnowledge = {
  'tinta':    'Para paredes internas, recomendo tinta acrílica acetinada (melhor custo-benefício). Para áreas úmidas, use tinta acrílica semi-brilho. Para fachadas, tinta elastomérica. Rendimento médio: 10-12m²/L por demão.',
  'textura':  'Texturas mais pedidas: Grafiato (rolo texturizado), Marmorato (efeito mármore com espátula), Cimento Queimado (2-3 demãos de massa + verniz). Preço médio: R$35-60/m² dependendo da técnica.',
  'preco':    'Valores médios de mão de obra: Pintura simples R$18-25/m², Textura R$35-60/m², Epóxi R$50-80/m², Fachada R$25-40/m². Sempre inclua material + mão de obra + deslocamento no orçamento.',
  'epoxi':    'Piso epóxi: lixar o piso, aplicar primer epóxi, 2-3 demãos de epóxi (intervalo de 12h). Rendimento: 4-6m²/L. Cura total: 7 dias. Preço médio: R$50-80/m² com material.',
  'rendimento':'Tinta acrílica: 10-12m²/L. Massa corrida: 4-6m²/L. Selador: 8-10m²/L. Textura: 2-4m²/L. Sempre compre 10% a mais como margem de segurança.',
  'preparo':  'Preparação é 70% do resultado! 1) Limpe a parede. 2) Lixe com lixa 150. 3) Aplique massa corrida nas imperfeições. 4) Lixe novamente com 220. 5) Aplique selador. 6) Pinte com rolo de lã.',
  'cor':      'Tendências: tons terrosos (terracota, argila), verde-salvia, azul petróleo. Para ambientes pequenos: cores claras ampliam. Para destaque: parede accent em tom mais escuro. Sempre teste uma amostra antes!',
  'ferramenta':'Kit básico: rolo de lã 23cm, trincha 2" e 3", bandeja, fita crepe, lona plástica, espátula, lixa 150 e 220, escada. Para textura: desempenadeira de aço e espátula de plástico.',
  'infiltracao':'Antes de pintar parede com infiltração: 1) Resolva a causa da infiltração. 2) Raspe a área afetada. 3) Aplique impermeabilizante. 4) Massa corrida após secar. 5) Selador. 6) Pintura. Sem resolver a causa, volta sempre.',
  'calculo':  'Cálculo rápido: meça comprimento × altura de cada parede. Subtraia portas (1.6m²) e janelas (2.4m²). Multiplique pelo número de demãos. Divida pelo rendimento da tinta (10m²/L). Adicione 10% de margem.'
};

let _aiChatHistory = [];

async function sendAiChat(){
  const input = document.getElementById('ai-chat-input');
  const text = input.value.trim();
  if(!text) return;
  input.value = '';
  const msgsEl = document.getElementById('ai-chat-msgs');

  msgsEl.innerHTML += '<div style="display:flex;gap:8px;margin-bottom:12px;justify-content:flex-end;"><div style="background:var(--ink);color:#fff;border-radius:14px;padding:10px 14px;font-size:13px;max-width:85%;">'+escapeHtml(text)+'</div></div>';
  msgsEl.scrollTop = msgsEl.scrollHeight;

  const typingId = 'typing-' + Date.now();
  msgsEl.innerHTML += '<div id="'+typingId+'" style="display:flex;gap:8px;margin-bottom:12px;"><div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#2ec4b6,#8338ec);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">💡</div><div style="background:var(--cream);border-radius:14px;padding:10px 14px;font-size:13px;color:var(--muted);max-width:85%;"><span style="display:inline-block;animation:typing 1.2s infinite;">•</span><span style="display:inline-block;animation:typing 1.2s infinite .15s;">•</span><span style="display:inline-block;animation:typing 1.2s infinite .3s;">•</span></div></div>';
  msgsEl.scrollTop = msgsEl.scrollHeight;

  let reply = null;
  let aiError = null;
  try {
    const r = await fetch('/api/chat-ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, history: _aiChatHistory })
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.reply) reply = data.reply;
    else aiError = data.error || ('HTTP ' + r.status);
  } catch(e) {
    aiError = String(e?.message || e);
  }

  if (!reply) {
    console.warn('chat-ai fallback:', aiError);
    const query = text.toLowerCase();
    for(const [key, answer] of Object.entries(_aiKnowledge)){
      if(query.includes(key)){ reply = answer; break; }
    }
    if(!reply){
      if(query.match(/quanto|valor|cobr|preci/)) reply = _aiKnowledge['preco'];
      else if(query.match(/quant|litro|galao|lata/)) reply = _aiKnowledge['rendimento'];
      else if(query.match(/prepar|lixa|massa|antes/)) reply = _aiKnowledge['preparo'];
      else if(query.match(/umid|mofo|infiltr|vazam/)) reply = _aiKnowledge['infiltracao'];
      else if(query.match(/qual tinta|melhor tinta|tipo.*tinta/)) reply = _aiKnowledge['tinta'];
      else if(query.match(/calcul|medir|medid|area/)) reply = _aiKnowledge['calculo'];
      else if(query.match(/tend|cor|tom|paleta/)) reply = _aiKnowledge['cor'];
      else if(query.match(/ferrament|rolo|pincel|trincha/)) reply = _aiKnowledge['ferramenta'];
      else reply = 'Conexão com a IA falhou no momento. Tente novamente em alguns segundos.';
    }
    if (!/^Sou um assistente virtual/i.test(reply)) {
      reply = 'Sou um assistente virtual, qualquer confirmação de informações ditas aqui eu recomendo checar com o representante da marca ou lojista que você escolher.\n\n' + reply;
    }
  } else {
    _aiChatHistory.push({ role: 'user', content: text });
    _aiChatHistory.push({ role: 'assistant', content: reply });
    if (_aiChatHistory.length > 20) _aiChatHistory = _aiChatHistory.slice(-20);
  }

  const typingEl = document.getElementById(typingId);
  if (typingEl) typingEl.remove();
  const formatted = escapeHtml(reply).replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  msgsEl.innerHTML += '<div style="display:flex;gap:8px;margin-bottom:12px;"><div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#2ec4b6,#8338ec);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">💡</div><div style="background:var(--cream);border-radius:14px;padding:10px 14px;font-size:13px;color:var(--ink);max-width:85%;line-height:1.45;">'+formatted+'</div></div>';
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function sugerirEscopoIA(btn){
  if(!checkProAccess()){ showModal('pro-modal'); return; }
  const servico = document.getElementById('ai-orc-servico').value;
  const area = document.getElementById('ai-orc-area').value || '?';
  const comodos = document.getElementById('ai-orc-comodos').value || '?';
  const numDemaos = document.getElementById('ai-orc-demaos').value || '2';
  const condEl = document.getElementById('ai-orc-condicao');
  const condTxt = condEl && condEl.options[condEl.selectedIndex] ? condEl.options[condEl.selectedIndex].text : '';
  const obsEl = document.getElementById('ai-orc-obs');
  const orig = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.innerHTML = '✨ Gerando...'; }
  const prompt = 'Você é um pintor profissional. Escreva, em português, um escopo de serviço objetivo (4 a 6 linhas, sem títulos) para um orçamento de "'+servico+'", área aproximada de '+area+' m², '+comodos+' cômodo(s), '+numDemaos+' demão(s), condição da superfície: "'+condTxt+'". Liste preparação, aplicação, prazo estimado e garantia. Texto pronto para colar no orçamento.'+(obsEl && obsEl.value.trim() ? ' Considere também: '+obsEl.value.trim() : '');
  try {
    const r = await fetch('/api/chat-ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: prompt, history: [] })
    });
    const data = await r.json().catch(() => ({}));
    if(r.ok && data.reply){
      if(obsEl) obsEl.value = String(data.reply).trim();
      toast('Escopo sugerido pela IA ✨');
    } else {
      toast('Não foi possível gerar agora. Tente de novo.');
    }
  } catch(e){
    toast('Falha na IA: ' + (e?.message || 'tente de novo'));
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = orig; }
  }
}

function gerarOrcamentoIA(){
  const cliente = document.getElementById('ai-orc-cliente').value.trim() || 'Cliente';
  const servico = document.getElementById('ai-orc-servico').value;
  const area = parseFloat(document.getElementById('ai-orc-area').value) || 0;
  const comodos = parseInt(document.getElementById('ai-orc-comodos').value) || 0;
  const numDemaos = parseInt(document.getElementById('ai-orc-demaos').value) || 2;
  const fator = parseFloat(document.getElementById('ai-orc-condicao').value) || 1;
  const precoM2 = parseFloat(document.getElementById('ai-orc-preco').value) || 0;
  const obs = document.getElementById('ai-orc-obs').value.trim();

  if(area <= 0){ toast('Informe a área em m²'); return; }
  if(precoM2 <= 0){ toast('Informe o valor por m²'); return; }

  // Cálculos
  const litros = Math.ceil((area * fator * numDemaos) / 11 * 1.1);
  const l18 = Math.ceil(litros / 18);
  const l36 = Math.ceil(litros / 3.6);
  const custoTinta = l18 * 320; // estimativa R$320/galão 18L premium
  const custoMaoObra = area * precoM2;
  const total = custoTinta + custoMaoObra;

  const pintorName = document.getElementById('myprofile-name')?.textContent || 'Pintor';
  const hoje = new Date().toLocaleDateString('pt-BR');

  // Condição por extenso
  const condicaoMap = {'1':'Parede nova / massa corrida','1.2':'Parede antiga (demão extra)','1.5':'Concreto / tijolo aparente','0.8':'Teto liso'};
  const condicaoText = condicaoMap[String(fator)] || 'Parede nova';

  // Gerar itens detalhados
  let itensHtml = '';
  // Preparação
  const prepItems = [];
  if(fator >= 1.2) prepItems.push('Raspagem e lixamento de parede antiga');
  if(fator >= 1.5) prepItems.push('Aplicação de selador para concreto/tijolo');
  prepItems.push('Proteção de pisos e mobília com lona');
  prepItems.push('Fita crepe em rodapés, batentes e interruptores');
  if(fator >= 1.2) prepItems.push('Massa corrida para correção de imperfeições');
  prepItems.forEach(item => {
    itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>'+item+'</span><span style="color:var(--muted);">Incluso</span></div>';
  });

  // Materiais
  itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Tinta premium ('+litros+'L ≈ '+l18+' galões 18L)</span><span style="font-weight:600;">R$ '+custoTinta.toLocaleString('pt-BR')+'</span></div>';
  itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Lixa, massa, selador, fita crepe</span><span style="color:var(--muted);">Incluso</span></div>';

  // Mão de obra
  const diasEstimados = Math.ceil(area / 40); // ~40m²/dia
  itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Mão de obra ('+area+'m² × R$'+precoM2+'/m²)</span><span style="font-weight:600;">R$ '+custoMaoObra.toLocaleString('pt-BR')+'</span></div>';

  // Observações da IA
  let aiNotes = '';
  if(obs) aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• '+escapeHtml(obs)+'</div>';
  aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• Prazo estimado: '+diasEstimados+' dia'+(diasEstimados>1?'s':'') + ' úteis</div>';
  aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• '+numDemaos+' demão'+(numDemaos>1?'s':'')+' de tinta para acabamento perfeito</div>';
  aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• Condição: '+condicaoText+'</div>';
  aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• Garantia de 1 ano na mão de obra</div>';
  if(comodos > 0) aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• '+comodos+' cômodo'+(comodos>1?'s':'')+' inclusos no serviço</div>';

  const resultHtml = `
    <div style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.08);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-family:Syne,sans-serif;font-size:18px;font-weight:800;color:var(--ink);">ORÇAMENTO</div>
          <div style="font-size:11px;color:var(--muted);">${hoje}</div>
        </div>
        <div style="background:var(--cream);color:var(--muted);font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;">ORÇAMENTO</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:14px;padding-bottom:14px;border-bottom:2px solid var(--border);">
        <div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Profissional</div><div style="font-size:13px;font-weight:700;">${escapeHtml(pintorName)}</div></div>
        <div style="text-align:right;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Cliente</div><div style="font-size:13px;font-weight:700;">${escapeHtml(cliente)}</div></div>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Serviço: ${escapeHtml(servico)}</div>
      <div style="margin-bottom:14px;">${itensHtml}</div>
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Observações</div>
      <div style="margin-bottom:14px;">${aiNotes}</div>
      <div style="background:var(--cream);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:14px;font-weight:700;color:var(--ink);">TOTAL</div>
        <div style="font-size:22px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">R$ ${total.toLocaleString('pt-BR')}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button onclick="gerarPDFOrcamento()" style="flex:1;padding:12px;background:var(--p1);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">📄 Baixar PDF</button>
      <button onclick="compartilharOrcamento()" style="flex:1;padding:12px;background:var(--ink);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">📤 Enviar</button>
    </div>
    <div id="ai-orc-materiais" style="margin-top:14px;"></div>
  `;

  // Save data for PDF
  const pItens = [];
  prepItems.forEach(item=>pItens.push({desc:item,valor:'Incluso'}));
  pItens.push({desc:'Tinta premium ('+litros+'L ≈ '+l18+' galões 18L)',valor:'R$ '+custoTinta.toLocaleString('pt-BR')});
  pItens.push({desc:'Mão de obra ('+area+'m² × R$'+precoM2+'/m²)',valor:'R$ '+custoMaoObra.toLocaleString('pt-BR')});
  _lastOrcData = {pintor:pintorName,cliente,servico,area,demaos:numDemaos,condicao:condicaoText,hoje,total,itens:pItens,obs:[obs,numDemaos+' demãos','Prazo: '+diasEstimados+' dias úteis','Garantia 1 ano'].filter(Boolean)};

  const resultEl = document.getElementById('ai-orc-result');
  resultEl.innerHTML = resultHtml;
  resultEl.style.display = 'block';
  resultEl.scrollIntoView({ behavior: 'smooth' });
  loadMaterialSuggestions(litros);
}

function compartilharOrcamento(){
  const resultEl = document.getElementById('ai-orc-result');
  const text = resultEl?.innerText || '';
  if(navigator.share){
    navigator.share({ title:'Orçamento - QueroUmaCor', text: text }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(text).then(()=>toast('Orçamento copiado!')).catch(()=>toast('Erro ao copiar'));
  }
}

// ══ PDF GENERATION ══
let _lastOrcData = {};
function gerarPDFOrcamento(){
  if(typeof jspdf==='undefined' && typeof window.jspdf==='undefined'){ toast('Carregando PDF...'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const d = _lastOrcData;
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
  y+=10;
  // Total
  doc.setFillColor(245,240,235); doc.rect(10,y-4,190,18,'F');
  doc.setFont(undefined,'bold'); doc.setFontSize(14);
  doc.setTextColor(255,107,53);
  doc.text('TOTAL: R$ '+(d.total||0).toLocaleString('pt-BR'),105,y+7,{align:'center'});
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
      <button onclick="addToCart('${p.id}','${escapeHtml(p.name)}',${p.price||0})" style="margin-top:4px;padding:4px 8px;background:var(--ink);color:#fff;border:none;border-radius:6px;font-size:9px;font-weight:700;cursor:pointer;">+ Carrinho</button></div>
    </div>`).join('');
}

function copiarOrcamento(){
  const resultEl = document.getElementById('ai-orc-result');
  const text = resultEl?.innerText || '';
  navigator.clipboard.writeText(text).then(()=>toast('Orçamento copiado!')).catch(()=>toast('Erro ao copiar'));
}

// ══ AGENDA DE PROJETOS (calendário) ══
let _agCur = null;   // Date: primeiro dia do mês exibido
let _agSel = null;   // 'yyyy-mm-dd' selecionado
let _agJobs = [];     // cache dos projetos do usuário

function _agYmd(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }

async function loadAgenda(){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  const { data } = await sb.from('jobs').select('*').eq('painter_id', currentUser.id).order('scheduled_date',{ascending:true}).limit(500);
  _agJobs = data || [];
  const now = new Date();
  if(!_agCur) _agCur = new Date(now.getFullYear(), now.getMonth(), 1);
  if(!_agSel) _agSel = _agYmd(now);
  renderAgendaCal();
}

function agMonth(delta){
  if(!_agCur) _agCur = new Date();
  _agCur = new Date(_agCur.getFullYear(), _agCur.getMonth()+delta, 1);
  renderAgendaCal();
}

function agSelect(day){ _agSel = day; renderAgendaCal(); }

function renderAgendaCal(){
  const cal = document.getElementById('agenda-cal'); if(!cal) return;
  const y = _agCur.getFullYear(), m = _agCur.getMonth();
  const startDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const counts = {};
  _agJobs.forEach(j=>{ if(j.scheduled_date){ const k=String(j.scheduled_date).slice(0,10); counts[k]=(counts[k]||0)+1; } });
  const todayK = _agYmd(new Date());
  const dow = ['D','S','T','Q','Q','S','S'];
  let head = dow.map(d=>`<div style="text-align:center;font-size:10px;color:var(--muted);font-weight:700;padding:4px 0;">${d}</div>`).join('');
  let cells = '';
  for(let i=0;i<startDow;i++) cells += '<div></div>';
  for(let d=1; d<=daysInMonth; d++){
    const k = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const has = counts[k]||0;
    const sel = k===_agSel;
    const isToday = k===todayK;
    const style = sel ? 'background:var(--p1);color:#fff;' : isToday ? 'background:var(--cream);color:var(--ink);border:1.5px solid var(--p1);' : 'color:var(--ink);';
    cells += `<div onclick="agSelect('${k}')" style="aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;${style}">${d}${has?`<span style="width:5px;height:5px;border-radius:50%;margin-top:3px;background:${sel?'#fff':'var(--p1)'};display:block;"></span>`:''}</div>`;
  }
  cal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <button onclick="agMonth(-1)" style="background:var(--cream);border:1px solid var(--border);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;">‹</button>
      <div style="font-weight:800;font-family:'Syne',sans-serif;font-size:15px;">${months[m]} ${y}</div>
      <button onclick="agMonth(1)" style="background:var(--cream);border:1px solid var(--border);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${head}${cells}</div>`;
  renderAgendaDay();
}

function renderAgendaDay(){
  const el = document.getElementById('agenda-day-list'); if(!el) return;
  const items = _agJobs
    .filter(j=> j.scheduled_date && String(j.scheduled_date).slice(0,10)===_agSel)
    .sort((a,b)=> String(a.scheduled_time||'').localeCompare(String(b.scheduled_time||'')));
  const [yy,mm,dd] = _agSel.split('-');
  const label = `${dd}/${mm}/${yy}`;
  if(items.length===0){
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-weight:700;margin:6px 0;">${label}</div><div style="text-align:center;color:var(--muted);padding:16px;font-size:13px;">Nenhum projeto neste dia</div>`;
    return;
  }
  el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-weight:700;margin:6px 0;">${label} · ${items.length} projeto(s)</div>` + items.map(j=>{
    const st = j.status==='concluido'?'#2ec4b6':j.status==='cancelado'?'#e74c3c':'var(--p1)';
    return `<div style="background:var(--white);border-radius:12px;padding:14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.04);border-left:4px solid ${st};">
      <div style="display:flex;justify-content:space-between;"><b style="font-size:13px;">${escapeHtml(j.client_name||'')}</b><span style="font-size:11px;color:var(--muted);">${j.scheduled_time||''}</span></div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px;">${escapeHtml(j.service_type||'')} · ${escapeHtml(j.address||'')}</div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <span style="font-size:11px;color:var(--ink);font-weight:600;">R$ ${(j.revenue||0).toLocaleString('pt-BR')}</span>
        <span style="font-size:11px;color:var(--muted);">custo: R$ ${(j.material_cost||0).toLocaleString('pt-BR')}</span>
        <span style="margin-left:auto;font-size:10px;font-weight:700;color:${st};text-transform:uppercase;">${j.status}</span>
      </div>
      ${j.status==='agendado'?`<div style="display:flex;gap:6px;margin-top:8px;"><button onclick="updateJobStatus('${j.id}','concluido')" style="flex:1;padding:6px;background:#2ec4b6;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">✓ Concluir</button><button onclick="updateJobStatus('${j.id}','cancelado')" style="flex:1;padding:6px;background:var(--cream);color:var(--muted);border:1px solid var(--border);border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">Cancelar</button></div>`:''}
    </div>`;
  }).join('');
}

async function salvarJob(){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  const job = {
    painter_id: currentUser.id,
    client_name: document.getElementById('job-cliente').value.trim(),
    service_type: document.getElementById('job-servico').value,
    scheduled_date: document.getElementById('job-data').value||null,
    scheduled_time: document.getElementById('job-hora').value||null,
    address: document.getElementById('job-endereco').value.trim(),
    revenue: parseFloat(document.getElementById('job-receita').value)||0,
    material_cost: parseFloat(document.getElementById('job-custo').value)||0,
    notes: document.getElementById('job-notas').value.trim()
  };
  if(!job.client_name){ toast('Informe o cliente'); return; }
  const { error } = await sb.from('jobs').insert(job);
  if(error){ toast('Erro: '+error.message); return; }
  if(job.scheduled_date) _agSel = String(job.scheduled_date).slice(0,10);
  toast('Projeto salvo!'); closeModals(); loadAgenda();
}

async function updateJobStatus(jobId, status){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  await sb.from('jobs').update({status}).eq('id',jobId).eq('painter_id',currentUser.id);
  toast(status==='concluido'?'Projeto concluído!':'Projeto cancelado'); loadAgenda(); loadFinanceiro();
}

function prefillNovoProjeto(){
  const di = document.getElementById('job-data');
  if(di && !di.value && _agSel) di.value = _agSel;
}

// ══ CHECKLIST DE OBRA ══
let _checklistItems = JSON.parse(localStorage.getItem('checklistItems')||'[]');
const _checklistTemplates = {
  pintura: ['Proteger pisos com lona','Fita crepe em rodapés e batentes','Lixar paredes (lixa 150)','Aplicar massa corrida','Lixar massa (lixa 220)','Aplicar selador','1ª demão de tinta','2ª demão de tinta','Retoques finais','Limpeza do local'],
  textura: ['Proteger pisos e móveis','Preparar massa texturizada','Aplicar base/selador','Aplicar textura com desempenadeira','Aguardar secagem (4h)','Pintar sobre textura','Retoques','Limpeza'],
  epoxi: ['Lixar piso','Limpar com desengraxante','Aplicar primer epóxi','Aguardar 12h secagem','1ª demão epóxi','2ª demão epóxi','Aguardar 7 dias cura total','Entrega']
};

function renderChecklist(){
  const el = document.getElementById('checklist-items');
  if(_checklistItems.length===0){ el.innerHTML='<div style="text-align:center;color:var(--muted);padding:12px;font-size:13px;">Adicione itens ou use um template</div>'; return; }
  el.innerHTML = _checklistItems.map((item,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
    <input type="checkbox" ${item.done?'checked':''} onchange="_checklistItems[${i}].done=this.checked;saveChecklist()" style="width:18px;height:18px;accent-color:var(--p1);">
    <span style="flex:1;font-size:13px;${item.done?'text-decoration:line-through;color:var(--muted);':''}">${escapeHtml(item.text)}</span>
    <span onclick="_checklistItems.splice(${i},1);saveChecklist();renderChecklist()" style="cursor:pointer;color:var(--muted);font-size:16px;">&times;</span>
  </div>`).join('');
}

function addChecklistItem(){
  const input = document.getElementById('checklist-new');
  const text = input.value.trim(); if(!text) return;
  _checklistItems.push({text, done:false}); input.value='';
  saveChecklist(); renderChecklist();
}

function loadChecklistTemplate(type){
  _checklistItems = (_checklistTemplates[type]||[]).map(t=>({text:t,done:false}));
  saveChecklist(); renderChecklist();
}

function saveChecklist(){ localStorage.setItem('checklistItems', JSON.stringify(_checklistItems)); }

// ══ FINANCEIRO / LUCRO ══
async function loadFinanceiro(){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  const { data: jobs } = await sb.from('jobs').select('*').eq('painter_id', currentUser.id).eq('status','concluido');
  let receita=0, custos=0;
  (jobs||[]).forEach(j=>{ receita+=(j.revenue||0); custos+=(j.material_cost||0); });
  const { data: comms } = await sb.from('commissions').select('amount').eq('painter_id', currentUser.id);
  let comissoes=0; (comms||[]).forEach(c=>{ comissoes+=(c.amount||0); });
  document.getElementById('fin-receita').textContent='R$ '+receita.toLocaleString('pt-BR');
  document.getElementById('fin-custos').textContent='R$ '+custos.toLocaleString('pt-BR');
  document.getElementById('fin-comissoes').textContent='R$ '+comissoes.toLocaleString('pt-BR');
  document.getElementById('fin-lucro').textContent='R$ '+(receita-custos-comissoes).toLocaleString('pt-BR');
  const listEl = document.getElementById('fin-jobs-list');
  if(jobs&&jobs.length>0){
    listEl.innerHTML = jobs.slice(0,5).map(j=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>${escapeHtml(j.client_name||'')} - ${escapeHtml(j.service_type||'')}</span><span style="font-weight:700;color:#2ec4b6;">R$ ${((j.revenue||0)-(j.material_cost||0)).toLocaleString('pt-BR')}</span></div>`).join('');
  }
}

// ══ AUTO-RESPOSTAS ══
async function salvarAutoRespostas(){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  const configs = [
    { trigger_type:'new_quote', message_template: document.getElementById('ar-quote-msg').value, is_active: document.getElementById('ar-quote-on').checked, delay_minutes:0 },
    { trigger_type:'follow_up', message_template: document.getElementById('ar-followup-msg').value, is_active: document.getElementById('ar-followup-on').checked, delay_minutes:4320 },
    { trigger_type:'new_message', message_template: document.getElementById('ar-msg-msg').value, is_active: document.getElementById('ar-msg-on').checked, delay_minutes:0 }
  ];
  for(const c of configs){
    await sb.from('auto_responses').upsert({ user_id: currentUser.id, ...c }, { onConflict:'user_id,trigger_type' });
  }
  toast('Respostas automáticas salvas!'); closeModals();
}

// ══ RANKING POR CIDADE ══
async function loadRanking(){
  const city = document.getElementById('ranking-city').value.trim().toLowerCase();
  if(!city || city.length < 2) return;
  const sb = getSupabase(); if(!sb) return;
  const { data: painters } = await sb.from('profiles').select('id, name, tag, avatar_url, city, state, rating_avg, role').in('role',['pintor','grafiteiro','automotivo']).ilike('city','%'+city+'%').order('rating_avg',{ascending:false,nullsFirst:false}).limit(20);
  const el = document.getElementById('ranking-list');
  if(!painters||painters.length===0){ el.innerHTML='<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Nenhum pintor encontrado nesta cidade</div>'; return; }
  el.innerHTML = painters.map((p,i)=>{
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'<span style="font-size:12px;font-weight:700;color:var(--muted);">#'+(i+1)+'</span>';
    const avatar = p.avatar_url||'https://ui-avatars.com/api/?name='+encodeURIComponent(p.name||'P')+'&background=e8e2d9&color=1a1a2e&size=96';
    const stars = p.rating_avg ? '⭐ '+(+p.rating_avg).toFixed(1) : 'Sem avaliação';
    return `<div onclick="openUserProfile('${p.id}')" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--white);border-radius:12px;margin-bottom:6px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.04);">
      <div style="width:28px;text-align:center;">${medal}</div>
      <img src="${avatar}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
      <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${escapeHtml(p.name||'')}</div><div style="font-size:11px;color:var(--muted);">${p.tag?'@'+p.tag:''} · ${escapeHtml((p.city||'')+', '+(p.state||''))}</div></div>
      <div style="font-size:12px;font-weight:600;color:var(--p1);">${stars}</div>
    </div>`;
  }).join('');
}

// ══ INDICAÇÃO ENTRE PINTORES ══
async function loadReferrals(){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  const { data: refs } = await sb.from('referrals').select('*').eq('referrer_id', currentUser.id).order('created_at',{ascending:false});
  const { data: pts } = await sb.from('points').select('amount,type').eq('user_id', currentUser.id);
  let total = 0; (pts||[]).forEach(p=>{ total += p.type==='earned'?(p.amount||0):-(p.amount||0); });
  document.getElementById('ref-pontos').textContent = total;
  const el = document.getElementById('ref-list');
  if(!refs||refs.length===0) return;
  el.innerHTML = refs.map(r=>`<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;display:flex;justify-content:space-between;"><span>${r.status}</span><span style="color:var(--p1);font-weight:700;">+${r.bonus_points} pts</span></div>`).join('');
}

// ══ PONTOS / CASHBACK ══
async function loadPoints(){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  const { data: pts } = await sb.from('points').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(20);
  let saldo = 0; (pts||[]).forEach(p=>{ saldo += p.type==='earned'?(p.amount||0):-(p.amount||0); });
  document.getElementById('pts-saldo').textContent = saldo+' pts';
  document.getElementById('pts-valor').textContent = (saldo/10).toFixed(0);
  const el = document.getElementById('pts-historico');
  if(!pts||pts.length===0) return;
  el.innerHTML = pts.map(p=>{
    const sign = p.type==='earned'?'+':'-';
    const color = p.type==='earned'?'#2ec4b6':'var(--p1)';
    return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>${escapeHtml(p.source||'')}</span><span style="color:${color};font-weight:700;">${sign}${p.amount} pts</span></div>`;
  }).join('');
}

// ══ EARN POINTS HELPER ══
async function earnPoints(userId, amount, source, refId){
  const sb = getSupabase(); if(!sb) return;
  try { await sb.from('points').insert({ user_id: userId, amount, type:'earned', source, reference_id: refId||null }); } catch(e){}
}

// ══ DISTRIBUIÇÃO DE LEADS ══
async function distribuirLead(quoteId, serviceType, city){
  const sb = getSupabase(); if(!sb) return;
  // Find painters in same city, matching specialty, ordered by PRO first then rating
  let query = sb.from('profiles').select('id, name, role, city, specialties, rating_avg, portal_access')
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

// ══ PEDIR ORÇAMENTO VIA POST ══
function pedirOrcamentoPost(painterId, painterName){
  document.getElementById('orc-painter-id').value = painterId;
  const nameEl = document.querySelector('#screen-orcamento .orc-painter-name');
  if(nameEl) nameEl.textContent = painterName;
  showScreen('orcamento');
}

// ══ LOJA CHECKOUT ══
async function comprarObra(postId, artistName, price, artType){
  if(!currentUser){ toast('Faça login para comprar'); return; }
  if(!confirm('Comprar "'+artType+'" de '+artistName+' por R$ '+price.toLocaleString('pt-BR')+'?')) return;
  const sb = getSupabase(); if(!sb) return;
  const { error } = await sb.from('orders').insert({
    user_id: currentUser.id,
    items: [{id:postId, name:artType+' - '+artistName, price, qty:1, type:'artwork'}],
    total: price,
    status: 'pending'
  });
  if(error){ toast('Erro ao comprar: '+error.message); return; }
  // Award points
  const pts = Math.floor(price/10)*5;
  if(pts > 0) earnPoints(currentUser.id, pts, 'artwork_purchase');
  toast('Compra realizada! O artista será notificado. +'+pts+' pontos 🎨');
}

function openChatWithUser(userId){
  showScreen('chat');
  setTimeout(()=>{ if(typeof openChat==='function') openChat(userId); },300);
}

function abrirOrcamentoChat(painterId, painterName){
  if(!currentUser){ showScreen('auth'); return; }
  const existing = document.getElementById('orc-chat-overlay');
  if(existing) existing.remove();

  // Store in closure to avoid escaping issues in onclick strings
  window._orcPainter = { id: painterId, name: painterName };

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
    btn
  );
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

function enviarOrcamentoForm(){
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

  const overlay = document.getElementById('orc-chat-overlay');
  if(overlay) overlay.remove();
  window._orcPainter = null;

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

// ══ PUBLISH VIDEO (REELS) ══
// Updated publishPost to handle video media_type
// ══ CONTENT MODERATION ══
const _blockedWords = [
  'pornografia','nudez','nude','nudes','sexo','xxx','drogas','maconha','cocaina',
  'racismo','racista','nazismo','nazi','hitler','terrorismo','terrorista',
  'matar','assassinar','estupro','pedofilia','pedofilo',
  'arma','revolver','pistola','fuzil','traficante','trafico',
  'suicide','suicidio','se matar'
];
const _suspectWords = [
  'puta','caralho','foda','merda','viado','sapatao','corno',
  'idiota','imbecil','retardado','lixo humano','vagabundo'
];

function moderateContent(text){
  if(!text) return { approved: true, reason: null };
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  // Check blocked words - auto-reject
  for(const word of _blockedWords){
    const w = word.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(lower.includes(w)) return { approved: false, reason: 'blocked:'+word };
  }
  // Check suspect words - send to review
  for(const word of _suspectWords){
    const w = word.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(lower.includes(w)) return { approved: false, reason: 'suspect:'+word };
  }
  // Check for URLs/links (spam prevention)
  if(lower.match(/https?:\/\/|www\.|\.com\.br|bit\.ly|t\.me/)){
    return { approved: false, reason: 'link_detected' };
  }
  return { approved: true, reason: null };
}

async function moderateContentAsync(text, imageUrl, hasMedia){
  const local = moderateContent(text || '');
  if (!local.approved) return { approved: false, reason: local.reason, severity: 'soft' };
  // Fail-safe: se há mídia (imagem/vídeo) e a moderação cair, vai pra revisão
  // humana em vez de publicar direto. Texto puro que passou no filtro local publica.
  const failSafe = hasMedia
    ? { approved: false, reason: 'mod_unavailable', severity: 'soft' }
    : { approved: true, reason: null };
  try {
    const r = await fetch('/api/moderate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text || '', imageUrl: imageUrl || '' })
    });
    if (!r.ok) return failSafe;
    const data = await r.json();
    if (data.error || data.engine === 'failed') return failSafe;
    if (data.flagged) {
      return { approved: false, reason: 'ai:' + (data.reasons || []).join(','), severity: data.severity || 'soft' };
    }
    return { approved: true, reason: null };
  } catch(e){
    console.warn('moderateContentAsync fail-safe:', e);
    return failSafe;
  }
}

function getMediaType(file){
  if(!file) return 'image';
  if(file.type && file.type.startsWith('video/')) return 'video';
  const ext = file.name?.split('.').pop()?.toLowerCase();
  if(['mp4','webm','mov','avi'].includes(ext)) return 'video';
  return 'image';
}

// ══ MODAL LOADERS (called on open) ══
(function(){
  const _orig = showModal;
  const _loaders = {'agenda-modal':loadAgenda,'agenda-add-modal':prefillNovoProjeto,'checklist-modal':renderChecklist,'lucro-modal':loadFinanceiro,'referral-modal':loadReferrals,'points-modal':loadPoints};
  showModal = function(id){ _orig(id); if(_loaders[id]) _loaders[id](); };
})();

// ══ CHAT SYSTEM ══
let currentChat = null;
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
function getLocalConvKey(){
  return currentUser ? 'quc_convs_' + currentUser.id : null;
}
function getLocalMsgsKey(convId){
  return currentUser ? 'quc_msgs_' + currentUser.id + '_' + convId : null;
}
function saveConvLocal(convId, convMeta){
  const key = getLocalConvKey();
  if(!key) return;
  try {
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    all[convId] = { ...convMeta, updatedAt: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(all));
  } catch(e){ console.warn('saveConvLocal err:', e); }
}
function loadConvsLocal(){
  const key = getLocalConvKey();
  if(!key) return {};
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch(e){ return {}; }
}
function saveMsgLocal(convId, msg){
  const key = getLocalMsgsKey(convId);
  if(!key) return;
  try {
    const msgs = JSON.parse(localStorage.getItem(key) || '[]');
    // Avoid duplicates by checking content+time
    const isDup = msgs.some(m => m.content === msg.content && m.time === msg.time && m.from === msg.from);
    if(!isDup){
      msgs.push(msg);
      // Keep last 100 messages per conversation
      if(msgs.length > 100) msgs.splice(0, msgs.length - 100);
      localStorage.setItem(key, JSON.stringify(msgs));
    }
  } catch(e){ console.warn('saveMsgLocal err:', e); }
}
function loadMsgsLocal(convId){
  const key = getLocalMsgsKey(convId);
  if(!key) return [];
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e){ return []; }
}

// ══ LOAD CHAT LIST (localStorage primary + Supabase background sync) ══
async function loadChatList(){
  const container = document.getElementById('conv-list');
  if(!currentUser || !container) return;
  const myId = currentUser.id;

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
  } catch(e){ console.warn('get_conversations RPC indisponível, usando fallback:', e); }

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
        const { data: profs } = await sb.from('profiles').select('id, name, avatar_url, role, user_type, tag, email').in('id', otherIds);
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
  } catch(e){ console.warn('loadChatList supabase sync error:', e); }
}

function renderConvList(container, convMap, myId){
  const convList = Object.entries(convMap).sort((a,b) => new Date(b[1].updatedAt||0) - new Date(a[1].updatedAt||0));
  if(convList.length === 0){
    container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Sem conversas</div><div style="font-size:13px;">Suas mensagens aparecerão aqui</div></div>';
    return;
  }
  container.innerHTML = convList.map(([convId, c]) => {
    const name = convDisplayName(c);
    const avatar = c.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(name)+'&background=e8e2d9&color=1a1a2e&size=96';
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
        name: is3way ? name + ' + Cali Colors' : name,
        sub: is3way ? '3 participantes · Chat 3-way ativo' : (c.tag ? '@' + c.tag : ''),
        participants: is3way
          ? [{logo:true,name:'Cali Colors',role:'Loja Oficial'},{img:avatar,name:name,role:isPintor?'Pintor':'Cliente'}]
          : [{img:avatar,name:name,role:isPintor?'Pintor':'Cliente'}],
        messages: []
      };
    }
    const displayName = is3way ? name + ' + Cali Colors' : name;
    const storeAvatar = is3way
      ? '<div class="conv-av-store" style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center;border:2px solid var(--bg);z-index:2;"><span style="font-size:7px;font-weight:800;color:var(--p1);font-family:\'Syne\',sans-serif;">CC</span></div>'
      : '';
    const threewayBadge = is3way ? ' <span style="background:var(--ink);color:var(--p1);font-size:9px;padding:2px 6px;border-radius:10px;font-weight:700;">+ CALI</span>' : '';
    return '<div class="conv-item" data-cat="'+cats.join(' ')+'" onclick="openChat(\''+convId+'\')">'
      + '<div class="conv-avatars" style="position:relative;"><div class="conv-av-main"><img src="'+avatar+'" alt=""></div>'+storeAvatar+'</div>'
      + '<div class="conv-info"><div class="conv-name">'+escapeHtml(displayName)+threewayBadge+(isPintor && !is3way?' <span style="background:var(--p1);color:#fff;font-size:9px;padding:2px 6px;border-radius:10px;font-weight:700;">PINTOR</span>':'')+'</div>'
      + '<div class="conv-preview">'+(isMine?'Voce: ':'')+escapeHtml(preview.substring(0,50))+'</div></div>'
      + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;"><div class="conv-time">'+time+'</div></div>'
      + '</div>';
  }).join('');
  const activeTab = document.querySelector('.chat-tab.active');
  applyChatFilter(activeTab ? (activeTab.dataset.filter || 'all') : 'all');
}

// ══ NEW CHAT MODAL ══
const CALICOLORS_EMAIL = 'calicolortintas@gmail.com';
let calicolorsUserId = null;

async function searchNewChatUsers(query){
  const container = document.getElementById('new-chat-users-list');
  if(!query || query.trim().length < 2){ container.innerHTML = ''; return; }
  const sb = getSupabase();
  if(!sb) return;
  try {
    const q = query.replace('@','').trim().toLowerCase();
    const res = await sb.from('profiles').select('id, name, tag, avatar_url, role, user_type').limit(200);
    const all = res.data || [];
    const filtered = all.filter(p => {
      if(currentUser && p.id === currentUser.id) return false;
      const n = (p.name||'').toLowerCase();
      const t = (p.tag||'').toLowerCase();
      return n.includes(q) || t.includes(q);
    });
    if(filtered.length === 0){
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">Nenhum usuario encontrado</div>';
      return;
    }
    container.innerHTML = filtered.map(p => {
      const avatar = p.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(p.name||'?')+'&background=e8e2d9&color=1a1a2e&size=96';
      const isPintor = isProfessionalRole(p.role) || isProfessionalRole(p.user_type);
      return `<div onclick="startNewChat('${p.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <img src="${avatar}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">
        <div style="flex:1;"><div style="font-size:14px;font-weight:700;">${escapeHtml(p.name||'Sem nome')}</div><div style="font-size:12px;color:var(--muted);">${p.tag ? '@'+p.tag : ''}</div></div>
        ${isPintor ? '<span style="background:var(--ink);color:var(--p1);font-size:9px;font-weight:700;padding:3px 8px;border-radius:10px;">PINTOR</span>' : ''}
      </div>`;
    }).join('');
  } catch(e){ console.warn('searchNewChatUsers error:', e); }
}

async function startNewChat(userId){
  closeModals();
  const sb = getSupabase();
  if(!sb || !currentUser) { toast('Faca login para enviar mensagens'); return; }

  if(userId === 'calicolors'){
    // Find or use Cali Colors user ID
    if(!calicolorsUserId){
      try {
        const { data } = await sb.from('profiles').select('id').eq('tag', 'calicolorstintas').limit(1);
        if(data && data.length > 0) calicolorsUserId = data[0].id;
      } catch(e){}
    }
    if(!calicolorsUserId){
      // Try finding by email as fallback
      try {
        const { data } = await sb.from('profiles').select('id').ilike('name', '%cali%').limit(1);
        if(data && data.length > 0) calicolorsUserId = data[0].id;
      } catch(e){}
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

  // Load the other user's profile
  try {
    const { data: prof } = await sb.from('profiles').select('name, avatar_url, tag, role, user_type').eq('id', userId).single();
    if(prof){
      const name = prof.name || 'Usuario';
      chatData[convId].name = name;
      chatData[convId].sub = prof.tag ? '@' + prof.tag : '';
      chatData[convId].participants = [{
        img: prof.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(name)+'&background=e8e2d9&color=1a1a2e&size=96',
        name: name,
        role: isProfessionalRole(prof.role||prof.user_type) ? ({pintor:'Pintor',grafiteiro:'Grafiteiro',automotivo:'Pintor Automotivo'}[prof.role||prof.user_type]||'Profissional') : 'Usuario'
      }];
    }
  } catch(e){}

  openChat(convId);
}

// ══ LOAD NOTIFICATIONS FROM SUPABASE ══
async function loadNotifications(){
  const sb = getSupabase();
  const container = document.getElementById('notif-list');
  if(!sb || !currentUser || !container) return;
  // Mark as read: clear badge
  localStorage.setItem('notif_last_seen', new Date().toISOString());
  updateNotifBadge(false);
  try {
    const myId = currentUser.id;
    // Fetch my post IDs first
    const { data: myPosts } = await sb.from('posts').select('id').eq('user_id', myId);
    const myPostIds = (myPosts || []).map(p => p.id);

    const queries = [
      sb.from('follows').select('id, follower_id, created_at, profiles:follower_id(name, avatar_url, tag)').eq('following_id', myId).order('created_at', { ascending: false }).limit(15),
      sb.from('announcements').select('id, title, message, created_at').eq('active', true).order('created_at', { ascending: false }).limit(5).then(r=>r).catch(()=>({data:[]})),
    ];
    if(myPostIds.length > 0){
      queries.push(
        sb.from('likes').select('id, user_id, post_id, created_at, profiles:user_id(name, avatar_url, tag)').in('post_id', myPostIds).neq('user_id', myId).order('created_at', { ascending: false }).limit(20),
        sb.from('comments').select('id, user_id, post_id, text, created_at, profiles:user_id(name, avatar_url, tag)').in('post_id', myPostIds).neq('user_id', myId).order('created_at', { ascending: false }).limit(20)
      );
    }
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
    notifs.sort((a,b) => new Date(b.time) - new Date(a.time));
    if(notifs.length === 0){
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Sem notificações</div><div style="font-size:13px;">Suas notificações aparecerão aqui</div></div>';
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
      const avatar = n.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(n.name)+'&background=e8e2d9&color=1a1a2e&size=96';
      let text = '';
      if(n.type === 'follow')   text = '<b>'+escapeHtml(n.name)+'</b> começou a te seguir.';
      else if(n.type === 'like') text = '<b>'+escapeHtml(n.name)+'</b> curtiu seu post. 🖌️';
      else if(n.type === 'comment') text = '<b>'+escapeHtml(n.name)+'</b> comentou: <i>'+escapeHtml((n.text||'').slice(0,60))+'</i>';
      return '<div class="notif-card"><div class="notif-av"><img src="'+avatar+'" alt=""></div><div class="notif-txt">'+text+'</div><div class="notif-time">'+timeAgo+'</div></div>';
    }).join('');
  } catch(e){
    console.error('loadNotifications error:', e);
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Erro ao carregar notificações</div>';
  }
}

function updateNotifBadge(show){
  const dot = document.getElementById('notif-badge-dot');
  if(!dot) return;
  dot.style.display = show ? 'block' : 'none';
}

let _notifSub = null;
async function setupNotifSubscription(){
  if(_notifSub || !currentUser) return;
  const sb = getSupabase();
  if(!sb) return;
  const myId = currentUser.id;
  // Fetch my post IDs once for filtering
  const { data: myPosts } = await sb.from('posts').select('id').eq('user_id', myId);
  const myPostIds = new Set((myPosts || []).map(p => p.id));

  _notifSub = sb.channel('notif-'+myId)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'likes' }, payload => {
      const l = payload.new;
      if(!l || l.user_id === myId || !myPostIds.has(l.post_id)) return;
      updateNotifBadge(true);
      toast('🖌️ Alguém curtiu seu post!');
    })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'comments' }, payload => {
      const c = payload.new;
      if(!c || c.user_id === myId || !myPostIds.has(c.post_id)) return;
      updateNotifBadge(true);
      toast('💬 Alguém comentou no seu post!');
    })
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'follows', filter:'following_id=eq.'+myId }, payload => {
      updateNotifBadge(true);
      toast('👤 Alguém começou a te seguir!');
    })
    .subscribe();
}

// ══ LOAD PEDIDOS FROM SUPABASE ══
async function loadPedidos(){
  const sb = getSupabase();
  const container = document.getElementById('pedidos-list');
  if(!sb || !currentUser || !container) return;
  try {
    const myId = currentUser.id;
    // Load quotes (orcamentos)
    const { data: quotes, error } = await sb.from('quotes')
      .select('*, painter:profiles!painter_id(name, avatar_url), client:profiles!client_id(name, avatar_url)')
      .or('client_id.eq.'+myId+',painter_id.eq.'+myId)
      .order('created_at', { ascending: false });
    if(error) throw error;

    // Load store orders (compras da loja)
    let orders = [];
    try {
      const { data: ordersData } = await sb.from('orders')
        .select('*')
        .eq('user_id', myId)
        .order('created_at', { ascending: false });
      orders = ordersData || [];
    } catch(e){ /* orders table might not exist yet */ }

    if((!quotes || quotes.length === 0) && orders.length === 0){
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Sem pedidos</div><div style="font-size:13px;">Seus orcamentos e compras aparecerão aqui</div></div>';
      return;
    }
    const statusLabels = { pending:'Aguardando', accepted:'Aceito', completed:'Concluido', rejected:'Rejeitado', processing:'Em andamento', shipped:'Enviado' };
    const statusClasses = { pending:'status-aguardando', accepted:'status-respondido', completed:'status-concluido', rejected:'status-rejeitado', processing:'status-respondido', shipped:'status-concluido' };

    let html = '';
    // Render store orders
    orders.forEach(o => {
      const itemNames = (o.items || []).map(i => i.name).slice(0,3).join(', ');
      const st = statusLabels[o.status] || 'Aguardando';
      const stClass = statusClasses[o.status] || 'status-aguardando';
      const date = o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '';
      const total = o.total ? 'R$ '+Number(o.total).toFixed(2).replace('.',',') : '';
      html += '<div data-status="'+(o.status||'pending')+'" class="pedido-card">'
        + '<div class="pedido-head">'
        + '<div class="pedido-pav" style="background:var(--ink);display:flex;align-items:center;justify-content:center;border-radius:10px;width:40px;height:40px;"><span style="font-size:10px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">CC</span></div>'
        + '<div><div class="pedido-painter">Cali Colors - Loja</div><div class="pedido-tipo">'+escapeHtml(itemNames || 'Compra')+'</div></div>'
        + '<div class="pedido-status '+stClass+'">'+st+'</div>'
        + '</div>'
        + '<div class="pedido-meta">'+(total?'<span>'+total+'</span>':'')+'<span>'+date+'</span></div>'
        + '</div>';
    });

    // Render quotes
    (quotes || []).forEach(q => {
      const isClient = q.client_id === myId;
      const other = isClient ? (q.painter || {}) : (q.client || {});
      const name = other.name || 'Usuario';
      const avatar = other.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(name)+'&background=e8e2d9&color=1a1a2e&size=96';
      const st = statusLabels[q.status] || q.status || 'Pendente';
      const stClass = statusClasses[q.status] || 'status-aguardando';
      const date = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '';
      const price = q.price ? 'R$ '+Number(q.price).toLocaleString('pt-BR') : '';
      html += '<div data-status="'+(q.status||'pending')+'" class="pedido-card">'
        + '<div class="pedido-head">'
        + '<div class="pedido-pav"><img src="'+avatar+'" alt=""></div>'
        + '<div><div class="pedido-painter">'+escapeHtml(name)+'</div><div class="pedido-tipo">'+(q.service_type||q.title||'Orcamento')+'</div></div>'
        + '<div class="pedido-status '+stClass+'">'+st+'</div>'
        + '</div>'
        + '<div class="pedido-meta">'+(price?'<span>'+price+'</span>':'')+'<span>'+date+'</span></div>'
        + '</div>';
    });
    container.innerHTML = html;
  } catch(e){
    console.error('loadPedidos error:', e);
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Erro ao carregar pedidos</div>';
  }
}

let _epAvatarFile = null; // holds selected avatar file for upload

function previewAvatar(input){
  if(input.files && input.files[0]){
    _epAvatarFile = input.files[0];
    const reader = new FileReader();
    reader.onload = e => { document.getElementById('ep-avatar-preview').src = e.target.result; };
    reader.readAsDataURL(input.files[0]);
  }
}

async function openEditProfile(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  _epAvatarFile = null; // reset
  try {
    const { data: prof } = await sb.from('profiles').select('name, tag, city, state, phone, specialties, avatar_url').eq('id', currentUser.id).single();
    if(prof){
      document.getElementById('ep-name').value = prof.name || '';
      document.getElementById('ep-tag').value = prof.tag || '';
      document.getElementById('ep-email').value = prof.email || currentUser.email || '';
      document.getElementById('ep-city').value = prof.city || '';
      document.getElementById('ep-state').value = prof.state || '';
      document.getElementById('ep-phone').value = prof.phone || '';
      document.getElementById('ep-specs').value = prof.specialties || '';
      // Show current avatar
      const preview = document.getElementById('ep-avatar-preview');
      if(preview) preview.src = prof.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(prof.name || 'U')+'&background=e8e2d9&color=1a1a2e&size=96';
    } else {
      // Fallback to user_metadata
      const meta = currentUser.user_metadata || {};
      document.getElementById('ep-name').value = meta.name || currentUser.email?.split('@')[0] || '';
      document.getElementById('ep-tag').value = meta.tag || '';
      document.getElementById('ep-email').value = currentUser.email || '';
      document.getElementById('ep-city').value = '';
      document.getElementById('ep-state').value = '';
      document.getElementById('ep-phone').value = '';
      document.getElementById('ep-specs').value = '';
      const preview = document.getElementById('ep-avatar-preview');
      if(preview) preview.src = 'https://ui-avatars.com/api/?name='+encodeURIComponent(meta.name || 'U')+'&background=e8e2d9&color=1a1a2e&size=96';
    }
  } catch(e){ console.warn('openEditProfile error:', e); }
  showModal('edit-profile-modal');
}

async function saveEditProfile(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const btn = document.getElementById('ep-save-btn');
  btn.textContent = 'Salvando...'; btn.disabled = true;
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
            console.log('Avatar uploaded to avatars bucket:', updates.avatar_url);
          }
        } else {
          console.warn('Avatars bucket upload failed:', upErr.message);
        }
      } catch(e){ console.warn('Avatars bucket error:', e); }

      // Fallback: try posts bucket
      if(!avatarUploaded){
        try {
          const fallbackPath = 'avatar_' + currentUser.id + '_' + ts + '.' + ext;
          const { error: upErr2 } = await sb.storage.from('posts').upload(fallbackPath, _epAvatarFile, { upsert: true });
          if(!upErr2){
            const { data: urlData } = sb.storage.from('posts').getPublicUrl(fallbackPath);
            if(urlData && urlData.publicUrl){
              updates.avatar_url = urlData.publicUrl;
              avatarUploaded = true;
              console.log('Avatar uploaded to posts bucket:', updates.avatar_url);
            }
          } else {
            console.warn('Posts bucket upload failed:', upErr2.message);
          }
        } catch(e){ console.warn('Posts bucket error:', e); }
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
          console.log('Avatar saved as data URL (storage unavailable)');
        } catch(e){ console.warn('Data URL fallback error:', e); }
      }

      if(!avatarUploaded){
        toast('Erro no upload da foto, mas salvando perfil...');
      }
      _epAvatarFile = null;
      btn.textContent = 'Salvando...';
    }

    // Try update first, then insert if profile doesn't exist
    const { data: existing } = await sb.from('profiles').select('id').eq('id', currentUser.id).single();
    if(existing){
      const { error } = await sb.from('profiles').update(updates).eq('id', currentUser.id);
      if(error){
        console.error('Profile update error:', error);
        throw error;
      }
    } else {
      updates.id = currentUser.id;
      updates.role = currentUser.user_metadata?.role || currentUser.user_metadata?.user_type || 'cliente';
      updates.user_type = updates.role;
      const { error } = await sb.from('profiles').insert(updates);
      if(error){
        console.error('Profile insert error:', error);
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
      } catch(e){ console.warn('email update falhou:', e); }
    }
    console.log('Profile saved successfully, avatar_url:', updates.avatar_url || '(unchanged)');
    toast('Perfil salvo!');
    closeModals();
    // Update all avatar locations after save
    if(updates.avatar_url){
      const myAvEl = document.getElementById('myprofile-avatar');
      if(myAvEl) myAvEl.src = updates.avatar_url;
      const storyAvEl = document.getElementById('my-story-avatar');
      if(storyAvEl) storyAvEl.src = updates.avatar_url;
    }
    loadMyProfileData();
    updateMyStoryAvatar();
  } catch(e){
    console.error('saveEditProfile error:', e);
    toast('Erro ao salvar: ' + (e.message || 'tente novamente'));
  }
  btn.textContent = 'Salvar'; btn.disabled = false;
}

function sharePost(postId){
  if(navigator.share){
    navigator.share({ title:'QueroUmaCor', text:'Confira este post no QueroUmaCor!', url:window.location.href }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(window.location.href).then(()=>toast('Link copiado!')).catch(()=>toast('Compartilhar nao disponivel'));
  }
}

const chatData = {};
let _globalMsgSub = null;

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
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });
  } catch(e){ console.error('setupGlobalMsgSubscription error:', e); }
}

async function handleRealtimeMsg(payload){
  const m = payload.new;
  if(!m || !currentUser) return;
  const myId = currentUser.id;
  const isMine = m.sender_id === myId;

  console.log('Realtime msg received:', m.id, 'from:', m.sender_id, 'conv:', m.conversation_id, 'type:', m.type);

  // Save incoming message to localStorage so it persists
  if(!isMine && m.type !== 'system'){
    const t = new Date(m.created_at || Date.now());
    const time = t.getHours()+':'+(t.getMinutes()<10?'0':'')+t.getMinutes();
    saveMsgLocal(m.conversation_id, { from:'other', content: m.content, type: m.type || 'text', time });

    // Ensure conversation exists in localStorage for the receiver
    const localConvs = loadConvsLocal();
    if(!localConvs[m.conversation_id]){
      // New conversation - fetch sender profile to populate it
      try {
        const sb = getSupabase();
        if(sb){
          const { data: prof } = await sb.from('profiles').select('id, name, avatar_url, role, user_type, tag, email').eq('id', m.sender_id).single();
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
              name: prof.name || 'Usuario',
              sub: prof.tag ? '@' + prof.tag : '',
              participants: [{img: prof.avatar_url || '', name: prof.name || 'Usuario', role: isProfessionalRole(prof.role) ? ({pintor:'Pintor',grafiteiro:'Grafiteiro',automotivo:'Pintor Automotivo'}[prof.role]||'Profissional') : 'Usuario'}],
              messages: []
            };
          }
        }
      } catch(e){ console.warn('handleRealtimeMsg profile fetch:', e); }
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

  // Always refresh chat list (even if not visible, so it's ready when user opens it)
  const chatScreen = document.getElementById('screen-chat');
  if(chatScreen && chatScreen.style.display !== 'none'){
    loadChatList();
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
        const { data: sp } = await sb.from('profiles').select('name, avatar_url, portal_access').eq('id', m.sender_id).single();
        if(sp && sp.portal_access){
          appendMsg({ id: m.id, from:'store', text: m.content, time, type: m.type || 'text', sender:'Cali Colors' });
          return;
        }
        senderName = sp ? sp.name : '';
        senderImg = sp ? (sp.avatar_url || '') : '';
      } catch(e){}
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

// Bridge function for starting chat from profile
function openChatConversation(userId, userName){
  startNewChat(userId);
}


// ══ AUTH ══
let selectedRole='pintor';
function selectRole(r){
  selectedRole=r;
  ['pintor','grafiteiro','automotivo','cliente'].forEach(role=>{
    const el=document.getElementById('role-'+role);
    if(el) el.classList.toggle('active',r===role);
  });
}
let validatedInviteCode = null;

async function validateInvite(){
  const code = document.getElementById('s-invite-code').value.trim().toUpperCase();
  const errEl = document.getElementById('invite-error');
  if(!code){ errEl.textContent='Insira o codigo de convite.'; errEl.style.display='block'; return; }
  errEl.style.display='none';

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('invites')
      .select('id, code, used, max_uses, uses, created_by')
      .eq('code', code)
      .single();

    if(error || !data){
      errEl.textContent='Codigo invalido. Verifique e tente novamente.';
      errEl.style.display='block';
      return;
    }
    if(data.used || (data.max_uses > 0 && data.uses >= data.max_uses)){
      errEl.textContent='Este convite ja foi utilizado.';
      errEl.style.display='block';
      return;
    }
    validatedInviteCode = data;
    toast('Convite valido!');
    signupNext(1);
  } catch(e){
    // If table doesn't exist yet, allow signup anyway for development
    console.warn('Invite validation error:', e);
    validatedInviteCode = { code };
    toast('Convite aceito!');
    signupNext(1);
  }
}

function signupNext(step){
  [0,1,2,3].forEach(s=>{
    const el=document.getElementById('signup-step'+s);
    if(el)el.style.display=s===step?'block':'none';
    const dot=document.getElementById('sdot'+s);
    if(dot)dot.classList.toggle('active',s===step);
  });
  if(step===3){
    document.getElementById('s3-pintor').style.display=isProfessionalRole(selectedRole)?'block':'none';
    document.getElementById('s3-cliente').style.display=selectedRole==='cliente'?'block':'none';
    if(isProfessionalRole(selectedRole)) loadSpecsForRole(selectedRole);
  }
  document.getElementById('screen-signup').querySelector('.auth-screen').scrollTop=0;
}

async function doSignup(){
  const name=document.getElementById('s-name').value.trim();
  const tag=document.getElementById('s-tag').value.trim();
  const email=document.getElementById('s-email').value.trim();
  const pw=document.getElementById('s-pw').value;
  const role=selectedRole||'cliente';
  if(!name||!email||!pw){toast('Preencha nome, email e senha');return;}

  // Mark invite as used
  if(validatedInviteCode && validatedInviteCode.id){
    try {
      const sb = getSupabase();
      await sb.from('invites').update({ uses: (validatedInviteCode.uses||0)+1 }).eq('id', validatedInviteCode.id);
    } catch(e){ console.warn('Could not update invite:', e); }
  }

  doRegisterSupabase(name,email,pw,role,tag);
}
const _roleSpecs = {
  pintor: ['Residencial','Comercial','Textura','Grafiato','Piso Epóxi','Fachada','Degradê','Stencil','Industrial','Caiação'],
  grafiteiro: ['Grafite Artístico','Mural Decorativo','Painel Comercial','Arte Urbana','Lettering','Realismo','Abstrato','3D / Ilusão','Stencil Urbano','Lambe-lambe'],
  automotivo: ['Pintura Automotiva','Funilaria','Envelopamento','Polimento','Cristalização','Customização','Aerografia','Restauração','Martelinho de Ouro','PPF / Película']
};

function loadSpecsForRole(role){
  const grid = document.getElementById('spec-grid');
  if(!grid) return;
  const specs = _roleSpecs[role] || _roleSpecs['pintor'];
  grid.innerHTML = specs.map((s,i) => '<div class="spec-chip'+(i<2?' sel':'')+'" onclick="toggleSpec(this)">'+s+'</div>').join('');
}

function toggleSpec(el){el.classList.toggle('sel');}
const _proRoles = ['pintor','grafiteiro','automotivo'];
function isProfessionalRole(r){ return _proRoles.includes(r); }

function selectProfession(el){
  document.querySelectorAll('.profession-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function getSelectedProfession(){
  const active = document.querySelector('.profession-card.active');
  return active?.dataset.profession || 'pintor';
}

function setMode(mode){
  currentMode=mode;
  const modePintor=document.getElementById('mode-pintor');
  const modeCliente=document.getElementById('mode-cliente');
  const isPro = isProfessionalRole(mode);
  if(modePintor) modePintor.classList.toggle('active',isPro);
  if(modeCliente) modeCliente.classList.toggle('active',mode==='cliente');
  // Visao unica e completa para todos os perfis: evita o swap por papel
  // (metadata -> DB) que fazia as caixinhas aparecerem e sumirem.
  const vp=document.getElementById('view-pintor');
  const vc=document.getElementById('view-cliente');
  if(vp) vp.style.display='block';
  if(vc) vc.style.display='none';
  const fab=document.getElementById('post-fab');
  if(fab)fab.style.display='flex';
  const sa=document.getElementById('scroll-area');
  if(sa) sa.scrollTop=0;
}

// ══ PEDIDOS FILTER ══
function filterPedidos(el,status){
  el.closest('.pedidos-filter-row').querySelectorAll('.pfchip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('#screen-pedidos .pedido-card').forEach(card=>{
    if(status==='todos'||card.dataset.status===status)card.style.display='block';
    else card.style.display='none';
  });
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

  // Save to localStorage
  if(currentChat){
    saveMsgLocal(currentChat, { from:'me', content: msg, time: new Date().toISOString() });
    const localConvs = loadConvsLocal();
    const existing = localConvs[currentChat] || {};
    saveConvLocal(currentChat, { ...existing, lastMsg: msg, lastMsgFrom: 'me', lastMsgTime: new Date().toISOString() });
  }

  // Save to Supabase
  const sb = getSupabase();
  if(sb && currentUser){
    try {
      const parts = currentChat ? currentChat.split('_') : [];
      const uuidParts = parts.filter(p => p.includes('-'));
      const receiverId = uuidParts.find(id => id !== currentUser.id) || null;
      const insertData = {
        sender_id: currentUser.id,
        receiver_id: receiverId,
        conversation_id: currentChat,
        content: msg,
        type: 'text'
      };
      console.log('sendChatMsg: inserting', JSON.stringify(insertData));
      const { data: res, error } = await sb.from('messages').insert(insertData).select();
      if(error){ console.error('sendChatMsg error:', error.message, error.details); toast('Erro: ' + error.message); }
      else { console.log('sendChatMsg: saved OK, id=', res && res[0] ? res[0].id : 'unknown'); }
    } catch(e){ console.error('sendChatMsg save error:', e); toast('Erro ao salvar mensagem'); }
  }
}
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.activeElement?.id==='chat-input-field')sendChatMsg();
  if(e.key==='Enter'&&document.activeElement?.id==='chat-input')sendMsg();
});

// ══ AVALIAÇÃO ══
let starVal=0;
const starLabels=['','Ruim 😞','Regular 😐','Bom 🙂','Muito bom 😄','Excelente! 🤩'];
function setStar(n){
  starVal=n;
  document.querySelectorAll('.star-btn').forEach((s,i)=>s.classList.toggle('active',i<n));
  document.getElementById('star-label').textContent=starLabels[n];
  document.getElementById('star-label').style.color=n>=4?'var(--p6)':n>=3?'var(--p7)':'var(--p4)';
}
function toggleCriteria(el){el.classList.toggle('sel');}

let avaliarQuoteId = null;
async function loadAvaliarScreen(){
  const sb = getSupabase();
  const container = document.getElementById('avaliar-service-container');
  const form = document.getElementById('avaliar-form');
  if(!sb || !currentUser || !container) return;
  try {
    // Load completed/accepted quotes for the user to review
    const { data: quotes, error } = await sb.from('quotes')
      .select('id, title, service_type, area_m2, created_at, status, painter:profiles!painter_id(id, name, avatar_url, city)')
      .eq('client_id', currentUser.id)
      .in('status', ['completed','accepted'])
      .order('created_at', { ascending: false })
      .limit(10);
    if(error) throw error;
    if(!quotes || quotes.length === 0){
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:40px;margin-bottom:12px;">⭐</div><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum servico para avaliar</div><div style="font-size:13px;">Quando um orcamento for concluido, voce podera avaliar aqui</div></div>';
      form.style.display = 'none';
      return;
    }
    // Show the first/most recent service to evaluate
    const q = quotes[0];
    const painter = q.painter || {};
    avaliarQuoteId = q.id;
    const avatar = painter.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(painter.name||'P')+'&background=e8e2d9&color=1a1a2e&size=96';
    document.getElementById('avaliar-av-img').src = avatar;
    document.getElementById('avaliar-title').textContent = painter.name || 'Pintor';
    document.getElementById('avaliar-sub').textContent = (q.service_type||q.title||'Servico') + (painter.city ? ' · '+painter.city : '') + (q.area_m2 ? ' · '+q.area_m2+'m²' : '');
    container.innerHTML = '';
    form.style.display = 'block';
    // Show other services as selectable list if > 1
    if(quotes.length > 1){
      container.innerHTML = '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Selecione o servico</div>' +
        quotes.map(qq => {
          const pp = qq.painter || {};
          return '<div onclick="selectAvaliarService(\''+qq.id+'\')" style="padding:10px;background:'+(qq.id===q.id?'var(--cream)':'var(--white)')+';border-radius:10px;margin-bottom:6px;cursor:pointer;border:1px solid '+(qq.id===q.id?'var(--p1)':'var(--border)')+';font-size:13px;"><b>'+(pp.name||'Pintor')+'</b> — '+(qq.service_type||qq.title||'Servico')+'</div>';
        }).join('');
    }
  } catch(e){
    console.error('loadAvaliarScreen error:', e);
    container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum servico para avaliar</div><div style="font-size:13px;">Solicite um orcamento primeiro</div></div>';
    form.style.display = 'none';
  }
}

async function submitAvaliacao(){
  if(!starVal){toast('Selecione uma nota primeiro!');return;}
  const sb = getSupabase();
  if(!sb || !currentUser){ toast('Faca login primeiro'); return; }
  const criteria = [];
  document.querySelectorAll('.criteria-chip.sel').forEach(c => criteria.push(c.textContent.trim()));
  const comment = document.getElementById('avalia-ta')?.value.trim() || '';
  try {
    const { error } = await sb.from('reviews').insert({
      reviewer_id: currentUser.id,
      quote_id: avaliarQuoteId || null,
      rating: starVal,
      criteria: criteria,
      comment: comment || null,
      created_at: new Date().toISOString()
    });
    if(error) throw error;
    toast('Avaliacao enviada! '+starLabels[starVal]);
    starVal = 0;
    document.querySelectorAll('.star-btn').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.criteria-chip.sel').forEach(c => c.classList.remove('sel'));
    if(document.getElementById('avalia-ta')) document.getElementById('avalia-ta').value = '';
    setTimeout(()=>showScreen('myprofile'),1200);
  } catch(e){
    console.error('submitAvaliacao error:', e);
    toast('Erro ao enviar avaliacao');
  }
}

// ══ ORCAMENTO ══
function openOrcamento(){
  const p = painters[currentPainter];
  if(p){
    document.querySelector('.opc-name').innerHTML = p.name + (p.pro ? ' <span style="background:var(--ink);color:var(--p1);font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;">PRO</span>' : '');
    document.querySelector('.opc-av img').src = p.img || 'https://i.pravatar.cc/150?img=11';
    document.querySelector('.opc-stars').textContent = '★★★★★ ' + (p.rating || '5.0');
    document.querySelector('.opc-sub').textContent = p.city || '';
  }
  // store painter supabase_id for insert (will be filled if painter has profile in DB)
  document.getElementById('orc-painter-id').value = p && p.supabase_id ? p.supabase_id : '';
  showScreen('orcamento');
}
async function sendOrc(){
  const sb = getSupabase();
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ toast('⚠️ Faça login para enviar orçamento.'); return; }

  const painterId = document.getElementById('orc-painter-id').value || null;
  const serviceType = document.getElementById('orc-service-type').value;
  const area = parseFloat(document.getElementById('orc-area').value) || null;
  const address = document.getElementById('orc-address').value.trim();
  const proposedDate = document.getElementById('orc-date').value || null;
  const description = document.getElementById('orc-desc').value.trim();

  if(!serviceType){ toast('⚠️ Selecione o tipo de serviço.'); return; }
  if(!address){ toast('⚠️ Informe o endereço.'); return; }

  const btn = document.querySelector('.orc-submit');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Enviando...';

  const { data: quoteData, error } = await sb.from('quotes').insert({
    client_id: session.user.id,
    painter_id: painterId || undefined,
    title: serviceType,
    service_type: serviceType,
    area_m2: area,
    address: address,
    description: description || null,
    proposed_date: proposedDate || null,
    status: 'pending',
    lead_type: painterId ? 'exclusive' : 'shared'
  }).select('id').single();

  btn.disabled = false;
  btn.querySelector('span').textContent = '📩 Enviar Solicitação';

  if(error){
    console.error('sendOrc error:', error);
    toast('❌ Erro ao enviar: ' + error.message);
  } else {
    // Auto-distribute lead if no specific painter
    if(!painterId && quoteData) distribuirLead(quoteData.id, serviceType, address);
    // Award points for quote request
    if(typeof earnPoints==='function') earnPoints(session.user.id, 5, 'quote_request');
    toast('✅ Solicitação enviada com sucesso!');
    // Clear form
    document.getElementById('orc-service-type').selectedIndex = 0;
    document.getElementById('orc-area').value = '';
    document.getElementById('orc-rooms').value = '';
    document.getElementById('orc-address').value = '';
    document.getElementById('orc-date').value = '';
    document.getElementById('orc-desc').value = '';
    setTimeout(()=>showScreen('profile'), 1800);
  }
}
let chatStoreAdded = false;

// Track which message IDs are already rendered to avoid duplicates
const renderedMsgIds = new Set();

function openChat(id) {
  currentChat = id;
  chatStoreAdded = false;
  renderedMsgIds.clear();
  const conv = chatData[id];
  if(!conv){ console.error('openChat: no chatData for', id); return; }

  // Save conversation to localStorage so it appears in chat list
  const otherP = conv.participants.find(p => !p.logo) || conv.participants[0] || {};
  saveConvLocal(id, {
    name: otherP.name || conv.name || 'Usuario',
    avatar: otherP.img || '',
    tag: conv.sub && conv.sub.startsWith('@') ? conv.sub.substring(1) : '',
    role: otherP.role || '',
    otherId: '',
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
          : `<img src="${p.img}" alt="${p.name}">`}
      </div>`).join('');
    avatarsEl.style.width=(parts.length*10+22)+'px';
  } else {
    const p=conv.participants[0];
    avatarsEl.innerHTML=`<div class="cha-av" style="left:0;width:36px;height:36px;"><img src="${p.img}" alt="${p.name}"></div>`;
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
          : `<img src="${p.img}" alt="${p.name}">`}
        <div><div class="part-chip-name">${escapeHtml(stripEmail(p.name))}</div><div class="part-chip-role">${p.role}</div></div>
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

    console.log('openChat: loading messages for conversation', id);
    // Load history by conversation_id (both sent and received)
    const { data: msgs, error } = await sb.from('messages')
      .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(100);

    if(error) console.error('openChat load error:', error.message, error.details);
    console.log('openChat: loaded', msgs ? msgs.length : 0, 'messages');

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
              : '<img src="'+p.img+'" alt="'+p.name+'">'}
          </div>`).join('');
        avatarsEl.style.width=(parts.length*10+22)+'px';
        const partRow = document.getElementById('participant-row');
        partRow.style.display='flex';
        partRow.innerHTML = conv.participants.map(p=>`
          <div class="part-chip ${p.logo?'store':''}">
            ${p.logo?'<div style="width:22px;height:22px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><span style="font-size:8px;font-weight:800;color:var(--p1);font-family:\'Syne\',sans-serif;">CC</span></div>':'<img src="'+p.img+'" alt="'+p.name+'">'}
            <div><div class="part-chip-name">${escapeHtml(stripEmail(p.name))}</div><div class="part-chip-role">${p.role}</div></div>
          </div>`).join('');
      }
      // Load profiles for all senders to show correct names in 3-way
      const senderIds = [...new Set(msgs.map(m => m.sender_id).filter(Boolean))];
      let senderProfiles = {};
      if(senderIds.length > 0){
        const { data: profs } = await sb.from('profiles').select('id, name, avatar_url, role, user_type, tag, portal_access').in('id', senderIds);
        if(profs) profs.forEach(p => { senderProfiles[p.id] = p; });
      }
      const otherPart = conv.participants.find(p => !p.logo) || conv.participants[0];
      const realMsgs = msgs.filter(m => m.type !== 'system').map(m => {
        const t = new Date(m.created_at);
        const time = t.getHours()+':'+(t.getMinutes()<10?'0':'')+t.getMinutes();
        const sp = senderProfiles[m.sender_id];
        const isStoreMsg = m.type === 'store' || (sp && sp.portal_access);
        if(isStoreMsg && m.sender_id !== myId){
          return { from:'store', text: m.content, time, type: m.type || 'text', sender:'Cali Colors', role:'loja' };
        }
        const senderName = cleanHandle(sp, otherPart ? otherPart.name : 'Usuario');
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

function _msgKind(role){
  if(role==='loja') return { label:'LOJA', fg:'#7a30d6', chip:'#efe7fb', bub:'#f3edfb', bd:'#d9c7f5' };
  if(role==='profissional') return { label:'PROFISSIONAL', fg:'#d2541f', chip:'#fff1e8', bub:'#fff3ec', bd:'#f6d4bf' };
  return { label:'CLIENTE', fg:'#2563eb', chip:'#e8f0fe', bub:'#eef4ff', bd:'#cdddfb' };
}

function renderMessages(msgs){
  const area = document.getElementById('msgs-area');
  area.innerHTML = msgs.map(m=>{
    const isImg = m.type === 'image' || (m.text && m.text.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i));
    const contentHtml = isImg
      ? '<img src="'+escapeHtml(m.text)+'" style="max-width:200px;border-radius:10px;display:block;" alt="foto">'
      : escapeHtml(m.text);
    const k = _msgKind(m.role);
    const bubbleStyle = `background:${k.bub};color:var(--ink);border:1px solid ${k.bd};`;
    const tag = `<div class="msg-tag" style="color:${k.fg};background:${k.chip};">${escapeHtml(m.sender||k.label)} · ${k.label}</div>`;

    if(m.from==='me') return `
      <div class="msg-row me">
        <div>
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
          <div>
            ${tag}
            <div class="msg-bubble" style="${bubbleStyle}">${isImg ? contentHtml : escapeHtml(m.text)}${extra}</div>
            <div class="msg-time">${m.time}</div>
          </div>
        </div>`;
    }

    return `
      <div class="msg-row">
        <div class="msg-av" style="background:${k.chip};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${k.fg};">${m.img ? '<img src="'+escapeHtml(m.img)+'" alt="">' : escapeHtml((m.sender||'?').charAt(0).toUpperCase())}</div>
        <div>
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

  // Save to localStorage
  if(currentChat){
    saveMsgLocal(currentChat, { from:'me', content: txt, time: new Date().toISOString() });
    // Update conversation preview
    const localConvs = loadConvsLocal();
    const existing = localConvs[currentChat] || {};
    saveConvLocal(currentChat, { ...existing, lastMsg: txt, lastMsgFrom: 'me', lastMsgTime: new Date().toISOString() });
  }

  // Save to Supabase
  const sb = getSupabase();
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ toast('Sessao expirada. Faca login novamente.'); return; }

  // Extract receiver_id from conversation_id
  // Format: uuid1_uuid2 (sorted). UUIDs use hyphens, so split on _ gives exactly 2 parts
  const parts = currentChat ? currentChat.split('_') : [];
  // Only consider parts that look like UUIDs (contain hyphens)
  const uuidParts = parts.filter(p => p.includes('-'));
  const receiverId = uuidParts.find(id => id !== session.user.id) || null;

  const insertData = {
    sender_id: session.user.id,
    receiver_id: receiverId,
    conversation_id: currentChat,
    content: txt,
    type: 'text'
  };
  console.log('sendMsg: inserting', JSON.stringify(insertData));
  const { data: insertResult, error } = await sb.from('messages').insert(insertData).select();
  if(error){
    console.error('sendMsg error:', error.message, error.details, error.hint);
    toast('Erro: ' + error.message);
  } else {
    console.log('sendMsg: saved OK, id=', insertResult && insertResult[0] ? insertResult[0].id : 'unknown');
  }
}

function appendMsg(m){
  // Prevent duplicate messages
  if(m.id && renderedMsgIds.has(m.id)) return;
  if(m.id) renderedMsgIds.add(m.id);
  const area = document.getElementById('msgs-area');
  if(!area) return;

  const isImg = m.type === 'image' || (m.text && m.text.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i));
  const contentHtml = isImg
    ? '<img src="'+escapeHtml(m.text)+'" style="max-width:200px;border-radius:10px;display:block;" alt="foto">'
    : escapeHtml(m.text);

  const conv = currentChat ? chatData[currentChat] : null;
  const is3way = conv && (conv.type === '3way' || conv.type === 'store');
  const div = document.createElement('div');
  if(m.from==='me'){
    div.className='msg-row me';
    div.innerHTML=`<div>${is3way && m.sender ? '<div class="msg-sender" style="text-align:right;">'+escapeHtml(m.sender)+'</div>' : ''}<div class="msg-bubble">${contentHtml}</div><div class="msg-time">${m.time}</div></div>`;
  } else if(m.from==='store'){
    div.className='msg-row';
    div.innerHTML=`<div class="msg-av store-av">CC</div><div><div class="msg-sender" style="color:var(--p1);">Cali Colors</div><div class="msg-bubble store">${contentHtml}</div><div class="msg-time">${m.time}</div></div>`;
  } else {
    div.className='msg-row';
    div.innerHTML=`<div class="msg-av"><img src="${m.img||''}" alt="${m.sender||''}"></div><div><div class="msg-sender">${m.sender||''}</div><div class="msg-bubble other">${contentHtml}</div><div class="msg-time">${m.time}</div></div>`;
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
  const sb = getSupabase();
  if(!sb || !currentUser){ toast('Faca login primeiro'); return; }
  toast('Enviando imagem...');
  try {
    const ext = file.name.split('.').pop();
    const path = 'chat/' + currentUser.id + '/' + Date.now() + '.' + ext;
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
    div.innerHTML = '<div><div class="msg-bubble"><img src="'+imgUrl+'" style="max-width:200px;border-radius:10px;display:block;" alt="foto"></div><div class="msg-time">'+time+'</div></div>';
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
    const parts = currentChat ? currentChat.split('_') : [];
    const uuidParts = parts.filter(p => p.includes('-'));
    const receiverId = uuidParts.find(id => id !== currentUser.id) || null;
    await sb.from('messages').insert({
      sender_id: currentUser.id,
      receiver_id: receiverId,
      conversation_id: currentChat,
      content: imgUrl,
      type: 'image'
    });
    toast('Imagem enviada!');
  } catch(e){
    console.error('handleChatAttachment error:', e);
    toast('Erro ao enviar imagem');
  }
}

function addStoreToChat(){
  if(chatStoreAdded) return;
  chatStoreAdded=true;
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
        : '<img src="'+(p.img||'')+'" alt="'+(p.name||'')+'">'}
    </div>`).join('');
  avatarsEl.style.width=(parts.length*10+22)+'px';

  const partRow=document.getElementById('participant-row');
  partRow.style.display='flex';
  partRow.innerHTML=conv.participants.map(p=>`
    <div class="part-chip ${p.logo?'store':''}">
      ${p.logo?'<div style="width:22px;height:22px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center;"><span style="font-size:8px;font-weight:800;color:var(--p1);font-family:\'Syne\',sans-serif;">CC</span></div>':'<img src="'+(p.img||'')+'" alt="'+(p.name||'')+'">'}
      <div><div class="part-chip-name">${escapeHtml(stripEmail(p.name))}</div><div class="part-chip-role">${p.role}</div></div>
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
    const parts = currentChat ? currentChat.split('_') : [];
    const uuidParts = parts.filter(p => p.includes('-'));
    const receiverId = uuidParts.find(id => id !== session.user.id) || null;
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


// ══ MARKETPLACE ══
let cartCount = 0;
let cartItems = JSON.parse(localStorage.getItem('quc_cart') || '[]');
let shirtQty = 1;
let logoState = {pintor: true, cali: true};
let mktProducts = [];

function mktTab(el, tab) {
  document.querySelectorAll('.mkt-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const si = document.getElementById('mkt-search'); if(si) si.value = '';
  const ss = document.getElementById('mkt-search-section'); if(ss) ss.style.display = 'none';
  ['tintas','texturas','epoxi','acessorios'].forEach(t => {
    const el2 = document.getElementById('mkt-' + t);
    if(el2) el2.style.display = t === tab ? 'block' : 'none';
  });
}

function updateCartBadge(){
  cartCount = cartItems.reduce((s,c) => s + (c.qty||1), 0);
  const el = document.getElementById('cart-count');
  if(el) el.textContent = cartCount;
}

function addToCart(productId, qty) {
  qty = Math.max(1, parseInt(qty) || 1);
  if(productId){
    const p = mktProducts.find(x => x.id === productId);
    if(p){
      const existing = cartItems.find(x => x.id === p.id);
      if(existing){
        existing.qty = (existing.qty || 1) + qty;
      } else {
        cartItems.push({ id:p.id, name:p.name, price:p.price, color_hex:p.color_hex, color_gradient:p.color_gradient, volume:p.volume, qty:qty });
      }
    }
  }
  localStorage.setItem('quc_cart', JSON.stringify(cartItems));
  updateCartBadge();
  toast('Adicionado ao carrinho!');
  setTimeout(() => { renderCartModal(); showModal('cart-modal'); }, 300);
}

function changeCartQty(index, delta){
  if(!cartItems[index]) return;
  const newQty = (cartItems[index].qty || 1) + delta;
  if(newQty < 1){ removeFromCart(index); return; }
  cartItems[index].qty = newQty;
  localStorage.setItem('quc_cart', JSON.stringify(cartItems));
  updateCartBadge();
  renderCartModal();
}

function renderCartModal(){
  const container = document.getElementById('cart-items-container');
  if(!container) return;
  if(cartItems.length === 0){
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Carrinho vazio</div>';
    document.getElementById('cart-total').textContent = 'R$0,00';
    return;
  }
  let total = 0;
  container.innerHTML = cartItems.map((item, i) => {
    const qty = item.qty || 1;
    const subtotal = Number(item.price || 0) * qty;
    total += subtotal;
    const bg = item.color_gradient ? 'linear-gradient(135deg,'+item.color_gradient+')' : (item.color_hex || '#ddd');
    return '<div class="cart-item">'
      + '<div class="cart-item-icon" style="background:'+bg+'"></div>'
      + '<div class="cart-item-info">'
        + '<div class="cart-item-name">'+escapeHtml(item.name||'')+'</div>'
        + (item.volume ? '<div class="cart-item-vol">'+escapeHtml(item.volume)+'</div>' : '')
        + '<div class="cart-qty-ctrl">'
          + '<button class="cart-qty-btn" onclick="changeCartQty('+i+',-1)">−</button>'
          + '<span class="cart-qty-num">'+qty+'</span>'
          + '<button class="cart-qty-btn" onclick="changeCartQty('+i+',1)">+</button>'
        + '</div>'
      + '</div>'
      + '<div class="cart-item-price">R$'+subtotal.toFixed(2).replace('.',',')+'</div>'
      + '<button class="cart-remove" onclick="removeFromCart('+i+')" aria-label="Remover">×</button>'
    + '</div>';
  }).join('');
  document.getElementById('cart-total').textContent = 'R$' + total.toFixed(2).replace('.',',');
}

function removeFromCart(index){
  cartItems.splice(index, 1);
  localStorage.setItem('quc_cart', JSON.stringify(cartItems));
  updateCartBadge();
  renderCartModal();
}

async function submitCartOrder(){
  if(cartItems.length === 0){ toast('Carrinho vazio!'); return; }
  const sb = getSupabase();
  if(!sb || !currentUser){ toast('Faca login primeiro'); return; }
  const btn = document.getElementById('cart-submit-btn');
  btn.textContent = 'Enviando...'; btn.disabled = true;
  try {
    const total = cartItems.reduce((sum, item) => sum + Number(item.price || 0) * (item.qty || 1), 0);
    const { error } = await sb.from('orders').insert({
      user_id: currentUser.id,
      items: cartItems,
      total: total,
      status: 'pending',
      created_at: new Date().toISOString()
    });
    if(error) throw error;
    toast('Solicitacao de compra enviada! A loja entrara em contato.');
    cartItems = [];
    localStorage.setItem('quc_cart', JSON.stringify(cartItems));
    updateCartBadge();
    closeModals();
  } catch(e){
    console.error('submitCartOrder error:', e);
    toast('Erro ao enviar pedido: ' + (e.message || 'tente novamente'));
  }
  btn.textContent = 'Enviar Solicitacao de Compra'; btn.disabled = false;
}

function getCategoryEmoji(cat){
  return cat === 'texturas' ? '🖌️' : cat === 'epoxi' ? '⚗️' : cat === 'acessorios' ? '🎭' : '🪣';
}

function renderProductCard(p){
  const bg = p.color_gradient ? 'linear-gradient(135deg,'+p.color_gradient+')' : (p.color_hex || '#ddd');
  const emoji = getCategoryEmoji(p.category);
  const badgeHtml = p.badge ? (p.badge === 'NOVO' ? '<span class="mkt-badge-new">NOVO</span>' : '<span class="mkt-badge-promo">'+p.badge+'</span>') : '';
  const stockClass = p.stock <= 5 ? 'low' : 'ok';
  const stockIcon = p.stock <= 5 ? '⚠️' : '✅';
  const priceFormatted = 'R$' + Number(p.price||0).toFixed(2).replace('.',',');
  return '<div class="mkt-card" onclick="openProductDetail(\''+p.id+'\')"><div class="mkt-swatch" style="background:'+bg+'">'+badgeHtml+emoji+'</div><div class="mkt-card-body"><div class="mkt-card-name">'+p.name+'</div><div class="mkt-card-code">'+(p.code||'')+'</div><div class="mkt-card-price">'+priceFormatted+'</div>'+(p.stock !== undefined ? '<div class="mkt-card-stock '+stockClass+'">'+stockIcon+' '+p.stock+' unid</div>' : '')+'<button class="mkt-card-add" onclick="event.stopPropagation();openProductDetail(\''+p.id+'\')">+ Carrinho</button></div></div>';
}

function renderProductRow(p){
  const bg = p.color_gradient ? 'linear-gradient(135deg,'+p.color_gradient+')' : (p.color_hex || '#e8e2d9');
  const emoji = getCategoryEmoji(p.category);
  const price = 'R$' + Number(p.price||0).toFixed(2).replace('.',',');
  const stk = (p.stock !== undefined && p.stock !== null) ? ' · ' + p.stock + ' un' : '';
  return '<div class="mkt-row" onclick="openProductDetail(\''+p.id+'\')">'
    + '<div class="mkt-row-ic" style="background:'+bg+'">'+emoji+'</div>'
    + '<div class="mkt-row-info"><div class="mkt-row-name">'+escapeHtml(p.name||'')+'</div>'
    + '<div class="mkt-row-sub">'+(p.code?('Cód '+escapeHtml(String(p.code))):'')+stk+'</div>'
    + '<div class="mkt-row-price">'+price+'</div></div>'
    + '<button class="mkt-row-add" onclick="event.stopPropagation();openProductDetail(\''+p.id+'\')">+ Carrinho</button>'
    + '</div>';
}

function mktSearch(q){
  q = (q||'').trim().toLowerCase();
  const cats = ['tintas','texturas','epoxi','acessorios'];
  const searchSec = document.getElementById('mkt-search-section');
  if(!q){
    if(searchSec) searchSec.style.display = 'none';
    let shown = false;
    document.querySelectorAll('.mkt-tab').forEach((tb,i) => {
      const el = document.getElementById('mkt-'+cats[i]);
      if(!el) return;
      const on = tb.classList.contains('active');
      el.style.display = on ? 'block' : 'none';
      if(on) shown = true;
    });
    if(!shown){ const el = document.getElementById('mkt-tintas'); if(el) el.style.display='block'; }
    return;
  }
  cats.forEach(t => { const el = document.getElementById('mkt-'+t); if(el) el.style.display='none'; });
  const res = (mktProducts||[]).filter(p =>
    (p.name||'').toLowerCase().includes(q) || String(p.code||'').toLowerCase().includes(q));
  const grid = document.getElementById('mkt-search-grid');
  const title = document.getElementById('mkt-search-title');
  if(title) title.textContent = res.length + ' resultado(s)';
  if(grid) grid.innerHTML = res.length
    ? res.slice(0,400).map(renderProductRow).join('')
    : '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Nenhum produto encontrado</div>';
  if(searchSec) searchSec.style.display = 'block';
}

function openProductDetail(productId){
  const p = mktProducts.find(x => x.id === productId);
  if(!p){ showModal('product-detail-modal'); return; }
  const bg = p.color_gradient ? 'linear-gradient(135deg,'+p.color_gradient+')' : (p.color_hex || '#ddd');
  const emoji = getCategoryEmoji(p.category);
  const modal = document.getElementById('product-detail-modal');
  const sheet = modal.querySelector('.sheet');
  const priceFormatted = 'R$' + Number(p.price||0).toFixed(2).replace('.',',');
  sheet.innerHTML = '<div class="sheet-handle"></div>'
    + '<div style="height:140px;background:'+bg+';border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:60px;margin-bottom:16px;">'+emoji+'</div>'
    + '<div style="font-size:20px;font-weight:800;font-family:Syne,sans-serif;">'+p.name+'</div>'
    + '<div style="font-size:12px;color:var(--muted);margin-top:2px;margin-bottom:10px;">'+(p.code ? 'Cód. '+p.code+' · ' : '')+(p.line||'')+'</div>'
    + (p.description ? '<div style="font-size:13.5px;color:#555;line-height:1.5;margin-bottom:14px;">'+p.description+'</div>' : '')
    + '<div style="display:flex;gap:10px;margin-bottom:14px;">'
    + (p.rendimento ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Rendimento</div><div style="font-size:14px;font-weight:700;">'+p.rendimento+'</div></div>' : '')
    + (p.demaos ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Demãos</div><div style="font-size:14px;font-weight:700;">'+p.demaos+'</div></div>' : '')
    + (p.secagem ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Secagem</div><div style="font-size:14px;font-weight:700;">'+p.secagem+'</div></div>' : '')
    + '</div>'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
      + '<div style="font-size:22px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">'+priceFormatted+'</div>'
      + '<div class="qty-picker">'
        + '<button class="qty-btn" onclick="var i=document.getElementById(\'detail-qty\');i.value=Math.max(1,+i.value-1);document.getElementById(\'detail-qty-total\').textContent=\'R$\'+(Math.max(1,+i.value)*'+Number(p.price||0)+').toFixed(2).replace(\'.\',\',\')">−</button>'
        + '<input id="detail-qty" type="number" min="1" value="1" class="qty-input" oninput="var v=Math.max(1,+this.value||1);this.value=v;document.getElementById(\'detail-qty-total\').textContent=\'R$\'+(v*'+Number(p.price||0)+').toFixed(2).replace(\'.\',\',\')">'
        + '<button class="qty-btn" onclick="var i=document.getElementById(\'detail-qty\');i.value=+i.value+1;document.getElementById(\'detail-qty-total\').textContent=\'R$\'+(+i.value*'+Number(p.price||0)+').toFixed(2).replace(\'.\',\',\')">+</button>'
      + '</div>'
    + '</div>'
    + '<button onclick="addToCart(\''+p.id+'\',+document.getElementById(\'detail-qty\').value);closeModals()" style="width:100%;padding:14px;background:var(--p1);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">+ Adicionar ao Carrinho · <span id="detail-qty-total">'+priceFormatted+'</span></button>';
  showModal('product-detail-modal');
}

async function loadMktProducts(){
  const sb = getSupabase();
  if(!sb) return;
  try {
    const { data, error } = await sb.from('products').select('*').eq('active', true).order('name');
    if(error) throw error;
    mktProducts = data || [];
    const cats = { tintas:[], texturas:[], epoxi:[], acessorios:[] };
    mktProducts.forEach(p => {
      const cat = p.category || 'tintas';
      if(!cats[cat]) cats[cat] = [];
      cats[cat].push(p);
    });
    Object.entries(cats).forEach(([cat, items]) => {
      const grid = document.getElementById('mkt-'+cat+'-grid');
      if(!grid) return;
      if(items.length === 0){
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted);font-size:13px;">Nenhum produto nesta categoria</div>';
      } else {
        grid.innerHTML = items.map(p => renderProductRow(p)).join('');
      }
    });
  } catch(e){
    console.error('loadMktProducts error:', e);
    const grid = document.getElementById('mkt-tintas-grid');
    if(grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted);font-size:13px;">Erro ao carregar produtos</div>';
  }
}

function changeQty(delta) {
  shirtQty = Math.max(1, shirtQty + delta);
  document.getElementById('shirt-qty').textContent = shirtQty;
  const base = 39.90;
  const disc = shirtQty >= 5 ? 0.85 : 1;
  document.getElementById('shirt-total').textContent = 'R$' + (base * shirtQty * disc).toFixed(2).replace('.',',');
}

function setSizeBtn(el) {
  document.querySelectorAll('.shirt-size-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function setShirtColor(el, color) {
  document.querySelectorAll('.shirt-color-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const body = document.getElementById('shirt-body');
  if (body) {
    body.setAttribute('fill', color);
    const isDark = ['#1a1a2e','#000','#8338ec','#e63946'].includes(color);
    const placeholder = document.getElementById('shirt-chest-placeholder');
    if (placeholder) placeholder.style.color = isDark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.45)';
    if (placeholder) placeholder.style.borderColor = isDark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)';
  }
}

function openShirtZoom() {
  const overlay = document.getElementById('shirt-zoom-overlay');
  const inner = document.getElementById('shirt-zoom-inner');
  const mockup = document.getElementById('shirt-mockup');
  if (!overlay || !inner || !mockup) return;
  const clone = mockup.cloneNode(true);
  inner.querySelectorAll('.shirt-mockup-clone').forEach(n => n.remove());
  clone.classList.add('shirt-mockup-clone');
  inner.appendChild(clone);
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeShirtZoom() {
  const overlay = document.getElementById('shirt-zoom-overlay');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

function setShirtStyle(style) {
  const pc = document.getElementById('shirt-logo-pintor-chip');
  const cc = document.getElementById('shirt-logo-cali-chip');
  document.querySelectorAll('.shirt-preview').forEach(p => p.classList.remove('active'));
  const active = document.getElementById('style-' + style);
  if(active) active.classList.add('active');
  if(style === 'logo-pintor') { pc.style.display='block'; cc.style.display='none'; toast('Seu logo destacado!'); }
  else if(style === 'logo-cali') { pc.style.display='none'; cc.style.display='block'; toast('Logo Cali Colors destacado!'); }
  else { pc.style.display='block'; cc.style.display='block'; toast('Ambos os logos!'); }
}

// ══ AI LOGO GENERATOR ══
const _aiLogoPalettes = [
  ['#ff6b35','#1a1a2e','#fff5f0'],
  ['#2ec4b6','#1a1a2e','#e8f8f6'],
  ['#8338ec','#fff','#f3ecff'],
  ['#e63946','#1d3557','#f1faee'],
  ['#0077b6','#fff','#caf0f8'],
  ['#06a77d','#1a1a2e','#e8f5e9']
];
const _aiLogoIcons = [
  // paint roller
  '<g><rect x="14" y="10" width="36" height="10" rx="2" fill="{c1}"/><rect x="28" y="20" width="8" height="6" fill="{c2}"/><rect x="24" y="26" width="16" height="22" rx="2" fill="{c1}"/><rect x="28" y="48" width="8" height="6" fill="{c2}"/></g>',
  // paint brush
  '<g><rect x="10" y="44" width="30" height="6" rx="2" fill="{c2}" transform="rotate(-30 25 47)"/><path d="M40 18 L52 30 L46 36 L34 24 Z" fill="{c1}"/><path d="M34 24 L40 18 L36 14 L30 20 Z" fill="{c2}"/></g>',
  // paint bucket
  '<g><path d="M18 22 L46 22 L42 52 L22 52 Z" fill="{c1}"/><ellipse cx="32" cy="22" rx="14" ry="3" fill="{c2}"/><path d="M22 18 Q32 8 42 18" stroke="{c2}" stroke-width="2" fill="none"/><rect x="28" y="30" width="8" height="14" fill="{c2}" opacity=".4"/></g>',
  // color palette
  '<g><path d="M32 12 C46 12 54 20 54 32 C54 38 50 42 44 42 L40 42 C36 42 34 44 34 48 C34 52 30 54 26 54 C18 54 12 46 12 36 C12 22 20 12 32 12 Z" fill="{c1}"/><circle cx="22" cy="24" r="3" fill="{c2}"/><circle cx="32" cy="20" r="3" fill="{c3}"/><circle cx="42" cy="24" r="3" fill="{c2}"/><circle cx="46" cy="34" r="3" fill="{c3}"/></g>',
  // wall + roller stripe
  '<g><rect x="8" y="14" width="48" height="36" rx="3" fill="{c3}"/><rect x="8" y="14" width="48" height="12" fill="{c1}"/><rect x="38" y="8" width="6" height="22" rx="1" fill="{c2}"/></g>',
  // drop / paint splash
  '<g><path d="M32 10 C40 22 46 30 46 38 C46 46 40 52 32 52 C24 52 18 46 18 38 C18 30 24 22 32 10 Z" fill="{c1}"/><circle cx="26" cy="38" r="3" fill="{c3}" opacity=".7"/></g>'
];

function _hashStr(s){
  let h = 0;
  for(let i=0;i<s.length;i++){ h = ((h<<5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

function _renderAiLogoSvg(name, paletteIdx, iconIdx){
  const palette = _aiLogoPalettes[paletteIdx % _aiLogoPalettes.length];
  const [c1,c2,c3] = palette;
  const icon = _aiLogoIcons[iconIdx % _aiLogoIcons.length]
    .replaceAll('{c1}', c1).replaceAll('{c2}', c2).replaceAll('{c3}', c3);
  const initials = name.split(/\s+/).map(w=>w[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'P';
  return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">'
    + '<rect width="64" height="64" rx="12" fill="'+c3+'"/>'
    + icon
    + '<text x="32" y="60" text-anchor="middle" font-family="Syne,sans-serif" font-weight="800" font-size="7" fill="'+c1+'">'+escapeHtml(initials)+'</text>'
    + '</svg>';
}

let _aiLogoSelected = null;
let _aiLogoLastName = '';

let _aiLogoUrls = null;

const AI_LOGO_REGEN_PRICE_BRL = 1.99;
const _aiLogoFmtBRL = v => 'R$ ' + v.toFixed(2).replace('.', ',');

function _aiLogoGenCount(){ return parseInt(localStorage.getItem('ai_logo_gen_count') || '0', 10); }
function _aiLogoBumpCount(){
  const n = _aiLogoGenCount() + 1;
  localStorage.setItem('ai_logo_gen_count', String(n));
  return n;
}

function _aiLogoUpdateBtn(){
  const btn = document.getElementById('ai-logo-btn');
  if (!btn) return;
  btn.textContent = _aiLogoGenCount() === 0
    ? 'Gerar Logo (grátis)'
    : 'Gerar novamente · ' + _aiLogoFmtBRL(AI_LOGO_REGEN_PRICE_BRL);
}

async function gerarLogoIA(){
  const input = document.getElementById('ai-logo-name');
  const styleInput = document.getElementById('ai-logo-style');
  const name = (input.value || '').trim();
  const style = (styleInput?.value || '').trim();
  if(!name){ toast('Digite o texto do logo'); return; }

  if (_aiLogoGenCount() >= 1) {
    const ok = confirm(
      'Gerar mais 3 opções de logo custa ' + _aiLogoFmtBRL(AI_LOGO_REGEN_PRICE_BRL) + '.\n\n'
      + 'Esse valor cobre o custo da IA + processamento.\n\n'
      + 'Deseja prosseguir?'
    );
    if (!ok) return;
    toast(_aiLogoFmtBRL(AI_LOGO_REGEN_PRICE_BRL) + ' debitado · gerando...');
  }

  const btn = document.getElementById('ai-logo-btn');
  btn.disabled = true;
  btn.textContent = 'Gerando com IA...';

  let urls = null;
  let aiError = null;
  try {
    const r = await fetch('/api/generate-logo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, style })
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(data.urls) && data.urls.length) {
      urls = data.urls;
    } else {
      aiError = data.error || ('HTTP ' + r.status);
    }
  } catch(e) {
    aiError = String(e?.message || e);
  }

  const grid = document.getElementById('ai-logo-grid');
  if (urls) {
    grid.innerHTML = urls.map((u,i) =>
      '<div class="shirt-ai-logo-card'+(i===0?' selected':'')+'" data-idx="'+i+'" data-url="'+escapeHtml(u)+'" onclick="selectAiLogo(this)">'
      + '<img src="'+escapeHtml(u)+'" alt="logo" loading="lazy" style="width:100%;height:80px;object-fit:contain;background:#fff;border-radius:6px;display:block;margin-bottom:4px;">'
      + '<div class="shirt-ai-logo-name">'+escapeHtml(name)+'</div>'
      + '</div>'
    ).join('');
    _aiLogoUrls = urls;
    toast('3 logos gerados com IA ✨');
  } else {
    console.warn('AI logo fallback:', aiError);
    const seed = _hashStr(name.toLowerCase());
    const opts = [
      { pi: seed % _aiLogoPalettes.length, ii: seed % _aiLogoIcons.length },
      { pi: (seed + 2) % _aiLogoPalettes.length, ii: (seed + 1) % _aiLogoIcons.length },
      { pi: (seed + 4) % _aiLogoPalettes.length, ii: (seed + 3) % _aiLogoIcons.length }
    ];
    grid.innerHTML = opts.map((o,i) =>
      '<div class="shirt-ai-logo-card'+(i===0?' selected':'')+'" data-idx="'+i+'" onclick="selectAiLogo(this)">'
      + _renderAiLogoSvg(name, o.pi, o.ii)
      + '<div class="shirt-ai-logo-name">'+escapeHtml(name)+'</div>'
      + '</div>'
    ).join('');
    _aiLogoUrls = null;
    toast('Logos prontos (modo offline)');
  }

  document.getElementById('ai-logo-result').classList.add('show');
  _aiLogoSelected = 0;
  _aiLogoLastName = name;
  _applyLogoToShirt();
  _aiLogoBumpCount();
  btn.disabled = false;
  _aiLogoUpdateBtn();
}

function _aiLogoCurrentSrc(){
  const card = document.querySelectorAll('.shirt-ai-logo-card')[_aiLogoSelected];
  if (_aiLogoUrls && _aiLogoUrls[_aiLogoSelected]) return _aiLogoUrls[_aiLogoSelected];
  if (card) {
    const svg = card.querySelector('svg');
    if (svg) return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.outerHTML);
  }
  return null;
}

function _applyLogoToShirt(){
  const logoSrc = _aiLogoCurrentSrc();
  if (!logoSrc || !_aiLogoLastName) return;
  const chestLogo = document.getElementById('shirt-chest-logo');
  const placeholder = document.getElementById('shirt-chest-placeholder');
  if (chestLogo) {
    chestLogo.src = logoSrc;
    chestLogo.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  }
  const chip = document.getElementById('shirt-logo-pintor-chip');
  if (chip) {
    chip.innerHTML = '<img src="'+escapeHtml(logoSrc)+'" alt="logo" style="height:18px;vertical-align:middle;margin-right:6px;border-radius:3px;background:#fff;">' + escapeHtml(_aiLogoLastName);
    chip.style.display = 'block';
  }
  logoState.pintor = true;
  const btn = document.getElementById('toggle-pintor');
  if(btn) btn.classList.add('active');
}

function selectAiLogo(el){
  document.querySelectorAll('.shirt-ai-logo-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  _aiLogoSelected = parseInt(el.dataset.idx) || 0;
  _applyLogoToShirt();
}

function usarLogoIA(){
  if(_aiLogoSelected === null || !_aiLogoLastName){ toast('Gere um logo primeiro'); return; }
  _applyLogoToShirt();
  toast('Logo aplicado na camiseta! 👕');
}

function _applyOwnLogoToShirt(url, label){
  const chestLogo = document.getElementById('shirt-chest-logo');
  const placeholder = document.getElementById('shirt-chest-placeholder');
  if (chestLogo) {
    chestLogo.src = url;
    chestLogo.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  }
  const chip = document.getElementById('shirt-logo-pintor-chip');
  if (chip) {
    chip.innerHTML = '<img src="'+escapeHtml(url)+'" alt="logo" style="height:18px;vertical-align:middle;margin-right:6px;border-radius:3px;background:#fff;">' + escapeHtml(label || 'Seu logo');
    chip.style.display = 'block';
  }
  logoState.pintor = true;
}

async function uploadBusinessLogo(ev){
  const file = ev?.target?.files?.[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('Selecione um arquivo de imagem'); return; }
  if(file.size > 5 * 1024 * 1024){ toast('Imagem muito grande (máx 5MB)'); return; }

  const btn = document.getElementById('business-logo-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Enviando...'; }

  let publicUrl = null;
  const sb = getSupabase();
  if (sb && currentUser) {
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = currentUser.id + '/business_logo.' + ext;
      const { error: upErr } = await sb.storage.from('posts').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
      publicUrl = urlData?.publicUrl ? urlData.publicUrl + '?t=' + Date.now() : null;
      if (publicUrl) {
        const { error: profErr } = await sb.from('profiles').update({ business_logo_url: publicUrl }).eq('id', currentUser.id);
        if (profErr) console.warn('profile update business_logo_url:', profErr.message);
      }
    } catch(e){
      console.warn('Storage upload failed, falling back to local:', e?.message || e);
    }
  } else {
    console.warn('Sem sessão; usando preview local apenas');
  }

  if (!publicUrl) {
    publicUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(file);
    });
  }

  try { localStorage.setItem('business_logo_url', publicUrl); } catch(e){}

  _applyOwnLogoToShirt(publicUrl, document.getElementById('ai-logo-name')?.value?.trim() || 'Seu logo');

  if(btn){ btn.disabled = false; btn.textContent = '📤 Trocar meu logo'; }
  ev.target.value = '';
  toast('Logo enviado e aplicado! ✅');
}

async function loadBusinessLogo(){
  let url = null;
  const sb = getSupabase();
  if (sb && currentUser) {
    try {
      const { data: prof } = await sb.from('profiles').select('business_logo_url, business_name').eq('id', currentUser.id).single();
      if (prof?.business_logo_url) url = prof.business_logo_url;
    } catch(e){}
  }
  if (!url) {
    try { url = localStorage.getItem('business_logo_url'); } catch(e){}
  }
  if (url) {
    _applyOwnLogoToShirt(url, null);
    const btn = document.getElementById('business-logo-btn');
    if(btn) btn.textContent = '📤 Trocar meu logo';
  }
}

function toggleLogo(which) {
  logoState[which] = !logoState[which];
  const btn = document.getElementById('toggle-' + which);
  const chip = document.getElementById('shirt-logo-' + which + '-chip');
  btn.classList.toggle('active', logoState[which]);
  if(chip) chip.style.display = logoState[which] ? 'block' : 'none';
  if (which === 'pintor') {
    const chestLogo = document.getElementById('shirt-chest-logo');
    const placeholder = document.getElementById('shirt-chest-placeholder');
    if (chestLogo && chestLogo.src) {
      chestLogo.style.display = logoState.pintor ? 'block' : 'none';
      if (placeholder) placeholder.style.display = 'none';
    } else if (placeholder) {
      placeholder.style.display = logoState.pintor ? 'flex' : 'none';
    }
  }
}

function buyShirt() {
  addToCart();
  toast('👕 Camiseta adicionada! Finalize no carrinho.');
}

// ══ MODE TOGGLE (PINTOR / CLIENTE) ══
let currentMode='pintor';


// ══ TYPING ANIMATION CSS ══
const styleTag=document.createElement('style');
styleTag.textContent='@keyframes typing{0%,80%,100%{transform:scale(0.6);opacity:.4;}40%{transform:scale(1);opacity:1;}}';
document.head.appendChild(styleTag);

// ══════════════════════════════
//  CHANGE 1: DYNAMIC FEED
// ══════════════════════════════
let currentPostType = 'post';
function setPostType(type){
  currentPostType = type;
  const storyBtn = document.getElementById('post-type-story');
  const postBtn = document.getElementById('post-type-post');
  if(type === 'story'){
    storyBtn.style.background = 'var(--ink)'; storyBtn.style.color = '#fff';
    postBtn.style.background = 'var(--white)'; postBtn.style.color = 'var(--ink)';
  } else {
    postBtn.style.background = 'var(--ink)'; postBtn.style.color = '#fff';
    storyBtn.style.background = 'var(--white)'; storyBtn.style.color = 'var(--ink)';
  }
  // Show sale fields for grafiteiro on post type
  const saleFields = document.getElementById('post-sale-fields');
  if(saleFields) saleFields.style.display = (type==='post' && currentMode==='grafiteiro') ? 'block' : 'none';
}

function openPortfolioComposer(){
  // Abre o compositor já em modo "Post" (foto/vídeo + texto embaixo).
  // Story/Reel ficam a um toque pelo seletor do próprio modal.
  setPostType('post');
  showModal('post-modal');
}

function previewPublicProfile(){
  if(!currentUser){ toast('Faça login'); return; }
  openUserProfile(currentUser.id, true);
}

// ══ FORMAÇÃO (qualifications) ══
function openManageQuals(){
  if(!currentUser){ toast('Faça login'); return; }
  showModal('manage-quals-modal');
  loadQualsList();
}

async function loadQualsList(){
  const box = document.getElementById('quals-list');
  const sb = getSupabase();
  if(!box || !sb || !currentUser) return;
  try {
    const { data } = await sb.from('qualifications').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
    if(!data || !data.length){ box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Nenhuma formação cadastrada.</div>'; return; }
    box.innerHTML = data.map(q => `<div style="display:flex;align-items:center;gap:10px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;">
      <span style="font-size:20px;">${escapeHtml(q.icon||'🎓')}</span>
      <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${escapeHtml(q.title)}</div><div style="font-size:11px;color:var(--muted);">${escapeHtml(q.org||'')}${q.year?' · '+escapeHtml(q.year):''}</div></div>
      <button onclick="deleteQualification('${q.id}',this)" style="background:none;border:none;color:#e63946;font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>
    </div>`).join('');
  } catch(e){ console.warn('loadQualsList:', e); box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Erro ao carregar.</div>'; }
}

async function addQualification(btn){
  const title = document.getElementById('q-title').value.trim();
  if(!title){ toast('Informe o título'); return; }
  const sb = getSupabase();
  if(!sb || !currentUser){ toast('Faça login'); return; }
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    const { error } = await sb.from('qualifications').insert({
      user_id: currentUser.id,
      title,
      org: document.getElementById('q-org').value.trim() || null,
      year: document.getElementById('q-year').value.trim() || null,
      icon: document.getElementById('q-icon').value.trim() || '🎓'
    });
    if(error) throw error;
    document.getElementById('q-title').value = '';
    document.getElementById('q-org').value = '';
    document.getElementById('q-year').value = '';
    document.getElementById('q-icon').value = '🎓';
    toast('Formação adicionada');
    loadQualsList();
  } catch(e){ console.error('addQualification:', e); toast('Erro: ' + (e.message||'falha')); }
  btn.disabled = false; btn.textContent = 'Adicionar';
}

async function deleteQualification(id, el){
  const sb = getSupabase();
  if(!sb) return;
  try {
    const { error } = await sb.from('qualifications').delete().eq('id', id);
    if(error) throw error;
    const card = el.closest('div'); if(card) card.remove();
    toast('Removido');
  } catch(e){ console.error('deleteQualification:', e); toast('Erro ao remover'); }
}

// ══ CURSOS (courses) ══
function openManageCourses(){
  if(!currentUser){ toast('Faça login'); return; }
  showModal('manage-courses-modal');
  loadCoursesList();
}

async function loadCoursesList(){
  const box = document.getElementById('courses-list');
  const sb = getSupabase();
  if(!box || !sb || !currentUser) return;
  try {
    const { data } = await sb.from('courses').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
    if(!data || !data.length){ box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Nenhum curso cadastrado.</div>'; return; }
    box.innerHTML = data.map(c => `<div style="display:flex;align-items:center;gap:10px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;">
      ${c.cover_url?`<img src="${escapeHtml(c.cover_url)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">`:'<span style="font-size:24px;">📚</span>'}
      <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${escapeHtml(c.title)}</div><div style="font-size:11px;color:var(--muted);">${c.is_free?'Grátis':('R$'+Number(c.price||0).toFixed(2).replace('.',','))}${c.duration?' · '+escapeHtml(c.duration):''}</div></div>
      <button onclick="deleteCourse('${c.id}',this)" style="background:none;border:none;color:#e63946;font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>
    </div>`).join('');
  } catch(e){ console.warn('loadCoursesList:', e); box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Erro ao carregar.</div>'; }
}

async function addCourse(btn){
  const title = document.getElementById('c-title').value.trim();
  if(!title){ toast('Informe o título'); return; }
  const sb = getSupabase();
  if(!sb || !currentUser){ toast('Faça login'); return; }
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    const isFree = document.getElementById('c-free').checked;
    const { error } = await sb.from('courses').insert({
      user_id: currentUser.id,
      title,
      subtitle: document.getElementById('c-sub').value.trim() || null,
      cover_url: document.getElementById('c-cover').value.trim() || null,
      link: document.getElementById('c-link').value.trim() || null,
      duration: document.getElementById('c-duration').value.trim() || null,
      is_free: isFree,
      price: isFree ? null : (parseFloat(document.getElementById('c-price').value) || null)
    });
    if(error) throw error;
    ['c-title','c-sub','c-cover','c-link','c-duration','c-price'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('c-free').checked = false;
    toast('Curso adicionado');
    loadCoursesList();
  } catch(e){ console.error('addCourse:', e); toast('Erro: ' + (e.message||'falha')); }
  btn.disabled = false; btn.textContent = 'Adicionar curso';
}

async function deleteCourse(id, el){
  const sb = getSupabase();
  if(!sb) return;
  try {
    const { error } = await sb.from('courses').delete().eq('id', id);
    if(error) throw error;
    const card = el.closest('div'); if(card) card.remove();
    toast('Removido');
  } catch(e){ console.error('deleteCourse:', e); toast('Erro ao remover'); }
}

let _lastFeedLoad = 0;
let _feedRoleFilter = '';

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
const POST_COLS = 'id, user_id, caption, media_url, media_type, status, for_sale, price, art_type, created_at';
let _feedLimit = 30;
const FEED_PAGE = 30;

async function loadFeed(){
  _lastFeedLoad = Date.now();
  // Show cached feed instantly while fetching fresh data
  const cachedHtml = localStorage.getItem('feedCache');
  const cachedStories = localStorage.getItem('storiesCache');
  const container = document.getElementById('feed-posts-area');
  const row = document.getElementById('stories-row');
  if(cachedHtml && container && container.querySelector('.skel-post')) container.innerHTML = cachedHtml;
  if(cachedStories && row) row.innerHTML = cachedStories;
  // Fetch followingIds once, share with both
  const feedIds = await getFollowingIds();
  await Promise.all([loadStories(feedIds), loadPosts(feedIds)]);
  // Save to cache for next load
  try {
    if(container) localStorage.setItem('feedCache', container.innerHTML);
    if(row) localStorage.setItem('storiesCache', row.innerHTML);
  } catch(e){}
}

let _followingIdsCache = null;
let _followingIdsCacheTime = 0;
async function getFollowingIds(){
  if(_followingIdsCache && Date.now() - _followingIdsCacheTime < 10000) return _followingIdsCache;
  const sb = getSupabase();
  if(!sb || !currentUser) return [];
  try {
    const { data } = await sb.from('follows').select('following_id').eq('follower_id', currentUser.id);
    const ids = (data || []).map(f => f.following_id);
    ids.push(currentUser.id);
    _followingIdsCache = ids;
    _followingIdsCacheTime = Date.now();
    return ids;
  } catch(e) {
    console.warn('getFollowingIds error:', e);
    return [currentUser.id];
  }
}

async function loadPosts(feedIds){
  try {
    const sb = getSupabase();
    if(!sb) return;
    if(!feedIds) feedIds = await getFollowingIds();
    // Build query - if user has following list, filter by it; otherwise show all recent posts
    let query = sb.from('posts').select(POST_COLS).neq('media_type', 'story');
    // Only show approved posts (or posts without status for backwards compat)
    query = query.or('status.eq.approved,status.is.null');
    if(feedIds.length > 0) query = query.in('user_id', feedIds);
    query = query.order('created_at', { ascending: false }).limit(_feedLimit);
    let { data: posts, error } = await query;
    if(error){
      console.warn('loadPosts error:', error.message);
      posts = [];
    }
    const container = document.getElementById('feed-posts-area');
    const emptyEl = document.getElementById('feed-empty');
    if(!posts || posts.length === 0){
      container.innerHTML = '';
      if(emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if(emptyEl) emptyEl.style.display = 'none';

    // Load profiles, likes, comments, saved_posts ALL in parallel
    const userIds = [...new Set(posts.map(p => p.user_id))];
    const postIds = posts.map(p => p.id);
    let myLikes = [];
    let likeCounts = {};
    let savedPosts = [];
    let commentsMap = {};
    const queries = [
      sb.from('profiles').select('id, name, tag, avatar_url, role, user_type').in('id', userIds),
      sb.from('comments').select('id, post_id, user_id, text, created_at').in('post_id', postIds).order('created_at', { ascending: true })
    ];
    if(currentUser){
      queries.push(sb.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds));
      queries.push(sb.from('likes').select('post_id').in('post_id', postIds));
      queries.push(sb.from('saved_posts').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds));
    }
    const results = await Promise.all(queries);
    const profMap = {};
    (results[0].data||[]).forEach(pr => { profMap[pr.id] = pr; });
    posts.forEach(p => { p.profiles = profMap[p.user_id] || {}; });
    // Map comments by post_id
    (results[1].data||[]).forEach(c => {
      if(!commentsMap[c.post_id]) commentsMap[c.post_id] = [];
      commentsMap[c.post_id].push(c);
    });
    // Collect all comment user_ids to resolve names
    const commentUserIds = [...new Set((results[1].data||[]).map(c => c.user_id).filter(id => !profMap[id]))];
    if(commentUserIds.length > 0){
      const { data: cProfs } = await sb.from('profiles').select('id, name, tag, avatar_url').in('id', commentUserIds);
      (cProfs||[]).forEach(pr => { profMap[pr.id] = pr; });
    }
    if(currentUser){
      if(results[2].data) myLikes = results[2].data.map(l => l.post_id);
      if(results[3].data) results[3].data.forEach(l => { likeCounts[l.post_id] = (likeCounts[l.post_id]||0)+1; });
      if(results[4].data) savedPosts = results[4].data.map(s => s.post_id);
    }

    let html = '';
    posts.forEach(p => {
      const prof = p.profiles || {};
      let name = prof.name || 'Usuario';
      if(name.includes('@')) name = name.split('@')[0];
      const tag = prof.tag ? '@' + prof.tag : '';
      const avatar = prof.avatar_url || 'https://ui-avatars.com/api/?name='+encodeURIComponent(name)+'&background=e8e2d9&color=1a1a2e&size=96';
      const time = getTimeAgo(p.created_at);
      const caption = p.caption || '';
      const liked = myLikes.includes(p.id);
      const saved = savedPosts.includes(p.id);
      const isVideo = p.media_url && (p.media_url.includes('.mp4') || p.media_url.includes('.webm') || p.media_url.includes('.mov') || p.media_type === 'video');
      const imgHtml = p.media_url ? (isVideo ? '<video src="'+p.media_url+'" controls playsinline preload="metadata" style="width:100%;display:block;object-fit:cover;max-height:500px;"></video>' : '<img src="'+p.media_url+'" alt="" loading="lazy" style="width:100%;display:block;object-fit:cover;">') : '';
      const likeCount = likeCounts[p.id] || 0;
      const brushFill = liked ? 'var(--p4)' : 'none';
      const brushStroke = liked ? 'var(--p4)' : 'var(--ink)';
      const paletteFill = saved ? 'var(--p1)' : 'none';
      const paletteStroke = saved ? 'var(--p1)' : 'var(--ink)';

      html += '<div class="mpost" data-post-id="'+p.id+'" data-author-role="'+(prof.role||'')+'">';
      html += '<div class="mpost-head">';
      html += '<div class="av-ring"><div class="av-inner"><img src="'+avatar+'" alt=""></div></div>';
      html += '<div class="post-meta"><span class="post-uname">'+escapeHtml(name)+'</span>';
      if(tag) html += ' <span class="post-city">'+escapeHtml(tag)+'</span>';
      html += '</div>';
      html += '<span class="post-dots" onclick="event.stopPropagation();openPostOpts(\''+p.id+'\',\''+p.user_id+'\')">···</span>';
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
      html += '<button class="act-btn" onclick="sharePost(\''+p.id+'\')">'
        +'<svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>'
        +'<span class="act-label">Compartilhar</span>'
        +'</button>';
      // Orçamento (qualquer post que não seja o seu próprio)
      if(!currentUser || p.user_id !== currentUser.id){
        html += '<button class="act-btn" onclick="abrirOrcamentoChat(\''+p.user_id+'\',\''+escapeHtml(name)+'\')">'
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
          let cName = cp.name || 'Usuario';
          if(cName.includes('@')) cName = cName.split('@')[0];
          const canDelete = currentUser && (currentUser.id === c.user_id || currentUser.id === p.user_id);
          const delBtn = canDelete ? ' <span onclick="deleteComment(this,\''+c.id+'\')" style="cursor:pointer;color:var(--muted);font-size:16px;padding:2px 4px;" title="Apagar">&times;</span>' : '';
          html += '<div data-comment-id="'+c.id+'" style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink);margin-bottom:4px;">';
          html += '<span style="flex:1"><b>'+escapeHtml(cName)+'</b> '+escapeHtml(c.text)+'</span>'+delBtn;
          html += '</div>';
        });
        html += '</div>';
      }
      html += '<div class="post-time">'+time+'</div>';
      // Buy button for art/sale posts
      if(p.for_sale && p.price > 0 && currentUser && p.user_id !== currentUser.id){
        html += '<div style="padding:6px 14px 4px;display:flex;gap:8px;">';
        html += '<button onclick="comprarObra(\''+p.id+'\',\''+escapeHtml(name)+'\','+p.price+',\''+escapeHtml(p.art_type||'Obra')+'\')" style="flex:1;padding:10px;background:linear-gradient(135deg,#8338ec,var(--p1));color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">🛒 Comprar · R$ '+p.price.toLocaleString('pt-BR')+'</button>';
        html += '<button onclick="openChatWithUser(\''+p.user_id+'\')" style="padding:10px 14px;background:var(--white);color:var(--ink);border:1.5px solid var(--border);border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">💬</button>';
        html += '</div>';
      }
      html += '</div>';
    });
    if(posts.length >= _feedLimit){
      html += '<div style="text-align:center;padding:16px 0 28px;"><button id="feed-more-btn" onclick="loadMoreFeed(this)" style="background:none;border:1.5px solid var(--border);border-radius:20px;padding:10px 24px;font-size:13px;font-weight:700;color:var(--ink);cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ver mais publicações</button></div>';
    }
    container.innerHTML = html;
  } catch(e){
    console.error('loadPosts error:', e);
  }
}

function loadMoreFeed(btn){
  if(btn){ btn.textContent = 'Carregando...'; btn.disabled = true; }
  _feedLimit += FEED_PAGE;
  loadFeed();
}

function stripEmail(s){
  if(!s) return s;
  return String(s).replace(/([A-Za-z0-9._%+\-]+)@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '@$1');
}
function cleanHandle(p, fb){
  if(p && p.tag) return '@' + p.tag;
  return stripEmail((p && p.name) || fb || 'Usuario');
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

async function togglePostLike(btn){
  const svg = btn.querySelector('svg');
  const postEl = btn.closest('.mpost');
  const postId = postEl ? postEl.dataset.postId : null;
  const isLiked = svg.style.fill === 'var(--p4)';

  // Toggle UI immediately
  if(isLiked){
    svg.style.fill = 'none';
    svg.style.stroke = 'var(--ink)';
  } else {
    svg.style.fill = 'var(--p4)';
    svg.style.stroke = 'var(--p4)';
  }

  // Update like count in label
  const labelEl = btn.querySelector('.act-label');
  const currentLabel = labelEl ? labelEl.textContent : 'Curtir';
  const countMatch = currentLabel.match(/(\d+)/);
  let currentCount = countMatch ? parseInt(countMatch[1]) : 0;
  currentCount += isLiked ? -1 : 1;
  if(currentCount < 0) currentCount = 0;
  if(labelEl) labelEl.textContent = currentCount > 0 ? 'Curtir · '+currentCount : 'Curtir';
  // Update text below actions
  const likeTextEl = postEl ? postEl.querySelector('div[style*="padding:0 14px 2px"]') : null;
  if(likeTextEl){
    if(currentCount > 0) likeTextEl.textContent = currentCount + ' curtida' + (currentCount>1?'s':'');
    else likeTextEl.style.display = 'none';
  }

  // Save to DB
  if(!postId) return;
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  try {
    if(isLiked){
      await sb.from('likes').delete().eq('user_id', currentUser.id).eq('post_id', postId);
    } else {
      await sb.from('likes').insert({ user_id: currentUser.id, post_id: postId });
    }
  } catch(e){ console.warn('togglePostLike error:', e); }
}

function toggleCommentInput(btn){
  const postEl = btn.closest('.mpost');
  if(!postEl) return;
  let box = postEl.querySelector('.comment-input-box');
  if(box){ box.style.display = box.style.display === 'none' ? 'flex' : 'none'; box.querySelector('input')?.focus(); return; }
  box = document.createElement('div');
  box.className = 'comment-input-box';
  box.style.cssText = 'display:flex;padding:8px 14px 10px;gap:8px;align-items:center;border-top:1px solid var(--border);';
  box.innerHTML = '<input type="text" placeholder="Adicionar comentario..." style="flex:1;border:1px solid var(--border);border-radius:20px;padding:8px 14px;font-size:13px;font-family:DM Sans,sans-serif;outline:none;background:var(--cream);">'
    + '<button onclick="submitComment(this)" style="background:var(--p1);color:#fff;border:none;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Enviar</button>';
  const timeEl = postEl.querySelector('.post-time');
  if(timeEl) postEl.insertBefore(box, timeEl);
  else postEl.appendChild(box);
  box.querySelector('input').focus();
  box.querySelector('input').addEventListener('keydown', function(e){ if(e.key==='Enter') submitComment(box.querySelector('button')); });
}

async function submitComment(btn){
  const box = btn.closest('.comment-input-box');
  const input = box.querySelector('input');
  const text = input.value.trim();
  if(!text) return;
  const postEl = box.closest('.mpost');
  const postId = postEl ? postEl.dataset.postId : null;
  if(!postId || !currentUser) return;
  input.value = '';
  btn.disabled = true;
  const sb = getSupabase();
  if(!sb) return;
  try {
    const mod = await moderateContentAsync(text, null);
    if (!mod.approved) {
      input.value = text;  // devolve o texto
      btn.disabled = false;
      toast(mod.severity === 'hard' ? 'Comentário bloqueado pela moderação' : 'Comentário enviado para revisão');
      return;
    }
    const { data: comment, error } = await sb.from('comments').insert({ post_id: postId, user_id: currentUser.id, text: text }).select('id').single();
    if(error){ toast('Erro ao comentar'); btn.disabled = false; return; }
    // Show comment in UI
    let commentsArea = postEl.querySelector('.comments-area');
    if(!commentsArea){
      commentsArea = document.createElement('div');
      commentsArea.className = 'comments-area';
      commentsArea.style.cssText = 'padding:4px 14px 2px;';
      postEl.insertBefore(commentsArea, box);
    }
    const userName = document.getElementById('myprofile-name')?.textContent || 'Voce';
    const commentDiv = document.createElement('div');
    commentDiv.setAttribute('data-comment-id', comment.id);
    commentDiv.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink);margin-bottom:4px;';
    commentDiv.innerHTML = '<span style="flex:1"><b>'+escapeHtml(userName)+'</b> '+escapeHtml(text)+'</span>'
      + '<span onclick="deleteComment(this,\''+comment.id+'\')" style="cursor:pointer;color:var(--muted);font-size:16px;padding:2px 4px;" title="Apagar">&times;</span>';
    commentsArea.appendChild(commentDiv);
  } catch(e){ toast('Erro ao comentar'); console.warn(e); }
  btn.disabled = false;
}

async function deleteComment(el, commentId){
  if(!currentUser) return;
  const sb = getSupabase();
  if(!sb) return;
  const commentEl = el.closest('[data-comment-id]');
  try {
    const { error } = await sb.from('comments').delete().eq('id', commentId);
    if(error){ toast('Erro ao apagar'); return; }
    if(commentEl) commentEl.remove();
  } catch(e){ toast('Erro ao apagar'); console.warn(e); }
}

async function toggleSavePost(btn){
  const svg = btn.querySelector('svg');
  const postEl = btn.closest('.mpost');
  const postId = postEl ? postEl.dataset.postId : null;
  if(!postId || !currentUser) return;
  const sb = getSupabase();
  if(!sb) return;
  const isSaved = svg.style.fill === 'var(--p1)';
  // Toggle UI immediately
  if(isSaved){
    svg.style.fill = 'none';
    svg.style.stroke = 'var(--ink)';
    toast('Removido dos salvos');
  } else {
    svg.style.fill = 'var(--p1)';
    svg.style.stroke = 'var(--p1)';
    toast('Salvo!');
  }
  // Save to DB
  try {
    if(isSaved){
      await sb.from('saved_posts').delete().eq('user_id', currentUser.id).eq('post_id', postId);
    } else {
      await sb.from('saved_posts').insert({ user_id: currentUser.id, post_id: postId });
    }
  } catch(e){ console.warn('toggleSavePost error:', e); }
}

// Post options modal
let _currentOptPostId = null;
let _currentOptUserId = null;

function openPostOpts(postId, userId){
  _currentOptPostId = postId;
  _currentOptUserId = userId;
  const isOwn = currentUser && currentUser.id === userId;
  document.getElementById('opt-delete-post').style.display = isOwn ? 'flex' : 'none';
  showModal('post-opts-modal');
}

function shareCurrentPost(){
  if(_currentOptPostId) sharePost(_currentOptPostId);
}

function saveCurrentPost(){
  const postEl = document.querySelector('.mpost[data-post-id="'+_currentOptPostId+'"]');
  if(postEl){
    const saveBtn = postEl.querySelector('.save-btn');
    if(saveBtn) toggleSavePost(saveBtn);
  } else { toast('Salvo!'); }
}

function copyCurrentPostLink(){
  const url = window.location.origin + '/?post=' + _currentOptPostId;
  navigator.clipboard.writeText(url).then(()=>toast('Link copiado!')).catch(()=>toast('Erro ao copiar'));
}

async function deleteCurrentPost(){
  if(!_currentOptPostId || !currentUser) return;
  if(!confirm('Tem certeza que deseja deletar este post?')) return;
  const sb = getSupabase();
  if(!sb) return;
  try {
    // Delete related data first
    await Promise.all([
      sb.from('likes').delete().eq('post_id', _currentOptPostId),
      sb.from('comments').delete().eq('post_id', _currentOptPostId),
      sb.from('saved_posts').delete().eq('post_id', _currentOptPostId)
    ]);
    // Delete the post
    const { error } = await sb.from('posts').delete().eq('id', _currentOptPostId).eq('user_id', currentUser.id);
    if(error){ toast('Erro ao deletar: ' + error.message); return; }
    // Remove from DOM
    const postEl = document.querySelector('.mpost[data-post-id="'+_currentOptPostId+'"]');
    if(postEl) postEl.remove();
    toast('Post deletado!');
    _currentOptPostId = null;
  } catch(e){ toast('Erro ao deletar'); console.warn(e); }
}

// Story delete
async function deleteCurrentStory(){
  if(!currentUser) return;
  const group = storyGroups[currentStoryGroup];
  if(!group || group.user_id !== currentUser.id) return;
  const story = group.stories[currentStoryIndex];
  if(!story) return;
  if(!confirm('Deletar este story?')) return;
  const sb = getSupabase();
  if(!sb) return;
  try {
    const { error } = await sb.from('posts').delete().eq('id', story.id).eq('user_id', currentUser.id);
    if(error){ toast('Erro ao deletar story'); return; }
    // Remove from group
    group.stories.splice(currentStoryIndex, 1);
    if(group.stories.length === 0){
      storyGroups.splice(currentStoryGroup, 1);
      closeStoryViewer();
      loadStories();
    } else {
      if(currentStoryIndex >= group.stories.length) currentStoryIndex = group.stories.length - 1;
      showStory(currentStoryGroup, currentStoryIndex);
    }
    toast('Story deletado!');
  } catch(e){ toast('Erro ao deletar story'); console.warn(e); }
}

function getTimeAgo(dateStr){
  if(!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff/60000);
  if(mins < 1) return 'AGORA';
  if(mins < 60) return 'HA '+mins+' MIN';
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return 'HA '+hrs+' HORA'+(hrs>1?'S':'');
  const days = Math.floor(hrs/24);
  if(days < 7) return 'HA '+days+' DIA'+(days>1?'S':'');
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

// Stories data grouped by user
let storyGroups = [];
let currentStoryGroup = 0;
let currentStoryIndex = 0;
let storyTimer = null;
const STORY_DURATION = 5000; // 5 seconds per story like IG

async function loadStories(feedIds){
  try {
    const sb = getSupabase();
    if(!sb) return;
    const myId = currentUser ? currentUser.id : null;
    // Load stories from last 24h (like IG) from followed users + own
    const since = new Date(Date.now() - 24*60*60*1000).toISOString();
    if(!feedIds) feedIds = await getFollowingIds();
    // Build query - if user has following list, filter by it; otherwise show all recent stories
    let storyQuery = sb.from('posts').select(POST_COLS).eq('media_type', 'story');
    // Só stories aprovados (ou sem status, compat) — não vaza conteúdo pendente
    storyQuery = storyQuery.or('status.eq.approved,status.is.null');
    if(feedIds.length > 0) storyQuery = storyQuery.in('user_id', feedIds);
    storyQuery = storyQuery.gte('created_at', since).order('created_at', { ascending: true }).limit(100);
    let { data: stories, error } = await storyQuery;
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
      const { data: profs } = await sb.from('profiles').select('id, name, tag, avatar_url').in('id', allNeededIds);
      (profs||[]).forEach(pr => { allFollowedProfiles[pr.id] = pr; });
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
      const avatar = p.avatar_url || g.stories[0].media_url || 'https://i.pravatar.cc/150?img=68';
      const seen = isStoryGroupSeen(g.user_id) ? ' seen' : '';
      html += `<div class="story" onclick="openStoryViewer(${gi})">
        <div class="story-ring${seen}"><div class="story-inner"><img src="${avatar}" alt=""></div></div>
        <span class="story-name">${name}</span>
      </div>`;
    }

    // Render followed users WITHOUT stories (profile circles)
    for(const uid of followedIds){
      if(renderedUserIds.has(uid)) continue;
      const p = allFollowedProfiles[uid];
      if(!p) continue;
      let name = p.tag ? '@' + p.tag : (p.name || 'User');
      if(!p.tag){
        if(name.includes('@')) name = name.split('@')[0];
        name = name.split(' ')[0];
      }
      const initials = (p.name || 'U').split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase();
      const avatar = p.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=e8e2d9&color=1a1a2e&size=96`;
      html += `<div class="story" onclick="openUserProfile('${uid}')">
        <div class="story-ring seen"><div class="story-inner"><img src="${avatar}" alt=""></div></div>
        <span class="story-name">${name}</span>
      </div>`;
    }

    row.innerHTML = html;

    // Re-apply user avatar/name after innerHTML rebuild
    updateMyStoryAvatar();

    // Update empty state
    const emptyEl = document.getElementById('feed-empty');
    if(emptyEl) emptyEl.style.display = (storyGroups.length > 0 || followedIds.length > 0) ? 'none' : 'block';
  } catch(e) {
    console.error('loadStories error:', e);
  }
}

function isStoryGroupSeen(userId){
  try { const seen = JSON.parse(localStorage.getItem('seen_stories') || '{}'); return !!seen[userId]; } catch(e){ return false; }
}
function markStoryGroupSeen(userId){
  try { const seen = JSON.parse(localStorage.getItem('seen_stories') || '{}'); seen[userId] = Date.now(); localStorage.setItem('seen_stories', JSON.stringify(seen)); } catch(e){}
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
  if(storyTimer) clearInterval(storyTimer);
  storyTimer = null;
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
  if(storyIsVideo){
    imgEl.style.display = 'none';
    imgEl.src = '';
    vidEl.style.display = 'block';
    vidEl.src = s.media_url || '';
    vidEl.muted = false;
    vidEl.currentTime = 0;
    vidEl.play().catch(() => { vidEl.muted = true; vidEl.play().catch(()=>{}); });
  } else {
    vidEl.pause();
    vidEl.removeAttribute('src');
    vidEl.style.display = 'none';
    imgEl.style.display = 'block';
    imgEl.src = s.media_url || '';
  }
  // Update header
  document.getElementById('story-viewer-avatar').src = p.avatar_url || 'https://i.pravatar.cc/150?img=68';
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

  // Start auto-advance timer
  if(storyTimer) clearInterval(storyTimer);
  if(storyIsVideo){
    // Vídeo: progresso e avanço seguem a duração real do vídeo
    vidEl.onended = () => storyNext();
    storyTimer = setInterval(() => {
      const fill = document.getElementById('story-progress-fill');
      if(fill && vidEl.duration) fill.style.width = (vidEl.currentTime / vidEl.duration * 100) + '%';
    }, 80);
  } else {
    let elapsed = 0;
    const step = 50;
    storyTimer = setInterval(() => {
      elapsed += step;
      const fill = document.getElementById('story-progress-fill');
      if(fill) fill.style.width = (elapsed / STORY_DURATION * 100) + '%';
      if(elapsed >= STORY_DURATION) storyNext();
    }, step);
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

// ══════════════════════════════
//  CHANGE 2: POSTING SYSTEM
// ══════════════════════════════
let postSelectedFiles = [];

function handlePostFiles(input){
  const files = Array.from(input.files);
  if(!files.length) return;
  postSelectedFiles = [files[0]]; // only 1 image for story
  const previewArea = document.getElementById('post-preview-area');
  const previewImages = document.getElementById('post-preview-images');
  previewArea.style.display = 'block';
  document.getElementById('post-picker-area').style.display = 'none';
  previewImages.innerHTML = '';
  const url = URL.createObjectURL(files[0]);
  previewImages.innerHTML = getMediaType(files[0]) === 'video'
    ? `<video src="${url}" controls playsinline class="post-preview-img" style="max-height:200px;border-radius:10px;object-fit:cover;background:#000;"></video>`
    : `<img src="${url}" class="post-preview-img" style="max-height:200px;border-radius:10px;object-fit:cover;">`;
}

function isVideoUrl(u){
  return /\.(mp4|webm|mov|m4v|ogg|ogv)(\?|#|$)/i.test(u || '');
}

function clearPostImages(){
  postSelectedFiles = [];
  document.getElementById('post-preview-area').style.display = 'none';
  document.getElementById('post-picker-area').style.display = 'block';
  document.getElementById('post-file-input').value = '';
}

async function publishPost(){
  const sb = getSupabase();
  if(!sb){ toast('Erro: Supabase nao disponivel'); return; }
  const btn = document.getElementById('post-publish-btn');
  const type = currentPostType; // 'story' or 'post'
  try {
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ toast('Faca login para publicar'); return; }
    const content = document.getElementById('post-text-input').value.trim();

    // Story requires image; Post can be text-only
    if(type === 'story' && postSelectedFiles.length === 0){
      toast('Adicione uma imagem para o story');
      return;
    }
    if(type === 'post' && postSelectedFiles.length === 0 && !content){
      toast('Adicione uma imagem ou texto');
      return;
    }

    btn.textContent = 'Publicando...';
    btn.disabled = true;
    let imageUrl = null;

    // Upload image if selected
    if(postSelectedFiles.length > 0){
      const file = postSelectedFiles[0];
      const ext = file.name.split('.').pop();
      const path = session.user.id + '/' + Date.now() + '.' + ext;
      const { error: upError } = await sb.storage.from('posts').upload(path, file);
      if(upError){
        console.error('Upload error:', upError);
        toast('Erro no upload: ' + upError.message);
        btn.textContent = 'Publicar'; btn.disabled = false;
        return;
      }
      const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
      imageUrl = urlData.publicUrl;
    }

    // Content moderation check
    const hasMedia = postSelectedFiles.length > 0;
    const isVideo = hasMedia && getMediaType(postSelectedFiles[0]) === 'video';
    // Vídeo: modera só o texto na hora (bloqueio duro); o vídeo em si
    // (frames + áudio) é analisado de forma assíncrona após publicar.
    const modResult = isVideo
      ? await moderateContentAsync(content, null, false)
      : await moderateContentAsync(content, imageUrl, hasMedia);
    if (!modResult.approved && modResult.severity === 'hard') {
      // Hard block — apaga o upload e aborta
      if (imageUrl) {
        try {
          const path = imageUrl.split('/posts/').pop();
          if (path) await sb.storage.from('posts').remove([path]);
        } catch(e){ console.warn('cleanup upload:', e); }
      }
      toast('Conteúdo bloqueado pela moderação (' + modResult.reason + ')');
      btn.textContent = 'Publicar'; btn.disabled = false;
      return;
    }
    // Vídeo sempre entra pendente até a análise assíncrona liberar
    const postStatus = isVideo ? 'pending' : (modResult.approved ? 'approved' : 'pending');

    // Sale data (grafiteiro)
    const forSale = document.getElementById('post-for-sale')?.checked || false;
    const price = forSale ? (parseFloat(document.getElementById('post-price')?.value) || 0) : 0;
    const artType = forSale ? (document.getElementById('post-art-type')?.value || '') : '';

    const { data: insertData, error: insertErr } = await sb.from('posts').insert({
      user_id: session.user.id,
      caption: content || null,
      media_url: imageUrl,
      media_type: type === 'story' ? 'story' : (postSelectedFiles[0] && getMediaType(postSelectedFiles[0]) === 'video' ? 'video' : 'image'),
      status: postStatus,
      for_sale: forSale,
      price: price > 0 ? price : null,
      art_type: artType || null,
      created_at: new Date().toISOString()
    }).select();

    btn.textContent = 'Publicar';
    btn.disabled = false;

    if(insertErr){
      console.error('Post insert error:', insertErr);
      toast('Erro ao publicar: ' + (insertErr.message || JSON.stringify(insertErr)));
    } else {
      // Vídeo: dispara a análise assíncrona (frames + áudio) no servidor
      if(isVideo && insertData && insertData[0]){
        getAccessToken().then(token => {
          fetch('/api/moderate-video', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: token, postId: insertData[0].id, mediaUrl: imageUrl, caption: content })
          }).then(r => r.json()).then(() => {
            if(typeof loadFeed === 'function') loadFeed();
          }).catch(e => console.warn('moderate-video:', e));
        });
      }
      if(isVideo){
        toast('Vídeo publicado — em análise antes de ficar visível.');
      } else if(postStatus === 'pending'){
        toast('Post enviado para revisão antes de ser publicado.');
      } else {
        toast(type === 'story' ? 'Story publicado!' : 'Post publicado!');
      }
      closeModals();
      document.getElementById('post-text-input').value = '';
      clearPostImages();
      // Reset type to story for next time
      setPostType('story');
      await loadFeed();
    }
  } catch(e) {
    console.error('publishPost error:', e);
    toast('Erro: ' + (e.message || 'falha ao publicar'));
    if(btn){ btn.textContent = 'Publicar'; btn.disabled = false; }
  }
}

// ══════════════════════════════
//  CHANGE 3: LEAFLET MAP
// ══════════════════════════════
let leafletMap = null;
let mapMarkers = [];

function initLeafletMap(){
  if(leafletMap) return;
  const container = document.getElementById('leaflet-map');
  if(!container) return;
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
    console.error('Leaflet init error:', e);
  }
}

function createPinIcon(painter){
  const avatar = painter.avatar_url || painter.img || 'https://i.pravatar.cc/150?img=68';
  const name = (painter.name || painter.name || '').split(' ')[0];
  const rating = painter.rating_avg || painter.rating || 0;
  const featured = rating >= 4.9;
  const html = `<div class="pin-bubble ${featured?'featured':''}">
    <div class="pin-avatar"><img src="${avatar}" alt=""></div>
    <div class="pin-info">
      <div class="pin-name">${name}</div>
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

async function loadMapPainters(){
  try {
    const sb = getSupabase();
    if(!sb) return;
    const { data: profiles, error } = await sb.from('profiles')
      .select('id, name, tag, avatar_url, city, state, user_type, role, specialties, rating_avg, lat, lng')
      .or('role.eq.pintor,user_type.eq.pintor')
      .limit(50);
    if(error) throw error;
    if(!profiles || profiles.length === 0) return;

    dbPainters = profiles;

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
          document.getElementById('pp-img').src = p.avatar_url || 'https://i.pravatar.cc/150?img=68';
          document.getElementById('pp-name').textContent = p.name || 'Pintor';
          document.getElementById('pp-sub').textContent = [p.city, p.state].filter(Boolean).join(', ') + (p.specialties ? ' - ' + p.specialties : '');
          document.getElementById('pp-stars').textContent = '* '.repeat(Math.floor(p.rating_avg||0)) + ' ' + Number(p.rating_avg||0).toFixed(1);
          document.getElementById('painter-popup').classList.add('show');
        });
        mapMarkers.push(marker);
      }
    });

    renderPainterList(profiles);
  } catch(e) {
    console.error('loadMapPainters error:', e);
  }
}

function renderPainterList(painters_list){
  const painterListEl = document.getElementById('painter-list');
  if(!painterListEl) return;
  if(!painters_list || painters_list.length === 0){
    painterListEl.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Nenhum pintor encontrado</div>';
    return;
  }
  painterListEl.innerHTML = painters_list.map(p => {
    const stars = '* '.repeat(Math.floor(p.rating_avg||p.rating||0));
    const rating = Number(p.rating_avg||p.rating||0).toFixed(1);
    const avatarUrl = p.avatar_url || p.img || 'https://ui-avatars.com/api/?name='+encodeURIComponent(p.name||'P')+'&background=e8e2d9&color=1a1a2e&size=96';
    const location = p.city ? [p.city, p.state].filter(Boolean).join(', ') : '';
    const specs = p.specialties || (p.specs ? p.specs.slice(0,2).join(', ') : '');
    return `<div onclick="openUserProfile('${p.id}')" style="background:var(--white);border-radius:14px;padding:12px;display:flex;align-items:center;gap:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.06);">
      <img src="${avatarUrl}" style="width:52px;height:52px;border-radius:12px;object-fit:cover">
      <div style="flex:1"><div style="font-size:14px;font-weight:700;">${p.name || 'Pintor'}</div><div style="font-size:12px;color:var(--muted);">${location} ${specs ? '- ' + specs : ''}</div><div style="font-size:12px;color:var(--p1);margin-top:2px;">${stars} ${rating}</div></div>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join('');
}

async function filterExplorePainters(query){
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
  // Filter local DB painters
  const filtered = dbPainters.filter(p => {
    const name = (p.name||'').toLowerCase();
    const tag = (p.tag||'').toLowerCase();
    const city = (p.city||'').toLowerCase();
    const specs = (p.specialties||'').toLowerCase();
    return name.includes(q) || tag.includes(q) || city.includes(q) || specs.includes(q);
  });
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
  // If no results from cache, search Supabase directly
  if(filtered.length === 0){
    try {
      const sb = getSupabase();
      if(sb){
        const { data } = await sb.from('profiles')
          .select('id, name, tag, avatar_url, city, state, specialties, rating_avg, role, user_type')
          .or('role.eq.pintor,user_type.eq.pintor')
          .ilike('name', '%'+q+'%')
          .limit(20);
        if(data && data.length > 0){
          data.forEach(p => filtered.push(p));
        }
      }
    } catch(e){ console.warn('filterExplorePainters search error:', e); }
  }
  renderPainterList(filtered);
}

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

// ══════════════════════════════
//  CHANGE 4: ARCHIVE CONVERSATIONS
// ══════════════════════════════
let archivedConvs = JSON.parse(localStorage.getItem('quc_archived_convs') || '[]');
let archivedExpanded = false;

function initArchiveButtons(){
  document.querySelectorAll('.conv-item[data-conv-id]').forEach(item => {
    const convId = item.dataset.convId;
    // Add archive button
    const btn = document.createElement('button');
    btn.className = 'conv-archive-btn';
    btn.title = 'Arquivar';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
    btn.onclick = function(e){
      e.stopPropagation();
      archiveConversation(convId);
    };
    item.style.position = 'relative';
    item.appendChild(btn);
  });
  applyArchivedState();
}

function archiveConversation(convId){
  if(!archivedConvs.includes(convId)){
    archivedConvs.push(convId);
    localStorage.setItem('quc_archived_convs', JSON.stringify(archivedConvs));
    toast('Conversa arquivada');
    applyArchivedState();
  }
}

function unarchiveConversation(convId){
  archivedConvs = archivedConvs.filter(id => id !== convId);
  localStorage.setItem('quc_archived_convs', JSON.stringify(archivedConvs));
  toast('Conversa desarquivada');
  applyArchivedState();
}

function applyArchivedState(){
  const archivedSection = document.getElementById('archived-section');
  const archivedList = document.getElementById('archived-list');
  const archivedCount = document.getElementById('archived-count');

  // Hide archived from main list, show non-archived
  document.querySelectorAll('.conv-item[data-conv-id]').forEach(item => {
    const convId = item.dataset.convId;
    item.style.display = archivedConvs.includes(convId) ? 'none' : 'flex';
  });

  if(archivedConvs.length > 0){
    archivedSection.style.display = 'block';
    archivedCount.textContent = '(' + archivedConvs.length + ')';

    // Build archived list
    let html = '';
    archivedConvs.forEach(convId => {
      const item = document.querySelector(`.conv-item[data-conv-id="${convId}"]`);
      if(item){
        html += `<div style="display:flex;align-items:center;padding:10px 16px;background:var(--cream);border-bottom:1px solid var(--border);gap:10px;cursor:pointer;" onclick="openChat('${convId}')">
          <div style="flex:1;font-size:13px;color:var(--ink);font-weight:600;">${chatData[convId]?.name || convId}</div>
          <button onclick="event.stopPropagation();unarchiveConversation('${convId}')" style="background:none;border:1px solid var(--border);border-radius:8px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--muted);cursor:pointer;font-family:'DM Sans',sans-serif;">Desarquivar</button>
        </div>`;
      }
    });
    archivedList.innerHTML = html;
  } else {
    archivedSection.style.display = 'none';
  }
}

function toggleArchivedSection(){
  archivedExpanded = !archivedExpanded;
  document.getElementById('archived-list').style.display = archivedExpanded ? 'block' : 'none';
  document.getElementById('archived-chevron').style.transform = archivedExpanded ? 'rotate(180deg)' : '';
}

// ══════════════════════════════
//  SCREEN HOOKS
// ══════════════════════════════
// Wrap showScreen to add hooks for dynamic loading
const _origShowScreen = showScreen;
showScreen = function(n){
  _origShowScreen(n);
  if(n === 'myprofile'){
    autoDetectRole();
  }
  if(n === 'feed'){
    loadFeed();
  }
  if(n === 'explore'){
    setTimeout(() => {
      initLeafletMap();
      if(leafletMap) leafletMap.invalidateSize();
    }, 200);
  }
  if(n === 'chat'){
    setTimeout(initArchiveButtons, 100);
  }
};

// ══════════════════════════════
//  TAG UNIQUENESS CHECK
// ══════════════════════════════
let tagAvailable = false;
let tagCheckTimeout;

async function validateAndGoStep3(){
  const name = document.getElementById('s-name').value.trim();
  const tag = document.getElementById('s-tag').value.trim();
  const email = document.getElementById('s-email').value.trim();
  const pw = document.getElementById('s-pw').value;
  if(!name){ toast('Preencha seu nome'); return; }
  if(!tag || tag.length < 3){ toast('Escolha uma tag com pelo menos 3 caracteres'); return; }
  if(!email){ toast('Preencha seu email'); return; }
  if(!pw || pw.length < 8){ toast('Senha deve ter no minimo 8 caracteres'); return; }
  // Check tag availability before proceeding
  const statusEl = document.getElementById('tag-status');
  statusEl.style.display = 'block';
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Verificando tag...';
  try {
    const sb = getSupabase();
    if(sb){
      const { data } = await sb.from('profiles').select('id').eq('tag', tag.toLowerCase()).limit(1);
      if(data && data.length > 0){
        statusEl.style.color = 'var(--p4)';
        statusEl.textContent = '@' + tag + ' ja esta em uso. Escolha outra tag.';
        tagAvailable = false;
        return;
      }
    }
  } catch(e){ console.warn('Tag check error:', e); }
  tagAvailable = true;
  statusEl.style.display = 'none';
  signupNext(3);
}

async function checkTagAvailability(){
  const tag = document.getElementById('s-tag').value.trim().toLowerCase();
  const statusEl = document.getElementById('tag-status');
  if(!tag || tag.length < 3){
    statusEl.style.display = 'none';
    tagAvailable = false;
    return;
  }
  statusEl.style.display = 'block';
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Verificando disponibilidade...';
  try {
    const sb = getSupabase();
    if(!sb){ tagAvailable = true; statusEl.style.display = 'none'; return; }
    const { data, error } = await sb.from('profiles')
      .select('id')
      .eq('tag', tag)
      .limit(1);
    if(error) throw error;
    if(data && data.length > 0){
      statusEl.style.color = 'var(--p4)';
      statusEl.textContent = '@' + tag + ' ja esta em uso. Escolha outra tag.';
      tagAvailable = false;
    } else {
      statusEl.style.color = 'var(--p6)';
      statusEl.textContent = '@' + tag + ' esta disponivel!';
      tagAvailable = true;
    }
  } catch(e){
    console.warn('Tag check error:', e);
    tagAvailable = true;
    statusEl.style.display = 'none';
  }
}

// ══════════════════════════════
//  INVITE CODE GENERATION
// ══════════════════════════════
let generatedInviteCode = {};
async function generateInviteCode(view){
  const sb = getSupabase();
  if(!sb){ toast('Erro: Supabase nao disponivel'); return; }
  const btn = document.getElementById('gen-invite-btn-' + view);
  btn.textContent = 'Gerando...';
  btn.disabled = true;
  try {
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ toast('Faca login primeiro'); btn.textContent = 'Gerar Codigo de Convite'; btn.disabled = false; return; }
    // Generate a unique code QUC-XXXXX
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'QUC-';
    for(let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    // Try to insert into invites table (non-blocking)
    try {
      await sb.from('invites').insert({
        code: code,
        created_by: session.user.id,
        used: false,
        uses: 0,
        max_uses: 5
      });
    } catch(dbErr){ console.warn('Invite DB insert skipped:', dbErr); }
    // Always show the code to the user
    generatedInviteCode[view] = code;
    document.getElementById('my-invite-code-' + view).style.display = 'block';
    document.getElementById('my-invite-code-value-' + view).textContent = code;
    document.getElementById('share-invite-btn-' + view).style.display = 'block';
    btn.textContent = 'Gerar Novo Codigo';
    btn.disabled = false;
    toast('Codigo gerado!');
  } catch(e){
    console.error('generateInviteCode error:', e);
    toast('Erro ao gerar codigo');
    btn.textContent = 'Gerar Codigo de Convite'; btn.disabled = false;
  }
}

function shareInviteCode(view){
  const code = generatedInviteCode[view];
  if(!code){ toast('Gere um codigo primeiro'); return; }
  const text = 'Oi! Use meu codigo ' + code + ' para se cadastrar no QueroUmaCor - o app para pintores e clientes!';
  if(navigator.share){
    navigator.share({ title: 'Convite QueroUmaCor', text: text }).catch(()=>{});
  } else if(navigator.clipboard){
    navigator.clipboard.writeText(code).then(()=>toast('Codigo copiado!')).catch(()=>toast('Codigo: '+code));
  } else {
    prompt('Copie o codigo:', code);
  }
}

// Feed is loaded by initAuth after auth check completes

