// ══ SCREENS ══
const screens=['login','signup','feed','explore','search','profile','orcamento','myprofile','calc','notif','chat','chatconv','pedidos','avaliar','mkt','camisetas','info','pipeline','crm'];

// Helpers de formatação de R$ (pt-BR): aceita "500", "500,00", "1.500,00",
// "1500.50" no input e devolve Number; o blur formata pra "1.500,00".
function parseBRL(val){
  const raw = String(val == null ? '' : val).trim();
  if(!raw) return 0;
  // Normaliza: tira pontos de milhar e usa ponto como decimal
  const n = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function fmtBRL(el){
  if(!el) return;
  const raw = String(el.value || '').trim();
  if(!raw){ return; }
  const n = parseBRL(raw);
  if(!Number.isFinite(n) || n < 0){ return; }
  el.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const bnMap={feed:'bn-feed',search:'bn-search',mkt:'bn-mkt',notif:'bn-notif',myprofile:'bn-myprofile'};
const noNav=['login','signup','chatconv'];
function showScreen(n, _fromPop){
  screens.forEach(s=>{
    const el=document.getElementById('screen-'+s);
    if(el)el.classList.toggle('active',s===n);
  });
  Object.values(bnMap).forEach(id=>{document.getElementById(id)?.classList.remove('active');});
  if(bnMap[n])document.getElementById(bnMap[n]).classList.add('active');
  if(['pedidos','avaliar','camisetas','info','pipeline','crm'].includes(n)){document.getElementById('bn-myprofile')?.classList.add('active');}
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
  if(n==='chatconv'){setTimeout(()=>{const a=document.getElementById('msgs-area');if(a)a.scrollTop=a.scrollHeight;},150);}
  if(n==='feed' && (!_lastFeedLoad || Date.now()-_lastFeedLoad > 30000)){ loadFeed(); }
  if(n==='mkt') { loadMktProducts(); updateCartBadge(); }
  if(n==='myprofile'){ loadMyProfileData(); refreshProStatus(); }
  if(n==='chat'){ loadChatList(); const cb=document.getElementById('chat-badge-dot'); if(cb) cb.style.display='none'; }
  if(n==='search'){ const sr=document.getElementById('search-results'); if(sr) sr.innerHTML = getSearchEmpty(); }
  if(n==='notif') loadNotifications();
  if(n==='pedidos') loadPedidos();
  if(n==='avaliar') loadAvaliarScreen();
  if(n==='camisetas') loadBusinessLogo();
  if(n==='info') openInfoPage('menu');
  if(n==='pipeline') loadPipeline();
  if(n==='crm') loadCrm();
  _navSyncHistory(n, _fromPop);
}

// ══ BOTÃO VOLTAR (Android / PWA) — navega entre telas em vez de fechar o app ══
let _navCurScreen = 'feed';
let _navBackStack = [];
let _navExitArmed = false;

function _navSyncHistory(n, fromPop){
  if(n === _navCurScreen) return;
  if(n === 'login' || n === 'signup'){
    _navBackStack = [];
    _navCurScreen = n;
    try { history.replaceState({ qs:n }, ''); } catch(e){}
    return;
  }
  if(!fromPop){
    _navBackStack.push(_navCurScreen);
    try { history.pushState({ qs:n }, ''); } catch(e){}
  }
  _navCurScreen = n;
}

try { history.replaceState({ qs:'feed' }, ''); } catch(e){}
window.addEventListener('popstate', function(){
  // 1) Modal aberto: voltar fecha o modal (não navega de tela).
  if(document.querySelector('.overlay.open')){
    closeModals();
    try { history.pushState({ qs:_navCurScreen }, ''); } catch(e){}
    return;
  }
  // 2) Há tela anterior: volta para ela.
  if(_navBackStack.length){
    const prev = _navBackStack.pop();
    showScreen(prev, true);
    return;
  }
  // 3) Sem histórico e fora da home: vai para a home (feed).
  if(_navCurScreen !== 'feed'){
    showScreen('feed', true);
    try { history.pushState({ qs:'feed' }, ''); } catch(e){}
    return;
  }
  // 4) Já na home: confirma a saída com toque duplo.
  if(_navExitArmed) return; // deixa o app fechar
  _navExitArmed = true;
  toast('Toque em voltar de novo para sair');
  try { history.pushState({ qs:'feed' }, ''); } catch(e){}
  setTimeout(function(){ _navExitArmed = false; }, 2000);
});


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
  phName.innerHTML=escapeHtml(p.name||'')+(p.name && p.name.includes('✓')?'':' ✓')+(p.pro?' <span style="background:var(--p1);color:#fff;font-size:10px;padding:2px 8px;border-radius:20px;font-family:\'DM Sans\',sans-serif;font-weight:600">PRO</span>':'');
  document.querySelector('.ph-bio').innerHTML=escapeHtml(p.bio||'').replace(/\n/g,'<br>');

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
  const pop=document.getElementById('painter-popup');
  pop.dataset.painterId=id;
  pop.classList.add('show');
  pop.querySelector('.pp-btn').onclick=()=>openProfile(id);
}
// "Ver perfil" no popup do mapa — abre o perfil real do profissional guardado em data-painter-id
function openPainterPopupProfile(){
  const pop=document.getElementById('painter-popup');
  const id=pop && pop.dataset ? pop.dataset.painterId : null;
  if(!id) return;
  pop.classList.remove('show');
  if(painters && painters[id]){ openProfile(id); }
  else if(typeof openUserProfile==='function'){ openUserProfile(id); }
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

// ══ ESTIMATIVA DE METRAGEM POR FOTO (PRO) ══
function estimarAreaPorFoto(){
  if (!gateProClient('Estimativa de metragem por foto')) return;
  const input = document.getElementById('calc-photo-input');
  if(!input){ toast('Erro: input de foto não encontrado'); return; }
  input.onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if(!file) return;
    if(file.size > 8 * 1024 * 1024){ toast('Foto acima de 8 MB. Tente uma menor.'); return; }
    toast('Analisando foto...');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const { ok, status, data, error } = await apiPost('/api/area-from-photo', fd, { multipart: true });
      if(!ok){ toast('Erro ao analisar foto: ' + (error || status)); return; }
      const area = Number(data?.area_m2);
      const just = String(data?.justification || '').trim();
      if(!isFinite(area) || area <= 0){ toast('Não foi possível estimar a área desta foto'); return; }
      const areaRounded = Math.round(area * 10) / 10;
      const areaInput = document.getElementById('ci-area');
      if(areaInput){
        areaInput.value = areaRounded;
        calcTinta();
      }
      toast(`Estimativa: ${areaRounded} m²` + (just ? ` · ${just}` : ''));
    } catch(e){
      toast('Erro ao analisar foto: ' + (e?.message || e));
    }
  };
  input.click();
}

// ══ AI FEATURES (PRO) ══
let _isPro = false;
let _proExpires = null;

async function refreshProStatus(){
  try {
    const sb = getSupabase();
    if(!sb || !currentUser) { _isPro = false; _proExpires = null; applyProUI(); return false; }
    const data = await getMyProfile();
    const notExpired = !data?.pro_expires_at || new Date(data.pro_expires_at) > new Date();
    _isPro = !!(data && data.is_pro && notExpired);
    _proExpires = data?.pro_expires_at || null;
    applyProUI();
    return _isPro;
  } catch(e){ console.warn('refreshProStatus:', e && e.message || e); applyProUI(); return _isPro; }
}

// Quando o perfil ja e PRO, troca o banner de upsell por "PRO ativo"
function applyProUI(){
  try {
    const badge = document.getElementById('pro-status-badge');
    if(badge){
      if(_isPro){
        badge.textContent = 'PRO';
        badge.style.background = '#16a34a';
        badge.style.color = '#fff';
      } else {
        badge.textContent = 'GRÁTIS';
        badge.style.background = 'rgba(255,255,255,.15)';
        badge.style.color = '#fff';
      }
    }
    const banner = document.querySelector('#view-pintor .pro-banner');
    if(!banner) return;
    if(_isPro){
      banner.onclick = null;
      banner.style.cursor = 'default';
      let until = '';
      if(_proExpires){ until = ' · até ' + dateBR(_proExpires); }
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
  } catch(e){ console.warn('applyProUI:', e && e.message || e); }
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
  } catch(e){ console.warn('handleProReturn:', e && e.message || e); }
}

// CTA — Parceria Mercado Pago pra pintores (receber dos próprios clientes
// via PIX/cartão/maquininha). Abre o cadastro do MP em nova aba.
async function abrirParceriaMP(){
  const goSignup = await appConfirm(
    'Receba pagamentos dos seus clientes via Mercado Pago: PIX instantâneo, cartão até 12x e maquininha. Sem mensalidade. Vamos te levar pro cadastro?',
    { okLabel: 'Quero me cadastrar', cancelLabel: 'Agora não' }
  );
  if(!goSignup) return;
  window.open('https://www.mercadopago.com.br/registration/landing', '_blank', 'noopener,noreferrer');
}

// Retorno do checkout Mercado Pago (Loja). URL: /?compra=<orderId>&status=success|failure|pending
// Faz polling no status da order pra confirmar quando o webhook chegou.
function handleCompraReturn(){
  try {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('compra');
    if(!orderId) return;
    const status = (params.get('status') || '').toLowerCase();
    // Limpa a URL
    window.history.replaceState({}, '', window.location.pathname);

    // Se MP devolveu falha explícita, mostra direto sem polling
    if(status === 'failure'){
      toast('Pagamento não concluído. Você pode tentar de novo em "Meus Pedidos".');
      return;
    }
    if(status === 'pending'){
      toast('Pagamento pendente (PIX/boleto). Acompanhe em "Meus Pedidos".');
      return;
    }

    toast('Confirmando pagamento...');
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      try {
        const { data } = await sb.from('orders')
          .select('status, paid_at')
          .eq('id', orderId).single();
        if(data && data.status === 'paid'){
          clearInterval(iv);
          toast('Compra confirmada! 🎉 Você ganhou pontos.');
          // recarrega a tela de pedidos se estiver aberta
          if(typeof loadPedidos === 'function'){ try { loadPedidos(); } catch{} }
        } else if(data && data.status === 'amount_mismatch'){
          clearInterval(iv);
          toast('Atenção: valor pago diverge do pedido. Entre em contato com a loja.');
        } else if(data && (data.status === 'canceled' || data.status === 'refunded')){
          clearInterval(iv);
          toast('Pagamento ' + (data.status === 'refunded' ? 'estornado' : 'cancelado') + '.');
        } else if(tries >= 8){
          clearInterval(iv);
          toast('Pagamento em processamento. Acompanhe em "Meus Pedidos".');
        }
      } catch(e){ /* tenta de novo */ }
    }, 3000);
  } catch(e){ console.warn('handleCompraReturn:', e && e.message || e); }
}

// Link de perfil compartilhado (?ref=<userId>): funciona como convite —
// pula o passo do código e registra quem indicou (invited_by).
async function handleReferralParam(){
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if(!ref) return;
    // Limpa o parâmetro da URL
    window.history.replaceState({}, '', window.location.pathname);
    if(currentUser) return; // já logado/cadastrado — ignora
    const sb = getSupabase();
    let refName = '';
    try {
      if(sb){
        const { data } = await sb.from('profiles').select('name').eq('id', ref).single();
        refName = data ? (data.name || '') : '';
      }
    } catch(e){ /* ref inválido cai abaixo */ }
    if(!refName) return; // perfil inexistente — ignora o link
    // Marca como convite válido (substitui o código) e vai direto ao cadastro
    validatedInviteCode = { created_by: ref, referral: true };
    showScreen('signup');
    if(typeof signupNext === 'function') signupNext(1); // pula o passo do código
    toast('Você foi convidado por ' + refName.split(' ')[0] + '! Crie sua conta 🎨');
  } catch(e){ console.warn('handleReferralParam:', e && e.message || e); }
}

// ══ MAIS INFORMAÇÕES E SUPORTE ══
const SUPPORT = {
  // Canal de atendimento (Fale Conosco) e solicitações de exclusão de
  // conta (LGPD) — contato da Cali Colors.
  email: 'loja@calicolors.com.br',
  // WhatsApp de atendimento: DDI+DDD+número só dígitos.
  // Cali Colors: (11) 95976-5031.
  whatsapp: '5511959765031'
};
const _infoTitles = {
  menu:'Mais informações e suporte',
  ajuda:'Central de Ajuda',
  contato:'Fale Conosco',
  privacidade:'Política de Privacidade',
  termos:'Termos de Uso',
  conta:'Excluir minha conta',
  sobre:'Sobre o QueroUmaCor'
};
let _infoPage = 'menu';
function openInfoPage(page){
  _infoPage = page;
  Object.keys(_infoTitles).forEach(p=>{
    const el = document.getElementById('info-page-'+p);
    if(el) el.style.display = (p===page) ? 'block' : 'none';
  });
  const t = document.getElementById('info-title');
  if(t) t.textContent = _infoTitles[page] || 'Informações';
  const sa = document.getElementById('scroll-area');
  if(sa) sa.scrollTop = 0;
  if(page==='contato'){
    const wa = document.getElementById('info-wa-btn');
    const em = document.getElementById('info-email-btn');
    const pend = document.getElementById('info-contato-pend');
    if(wa) wa.style.display = SUPPORT.whatsapp ? 'flex' : 'none';
    if(em) em.style.display = SUPPORT.email ? 'flex' : 'none';
    if(pend) pend.style.display = (!SUPPORT.whatsapp && !SUPPORT.email) ? 'block' : 'none';
  }
}
function infoBack(){
  if(_infoPage !== 'menu') openInfoPage('menu');
  else showScreen('myprofile');
}
function supportWhatsApp(){
  if(!SUPPORT.whatsapp){ toast('WhatsApp não configurado'); return; }
  const msg = encodeURIComponent('Olá! Preciso de ajuda com o app QueroUmaCor.');
  window.open('https://wa.me/' + SUPPORT.whatsapp + '?text=' + msg, '_blank', 'noopener,noreferrer');
}
function supportEmail(){
  const uid = (typeof currentUser!=='undefined' && currentUser) ? currentUser.id : '';
  const subject = encodeURIComponent('Suporte QueroUmaCor');
  const body = encodeURIComponent('Descreva sua dúvida ou problema:\n\n\n---\nID do usuário: ' + uid);
  window.location.href = 'mailto:' + SUPPORT.email + '?subject=' + subject + '&body=' + body;
}
async function requestAccountDeletion(){
  if(!(await appConfirm('Tem certeza que deseja solicitar a exclusão da sua conta?\n\nEsta ação é permanente e remove seu perfil, portfólio, mensagens e avaliações.', { okLabel:'Solicitar exclusão' }))) return;
  const u = (typeof currentUser!=='undefined' && currentUser) ? currentUser : null;
  const subject = encodeURIComponent('Solicitação de exclusão de conta - QueroUmaCor');
  const body = encodeURIComponent(
    'Solicito a exclusão definitiva da minha conta no QueroUmaCor e de todos os meus dados pessoais, conforme a LGPD.\n\n' +
    '---\n' +
    'E-mail da conta: ' + (u && u.email ? u.email : '') + '\n' +
    'ID do usuário: ' + (u ? u.id : '') + '\n' +
    'Data da solicitação: ' + new Date().toLocaleString('pt-BR')
  );
  window.location.href = 'mailto:' + SUPPORT.email + '?subject=' + subject + '&body=' + body;
  toast('Abrindo seu e-mail para enviar a solicitação...');
}

// ══════════════════════════════════════════
// FEATURE 1 — APROVAÇÃO DE ORÇAMENTO (pipeline)
// Ciclo: rascunho/pending → enviado → aprovado → em_execucao → concluido (+ recusado)
// ══════════════════════════════════════════

const QUOTE_STATUS = {
  pending:    { label:'A orçar',     color:'#8a8a99' },
  rascunho:   { label:'Rascunho',    color:'#8a8a99' },
  enviado:    { label:'Enviado',     color:'#f4a300' },
  aprovado:   { label:'Aprovado',    color:'#2ec4b6' },
  em_execucao:{ label:'Em execução', color:'#3a86ff' },
  concluido:  { label:'Concluído',   color:'#16a34a' },
  recusado:   { label:'Recusado',    color:'#e63946' }
};
let _pipelineCache = [];

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

// Congela o escopo+valor do orçamento como referência imutável.
function buildQuoteSnapshot(q){
  return {
    frozen_at: new Date().toISOString(),
    service_type: q.service_type || null,
    title: q.title || null,
    area_m2: q.area_m2 || null,
    address: q.address || null,
    description: q.description || null,
    price: +q.price || 0,
    proposed_date: q.proposed_date || null,
    quote_data: q.quote_data || null
  };
}

// Integra o Pipeline com a Agenda/Financeiro: orçamento aprovado / em
// execução / concluído vira um projeto (job). Idempotente — só cria o
// que falta e nunca rebaixa o status de um job já existente.
async function syncQuotesToJobs(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  try {
    const { data: quotes } = await sb.from('quotes')
      .select('id, client_name, service_type, address, price, proposed_date, status, client:profiles!client_id(name)')
      .eq('painter_id', currentUser.id)
      .in('status', ['aprovado','em_execucao','concluido']);
    if(!quotes || !quotes.length) return;
    const { data: jobs } = await sb.from('jobs')
      .select('id, quote_id, status').eq('painter_id', currentUser.id).not('quote_id','is',null);
    const byQuote = {};
    (jobs||[]).forEach(j => { if(j.quote_id) byQuote[j.quote_id] = j; });
    const t = new Date();
    const ymd = new Date(t.getTime() - t.getTimezoneOffset()*60000).toISOString().slice(0,10);
    for(const q of quotes){
      const existing = byQuote[q.id];
      if(!existing){
        await sb.from('jobs').insert({
          painter_id: currentUser.id,
          quote_id: q.id,
          client_name: q.client_name || (q.client && q.client.name) || 'Cliente',
          service_type: q.service_type || 'Serviço',
          address: q.address || null,
          scheduled_date: q.proposed_date || ymd,
          status: q.status === 'concluido' ? 'concluido' : 'agendado',
          revenue: +q.price || 0,
          material_cost: 0,
          notes: 'Gerado automaticamente do orçamento aprovado'
        });
      } else if(q.status === 'concluido' && existing.status !== 'concluido' && existing.status !== 'cancelado'){
        await sb.from('jobs').update({ status:'concluido' }).eq('id', existing.id).eq('painter_id', currentUser.id);
      }
    }
  } catch(e){ console.warn('syncQuotesToJobs:', e && e.message || e); }
}

async function loadPipeline(){
  const sb = getSupabase();
  const container = document.getElementById('pipeline-list');
  if(!container) return;
  if(!sb || !currentUser){ container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Faça login para ver seus orçamentos.</div>'; return; }
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Carregando...</div>';
  await syncQuotesToJobs();
  try {
    const { data: quotes, error } = await sb.from('quotes')
      .select('*, client:profiles!client_id(name)')
      .eq('painter_id', currentUser.id)
      .order('created_at', { ascending:false });
    if(error) throw error;
    _pipelineCache = quotes || [];
    renderPipeline();
  } catch(e){
    console.error('loadPipeline:', e && e.message || e);
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Erro ao carregar o pipeline.</div>';
  }
}

function renderPipeline(){
  const container = document.getElementById('pipeline-list');
  if(!container) return;
  const quotes = _pipelineCache || [];
  if(quotes.length === 0){
    container.innerHTML = '<div style="text-align:center;padding:50px 24px;color:var(--muted);">'
      + '<div style="font-size:40px;margin-bottom:10px;">📋</div>'
      + '<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum orçamento ainda</div>'
      + '<div style="font-size:13px;line-height:1.5;">Monte um orçamento na Calculadora e toque em "Salvar no Pipeline". Pedidos de clientes do app também aparecem aqui.</div>'
      + '</div>';
    return;
  }
  const groups = [
    { title:'A enviar',    statuses:['pending','rascunho'] },
    { title:'Enviados',    statuses:['enviado'] },
    { title:'Aprovados',   statuses:['aprovado'] },
    { title:'Em execução', statuses:['em_execucao'] },
    { title:'Concluídos',  statuses:['concluido'] },
    { title:'Recusados',   statuses:['recusado'] }
  ];
  let html = '';
  groups.forEach(g => {
    const list = quotes.filter(q => g.statuses.includes(q.status || 'rascunho'));
    if(list.length === 0) return;
    html += '<div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 10px;">'
      + g.title + ' · ' + list.length + '</div>';
    html += list.map(renderPipelineCard).join('');
  });
  container.innerHTML = html;
}

function renderPipelineCard(q){
  const s = q.status || 'rascunho';
  const st = QUOTE_STATUS[s] || QUOTE_STATUS.rascunho;
  const cli = q.client_name || (q.client && q.client.name) || 'Cliente';
  const price = (+q.price||0) > 0 ? 'R$ ' + (+q.price).toLocaleString('pt-BR') : 'Sem valor';
  const date = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
  const appBadge = q.client_id
    ? '<span style="font-size:10px;font-weight:700;color:#3a86ff;background:rgba(58,134,255,.1);padding:2px 7px;border-radius:20px;">Cliente do app</span>'
    : '<span style="font-size:10px;font-weight:700;color:var(--muted);background:var(--cream);padding:2px 7px;border-radius:20px;">Cliente externo</span>';
  const btn = (label,fn,bg,color)=>'<button onclick="'+fn+'" style="flex:1;padding:9px;background:'+bg+';color:'+(color||'#fff')+';border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">'+label+'</button>';
  let actions = '';
  if(s==='pending' || s==='rascunho'){
    actions = btn('Enviar', "enviarQuote('"+q.id+"')", 'var(--p1)')
            + btn('🤖 Sugerir preço', "sugerirPrecoQuote('"+q.id+"')", 'linear-gradient(135deg,#8338ec,var(--p1))');
  } else if(s==='enviado'){
    actions = btn('Marcar aceito', "aprovarQuoteManual('"+q.id+"')", '#2ec4b6')
            + btn('Recusado', "recusarQuote('"+q.id+"')", 'var(--cream)', 'var(--muted)');
  } else if(s==='aprovado'){
    actions = btn('Iniciar execução', "setQuoteStage('"+q.id+"','em_execucao')", '#3a86ff')
            + btn('Escopo', "verSnapshot('"+q.id+"')", 'var(--cream)', 'var(--ink)');
  } else if(s==='em_execucao'){
    actions = btn('Concluir', "setQuoteStage('"+q.id+"','concluido')", '#16a34a')
            + btn('Escopo', "verSnapshot('"+q.id+"')", 'var(--cream)', 'var(--ink)');
  } else {
    actions = btn('Ver escopo', "verSnapshot('"+q.id+"')", 'var(--cream)', 'var(--ink)');
  }
  const frozen = ['aprovado','em_execucao','concluido'].includes(s);
  let frozenLine = '';
  if(frozen){
    const when = q.approved_at ? ' em '+dateBR(q.approved_at) : '';
    const how = q.approval_method==='manual' ? ' · registro manual' : (q.approval_method==='app' ? ' · aprovado pelo cliente' : '');
    frozenLine = '<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">🔒 Escopo congelado'+when+how+'</div>';
  }
  const descBlock = q.description
    ? '<div style="background:var(--cream);border-radius:10px;padding:9px 11px;margin-bottom:10px;font-size:12px;color:var(--ink);line-height:1.5;white-space:pre-wrap;">'+escapeHtml(q.description)+'</div>'
    : '';
  const imgs = (q.images && Array.isArray(q.images)) ? q.images : [];
  const photosBlock = imgs.length > 0
    ? '<div style="display:flex;gap:6px;margin-bottom:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;">'
      + imgs.slice(0, 8).map(url =>
          '<a href="'+escapeHtml(url)+'" target="_blank" rel="noopener" style="flex-shrink:0;width:64px;height:64px;border-radius:8px;overflow:hidden;background:#000;display:block;"><img src="'+escapeHtml(url)+'" style="width:100%;height:100%;object-fit:cover;"></a>'
        ).join('')
      + '</div>'
    : '';
  return '<div style="background:var(--white);border-radius:14px;padding:13px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:9px;">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">'
    +   '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--ink);">'+escapeHtml(cli)+'</div>'
    +   '<div style="font-size:12px;color:var(--muted);">'+escapeHtml(q.service_type||q.title||'Orçamento')+'</div></div>'
    +   '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:'+st.color+';white-space:nowrap;">'+st.label+'</div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
    +   '<span style="font-size:13px;font-weight:800;color:var(--ink);">'+price+'</span>'+appBadge
    +   '<span style="margin-left:auto;font-size:11px;color:var(--muted);">'+date+'</span>'
    + '</div>'
    + descBlock
    + photosBlock
    + frozenLine
    + '<div style="display:flex;gap:7px;">'+actions+'</div>'
    + '</div>';
}

async function salvarOrcamento(){
  const ctx = requireSession('Faça login para salvar');
  if(!ctx) return;
  const sb = ctx.sb;
  const d = _lastOrcData;
  if(!d || !d.total){ toast('Gere o orçamento primeiro'); return; }
  // Usa RPC create_painter_draft (SECURITY DEFINER) — força painter_id =
  // auth.uid() no servidor, impedindo gravar rascunho em pipeline alheio.
  const { error } = await sb.rpc('create_painter_draft', {
    p_client_name:  d.cliente || 'Cliente',
    p_service_type: d.servico || 'Orçamento',
    p_title:        d.servico || 'Orçamento',
    p_area_m2:      d.area || null,
    p_price:        d.total || 0,
    p_quote_data:   d
  });
  if(handleSbError(error, 'Erro ao salvar')) return;
  toast('Orçamento salvo no Pipeline ✅');
  closeModals();
  showScreen('pipeline');
}

let _quotePriceTarget = null;

function enviarQuote(id){
  const q = _pipelineCache.find(x => x.id === id);
  if(!q) return;
  _quotePriceTarget = id;
  const note = document.getElementById('qp-ia-note');
  if(note){ note.style.display = 'none'; note.innerHTML = ''; }
  const input = document.getElementById('qp-price-input');
  if(input){
    input.value = (+q.price || 0) > 0
      ? (+q.price).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';
  }
  showModal('quote-price-modal');
  setTimeout(() => { if(input) input.focus(); }, 150);
}

async function enviarQuoteConfirmar(){
  const id = _quotePriceTarget;
  if(!id) return;
  const sb = getSupabase(); if(!sb || !currentUser) return;
  const input = document.getElementById('qp-price-input');
  const price = parseBRL(input ? input.value : '');
  if(price <= 0){ toast('Informe um valor válido'); return; }
  const q = _pipelineCache.find(x => x.id === id);
  if(!q) return;
  closeModals();
  const { error } = await sb.from('quotes')
    .update({ status: 'enviado', sent_at: new Date().toISOString(), price })
    .eq('id', id).eq('painter_id', currentUser.id);
  if(handleSbError(error)) return;
  if(q.client_id){
    notify(q.client_id, 'quote_sent', 'Você recebeu um orçamento',
      'Um profissional enviou um orçamento. Toque para ver e aprovar.', id);
  }
  toast('Orçamento enviado!');
  loadPipeline();
}

// IA sugere o preço para um orçamento pendente/rascunho (feature PRO).
// Em caso de aceite, injeta o valor no cache e delega para enviarQuote.
async function sugerirPrecoQuote(id){
  if (!gateProClient('Sugerir preço com Seu Zé')) return;
  const q = (_pipelineCache||[]).find(x=>x.id===id);
  if(!q){ toast('Orçamento não encontrado'); return; }
  toast('Calculando preço com Seu Zé...');
  try {
    const { ok, data } = await apiPost('/api/pricing-suggest', {
      service_type: q.service_type || q.title || '',
      description: q.description || '',
      area_m2: q.area_m2 || null
    });
    if(!ok || !data || typeof data.price !== 'number'){
      toast('Erro ao sugerir preço: ' + ((data && data.error) || 'Seu Zé indisponível'));
      return;
    }
    const price = +data.price || 0;
    const justification = String(data.justification || '').trim();
    // Abre o modal de preço pré-preenchido com a sugestão da IA e a
    // justificativa logo acima. Usuário pode editar antes de enviar.
    _quotePriceTarget = id;
    const note = document.getElementById('qp-ia-note');
    if(note){
      note.style.display = 'block';
      note.innerHTML = '<b>💡 Seu Zé sugere R$ ' + price.toLocaleString('pt-BR') + '</b>' + (justification ? '<br><span style="opacity:.85;">' + escapeHtml(justification) + '</span>' : '');
    }
    const input = document.getElementById('qp-price-input');
    if(input) input.value = price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    showModal('quote-price-modal');
    setTimeout(() => { if(input){ input.focus(); input.select(); } }, 150);
  } catch(e){
    console.warn('sugerirPrecoQuote:', e && e.message || e);
    toast('Erro ao falar com o Seu Zé');
  }
}

async function aprovarQuoteManual(id){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  const q = _pipelineCache.find(x=>x.id===id); if(!q) return;
  if(!(await appConfirm('Marcar este orçamento como aceito pelo cliente?\n\nO escopo e o valor ficam congelados como referência acordada.', { okLabel:'Marcar como aceito' }))) return;
  const note = await appPrompt('Observação da aprovação (opcional) — ex.: aceito por WhatsApp em DD/MM:', { placeholder:'Ex.: aceito por WhatsApp em 12/05' });
  if(note===null) return;
  const { error } = await sb.from('quotes').update({
    status:'aprovado', approved_at:new Date().toISOString(),
    approved_by: currentUser.id, approval_method:'manual',
    approval_note: note.trim() || null, scope_snapshot: buildQuoteSnapshot(q)
  }).eq('id', id).eq('painter_id', currentUser.id);
  if(handleSbError(error)) return;
  toast('Orçamento aprovado (registro manual)');
  loadPipeline();
}

async function recusarQuote(id){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  if(!(await appConfirm('Marcar este orçamento como recusado?', { okLabel:'Marcar como recusado' }))) return;
  const { error } = await sb.from('quotes').update({ status:'recusado' })
    .eq('id', id).eq('painter_id', currentUser.id);
  if(handleSbError(error)) return;
  toast('Orçamento recusado'); loadPipeline();
}

async function setQuoteStage(id, status){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  const patch = { status };
  if(status==='concluido') patch.completed_at = new Date().toISOString();
  const { error } = await sb.from('quotes').update(patch)
    .eq('id', id).eq('painter_id', currentUser.id);
  if(handleSbError(error)) return;
  // Pontos por conclusão são creditados automaticamente pelo trigger
  // trg_award_quote_completed_points (Bateria 3.2). Não chamar earnPoints aqui.
  toast(status==='concluido'?'Orçamento concluído!':'Execução iniciada'); loadPipeline();
}

// Aprovação nativa: o cliente (usuário do app) aprova o orçamento recebido.
async function aprovarQuoteCliente(id){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  if(!(await appConfirm('Aprovar este orçamento?\n\nVocê confirma o escopo e o valor apresentados — eles ficam congelados como referência.', { okLabel:'Aprovar' }))) return;
  const { data: q, error: e1 } = await sb.from('quotes').select('*').eq('id', id).single();
  if(e1 || !q){ toast('Erro ao carregar o orçamento'); return; }
  const followupOptin = await appConfirm('Quer receber lembretes deste profissional sobre repintura e manutenção? (opcional)', { okLabel:'Quero receber', cancelLabel:'Não, obrigado' });
  const { error } = await sb.from('quotes').update({
    status:'aprovado', approved_at:new Date().toISOString(),
    approved_by: currentUser.id, approval_method:'app',
    scope_snapshot: buildQuoteSnapshot(q),
    client_followup_optin: followupOptin
  }).eq('id', id).eq('client_id', currentUser.id);
  if(handleSbError(error)) return;
  if(q.painter_id){
    notify(q.painter_id, 'quote_approved', 'Orçamento aprovado! 🎉',
      'O cliente aprovou o orçamento. Toque para ver os detalhes.', id);
  }
  toast('Orçamento aprovado!');
  loadPedidos();
}

async function verSnapshot(id){
  const sb = getSupabase(); if(!sb) return;
  let q = (_pipelineCache||[]).find(x=>x.id===id);
  if(!q){ const r = await sb.from('quotes').select('*').eq('id', id).single(); q = r.data; }
  if(!q){ toast('Orçamento não encontrado'); return; }
  const body = document.getElementById('quote-snapshot-body');
  if(!body) return;
  const snap = q.scope_snapshot;
  const data = snap || buildQuoteSnapshot(q);
  const qd = data.quote_data || q.quote_data;
  let h = '';
  if(snap){
    h += '<div style="background:rgba(46,196,182,.1);border:1px solid rgba(46,196,182,.3);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--ink);line-height:1.5;">'
      + '🔒 Escopo congelado na aprovação'+(q.approved_at?' — '+new Date(q.approved_at).toLocaleString('pt-BR'):'')+'. Esta é a referência acordada com o cliente.'
      + '</div>';
  } else {
    h += '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Orçamento ainda não aprovado — o escopo pode mudar até a aprovação.</div>';
  }
  const row = (k,v)=> v ? '<div style="display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;"><span style="color:var(--muted);">'+k+'</span><span style="font-weight:600;text-align:right;">'+escapeHtml(String(v))+'</span></div>' : '';
  h += row('Serviço', data.service_type || data.title);
  h += row('Área', data.area_m2 ? data.area_m2+' m²' : '');
  h += row('Endereço', data.address);
  h += row('Descrição', data.description);
  h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0 4px;"><span style="font-size:14px;font-weight:700;">TOTAL</span><span style="font-size:20px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">R$ '+(+data.price||0).toLocaleString('pt-BR')+'</span></div>';
  if(qd && Array.isArray(qd.itens) && qd.itens.length){
    h += '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:14px 0 6px;">Itens</div>';
    h += qd.itens.map(it=>'<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>'+escapeHtml(it.desc||'')+'</span><span style="color:var(--muted);white-space:nowrap;">'+escapeHtml(it.valor||'')+'</span></div>').join('');
  }
  if(qd && Array.isArray(qd.pagamento) && qd.pagamento.length){
    h += '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:14px 0 6px;">Pagamento</div>';
    h += qd.pagamento.map(p=>'<div style="font-size:12px;color:var(--ink);margin-bottom:3px;">• '+escapeHtml(p)+'</div>').join('');
  }
  if(q.approval_note){
    h += '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:14px 0 6px;">Observação da aprovação</div>';
    h += '<div style="font-size:12px;color:var(--ink);">'+escapeHtml(q.approval_note)+'</div>';
  }
  body.innerHTML = h;
  showModal('quote-snapshot-modal');
}

// ══════════════════════════════════════════
// FEATURE 2 — MINI-CRM DE FOLLOW-UP (reativar clientes)
// O sistema RASCUNHA, o pintor DISPARA. Nunca disparo automático.
// Recurso PRO. Consentimento (LGPD) é cidadão de primeira classe.
// ══════════════════════════════════════════

let _crmCache = [];
let _crmIntervalMonths = 12;

// Normaliza nome de cliente para dedup (lowercase + trim + colapsa espaços).
function crmNormName(s){
  return String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
}

// Meses inteiros entre uma data e hoje.
function crmMonthsSince(dateStr){
  if(!dateStr) return null;
  const d = new Date(dateStr);
  if(isNaN(d.getTime())) return null;
  const now = new Date();
  let m = (now.getFullYear()-d.getFullYear())*12 + (now.getMonth()-d.getMonth());
  if(now.getDate() < d.getDate()) m -= 1;
  return Math.max(0, m);
}

async function loadCrm(){
  const sb = getSupabase();
  const container = document.getElementById('crm-list');
  if(!container) return;
  if(!sb || !currentUser){ container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Faça login para usar o CRM.</div>'; return; }

  // a. Gating PRO.
  await refreshProStatus();
  if(!_isPro){
    container.innerHTML = '<div style="text-align:center;padding:50px 24px;color:var(--muted);">'
      + '<div style="font-size:44px;margin-bottom:12px;">🔁</div>'
      + '<div style="font-size:16px;font-weight:800;color:var(--ink);margin-bottom:8px;">Reativar clientes é PRO</div>'
      + '<div style="font-size:13px;line-height:1.5;margin-bottom:18px;">Recupere clientes antigos com lembretes de repintura e manutenção. O Seu Zé escreve a mensagem, você revisa e envia.</div>'
      + '<button onclick="showModal(\'pro-modal\')" style="padding:12px 26px;background:var(--p1);color:#fff;border:none;border-radius:11px;font-size:14px;font-weight:800;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ativar PRO</button>'
      + '</div>';
    return;
  }

  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Sincronizando seus clientes...</div>';

  try {
    // Intervalo de follow-up do perfil.
    const { data: prof } = await sb.from('profiles').select('followup_interval_months').eq('id', currentUser.id).single();
    _crmIntervalMonths = (prof && prof.followup_interval_months) ? prof.followup_interval_months : 12;

    // b. Sync — a lista se monta sozinha a partir de jobs + quotes.
    const [jobsRes, quotesRes] = await Promise.all([
      sb.from('jobs').select('*').eq('painter_id', currentUser.id),
      sb.from('quotes').select('*').eq('painter_id', currentUser.id).in('status', ['aprovado','em_execucao','concluido'])
    ]);
    const jobs = jobsRes.data || [];
    const quotes = quotesRes.data || [];

    const map = {}; // key -> cliente derivado
    const keyFor = (clientUserId, name) => clientUserId ? ('u:'+clientUserId) : ('n:'+crmNormName(name));
    const touch = (key, name) => {
      if(!map[key]) map[key] = {
        client_user_id:null, client_name:name||'Cliente', client_phone:null,
        is_app_user:false, followup_optin:false, last_service_at:null,
        last_service_desc:null, total_value:0
      };
      return map[key];
    };
    const bumpDate = (c, dateStr, desc) => {
      if(!dateStr) return;
      const d = new Date(dateStr);
      if(isNaN(d.getTime())) return;
      const iso = d.toISOString().slice(0,10);
      if(!c.last_service_at || iso > c.last_service_at){ c.last_service_at = iso; c.last_service_desc = desc || c.last_service_desc; }
    };

    jobs.forEach(j => {
      const name = j.client_name || 'Cliente';
      const c = touch(keyFor(null, name), name);
      bumpDate(c, j.scheduled_date || j.created_at, j.service_type);
      c.total_value += (+j.revenue || 0);
    });

    quotes.forEach(q => {
      const cuid = q.client_id || null;
      const name = q.client_name || 'Cliente';
      const c = touch(keyFor(cuid, name), name);
      if(cuid){ c.client_user_id = cuid; c.is_app_user = true; }
      if(q.client_phone && !c.client_phone) c.client_phone = q.client_phone;
      if(q.client_followup_optin) c.followup_optin = true;
      bumpDate(c, q.approved_at || q.created_at, q.service_type || q.title);
      c.total_value += (+q.price || 0);
    });

    const derived = Object.values(map).filter(c => c.client_name);

    // Upsert idempotente: limpa os crm_clients do pintor e re-insere o derivado.
    await sb.from('crm_clients').delete().eq('painter_id', currentUser.id);
    if(derived.length){
      const rows = derived.map(c => ({
        painter_id: currentUser.id,
        client_user_id: c.client_user_id,
        client_name: c.client_name,
        client_phone: c.client_phone,
        is_app_user: c.is_app_user,
        followup_optin: c.followup_optin,
        optin_source: c.followup_optin ? 'quote_approval' : null,
        last_service_at: c.last_service_at,
        last_service_desc: c.last_service_desc,
        total_value: c.total_value
      }));
      const { data: ins } = await sb.from('crm_clients').insert(rows).select('*');
      _crmCache = ins || [];
    } else {
      _crmCache = [];
    }
    renderCrm();
  } catch(e){
    console.error('loadCrm:', e && e.message || e);
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Erro ao carregar o CRM.</div>';
  }
}

function renderCrm(){
  const container = document.getElementById('crm-list');
  if(!container) return;
  const clients = _crmCache || [];

  // Config: intervalo de follow-up.
  let html = '<div style="background:var(--white);border-radius:14px;padding:13px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:14px;">'
    + '<div style="font-size:13px;font-weight:700;color:var(--ink);margin-bottom:8px;">Lembrar clientes após</div>'
    + '<div style="display:flex;align-items:center;gap:8px;">'
    +   '<input id="crm-interval" type="number" min="1" max="120" value="'+_crmIntervalMonths+'" style="width:80px;padding:9px;border:1px solid var(--border);border-radius:9px;font-size:14px;font-family:\'DM Sans\',sans-serif;">'
    +   '<span style="font-size:13px;color:var(--muted);">meses sem serviço</span>'
    +   '<button onclick="saveCrmInterval()" style="margin-left:auto;padding:9px 16px;background:var(--p1);color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Salvar</button>'
    + '</div></div>';

  if(clients.length === 0){
    html += '<div style="text-align:center;padding:40px 24px;color:var(--muted);">'
      + '<div style="font-size:40px;margin-bottom:10px;">🔁</div>'
      + '<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum cliente ainda</div>'
      + '<div style="font-size:13px;line-height:1.5;">Conforme você fecha orçamentos e cadastra trabalhos na agenda, seus clientes aparecem aqui automaticamente.</div>'
      + '</div>';
    container.innerHTML = html;
    return;
  }

  const dueList = [];
  const restList = [];
  clients.forEach(c => {
    const m = crmMonthsSince(c.last_service_at);
    if(m !== null && m >= _crmIntervalMonths) dueList.push(c); else restList.push(c);
  });

  if(dueList.length){
    html += '<div style="font-size:13px;font-weight:700;color:var(--p4);text-transform:uppercase;letter-spacing:.5px;margin:6px 0 10px;">Para contatar · '+dueList.length+'</div>';
    html += dueList.map(renderCrmCard).join('');
  }
  if(restList.length){
    html += '<div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 10px;">Todos os clientes · '+restList.length+'</div>';
    html += restList.map(renderCrmCard).join('');
  }
  container.innerHTML = html;
}

function renderCrmCard(c){
  const m = crmMonthsSince(c.last_service_at);
  const ago = m === null ? 'sem serviço registrado'
    : (m === 0 ? 'último serviço neste mês' : 'último serviço há '+m+(m===1?' mês':' meses'));
  const total = (+c.total_value||0) > 0 ? 'R$ ' + (+c.total_value).toLocaleString('pt-BR') : '—';
  const phoneDigits = String(c.client_phone||'').replace(/\D/g,'');
  const hasPhone = phoneDigits.length >= 10;

  // Badge de canal.
  let badge;
  let canSend = false;
  let reason = '';
  if(c.is_app_user && c.client_user_id){
    badge = '<span style="font-size:10px;font-weight:700;color:#3a86ff;background:rgba(58,134,255,.1);padding:2px 7px;border-radius:20px;">Cliente do app</span>';
    canSend = true;
  } else if(hasPhone && c.followup_optin){
    badge = '<span style="font-size:10px;font-weight:700;color:#16a34a;background:rgba(22,163,74,.12);padding:2px 7px;border-radius:20px;">WhatsApp</span>';
    canSend = true;
  } else {
    badge = '<span style="font-size:10px;font-weight:700;color:var(--muted);background:var(--cream);padding:2px 7px;border-radius:20px;">Sem contato</span>';
    reason = !hasPhone ? 'sem telefone' : 'cliente sem opt-in';
  }

  const btn = (label,fn,bg,color,disabled)=>'<button '+(disabled?'disabled ':'')+'onclick="'+(disabled?'':fn)+'" style="flex:1;padding:9px;background:'+bg+';color:'+(color||'#fff')+';border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:'+(disabled?'not-allowed':'pointer')+';opacity:'+(disabled?'.5':'1')+';font-family:\'DM Sans\',sans-serif;">'+label+'</button>';

  const sendBtn = canSend
    ? btn('Enviar', "crmSend('"+c.id+"')", 'var(--p1)')
    : btn('Enviar', '', 'var(--cream)', 'var(--muted)', true);

  let reasonLine = '';
  if(reason){
    reasonLine = '<div style="font-size:11px;color:var(--p4);margin-bottom:8px;">⚠️ Não dá para enviar — '+reason+'.</div>';
  }

  return '<div style="background:var(--white);border-radius:14px;padding:13px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:9px;">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">'
    +   '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--ink);">'+escapeHtml(c.client_name||'Cliente')+'</div>'
    +   '<div style="font-size:12px;color:var(--muted);">'+escapeHtml(ago)+'</div></div>'
    +   badge
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:var(--muted);">'
    +   '<span>Total histórico: <strong style="color:var(--ink);">'+total+'</strong></span>'
    + '</div>'
    + reasonLine
    + '<textarea id="crm-msg-'+c.id+'" placeholder="Mensagem de reativação — gere com o Seu Zé ou escreva aqui..." style="width:100%;min-height:64px;padding:9px;border:1px solid var(--border);border-radius:9px;font-size:13px;font-family:\'DM Sans\',sans-serif;resize:vertical;margin-bottom:9px;box-sizing:border-box;"></textarea>'
    + '<div style="display:flex;gap:7px;">'
    +   btn('Gerar mensagem (Seu Zé)', "crmDraft('"+c.id+"')", 'var(--cream)', 'var(--ink)')
    +   sendBtn
    + '</div>'
    + '</div>';
}

async function saveCrmInterval(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const input = document.getElementById('crm-interval');
  if(!input) return;
  let v = parseInt(input.value, 10);
  if(isNaN(v) || v < 1) v = 1;
  if(v > 120) v = 120;
  const { error } = await sb.from('profiles').update({ followup_interval_months: v }).eq('id', currentUser.id);
  if(handleSbError(error, 'Erro ao salvar')) return;
  _crmIntervalMonths = v;
  toast('Intervalo salvo ✅');
  renderCrm();
}

async function crmDraft(id){
  if (!gateProClient('Mensagem de reativação com Seu Zé')) return;
  const c = (_crmCache||[]).find(x => x.id === id);
  if(!c) return;
  const ta = document.getElementById('crm-msg-'+id);
  if(!ta) return;
  const months = crmMonthsSince(c.last_service_at);
  const prevPlaceholder = ta.placeholder;
  ta.placeholder = 'Gerando mensagem...';
  try {
    let painterName = '';
    try {
      const sb = getSupabase();
      const { data: prof } = await sb.from('profiles').select('name').eq('id', currentUser.id).single();
      painterName = (prof && prof.name) || '';
    } catch(e){}
    const { ok, data } = await apiPost('/api/crm-draft', {
      clientName: c.client_name || '',
      lastService: c.last_service_desc || '',
      monthsSince: months || 0,
      painterName: painterName
    });
    if(!ok || !data || !data.draft){ toast('Erro: '+((data && data.error) || 'não foi possível gerar')); ta.placeholder = prevPlaceholder; return; }
    ta.value = data.draft;
    ta.placeholder = prevPlaceholder;
    toast('Rascunho gerado — revise antes de enviar ✏️');
  } catch(e){
    console.error('crmDraft:', e && e.message || e);
    toast('Erro ao gerar mensagem');
    ta.placeholder = prevPlaceholder;
  }
}

// REGRA DE OURO: o sistema rascunha, o PINTOR dispara. Nunca automático.
async function crmSend(id){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const c = (_crmCache||[]).find(x => x.id === id);
  if(!c) return;
  const ta = document.getElementById('crm-msg-'+id);
  const msg = ta ? ta.value.trim() : '';
  if(!msg){ toast('Escreva ou gere a mensagem primeiro'); return; }

  const phoneDigits = String(c.client_phone||'').replace(/\D/g,'');
  const hasPhone = phoneDigits.length >= 10;

  try {
    if(c.is_app_user && c.client_user_id){
      // Cliente do app: notificação in-app.
      if(!(await appConfirm('Enviar este lembrete para '+(c.client_name||'o cliente')+' pelo app?', { okLabel:'Enviar' }))) return;
      await notify(c.client_user_id, 'followup', 'Lembrete do seu profissional', msg, null);
      await sb.from('follow_ups').insert({
        painter_id: currentUser.id, crm_client_id: c.id, message: msg,
        status:'sent', sent_at:new Date().toISOString(), channel:'app'
      });
      toast('Lembrete enviado pelo app ✅');
    } else if(hasPhone && c.followup_optin){
      // Externo com telefone E opt-in: abre WhatsApp, o pintor dispara.
      const phone = phoneDigits.length <= 11 ? '55'+phoneDigits : phoneDigits;
      window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg), '_blank', 'noopener,noreferrer');
      await sb.from('follow_ups').insert({
        painter_id: currentUser.id, crm_client_id: c.id, message: msg,
        status:'sent', sent_at:new Date().toISOString(), channel:'whatsapp'
      });
      toast('WhatsApp aberto — confirme o envio por lá 📲');
    } else {
      toast('Cliente sem opt-in ou sem telefone — não é possível enviar');
    }
  } catch(e){
    console.error('crmSend:', e && e.message || e);
    toast('Erro ao registrar o envio');
  }
}

async function startProCheckout(){
  const btn = document.getElementById('pro-cta-btn');
  try {
    const sb = getSupabase();
    if(!sb){ toast('Erro: Supabase indisponível'); return; }
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ toast('Faça login para assinar'); return; }
    if(btn){ btn.textContent = 'Abrindo pagamento...'; btn.disabled = true; }
    const { ok, data } = await apiPost('/api/checkout', {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.user_metadata?.name || ''
    });
    if(!ok || !data || !data.init_point){
      toast('Erro ao iniciar pagamento: ' + ((data && data.error) || 'tente novamente'));
      if(btn){ btn.textContent = 'Assinar Agora'; btn.disabled = false; }
      return;
    }
    window.location.href = data.init_point;
  } catch(e){
    console.error('startProCheckout:', e && e.message || e);
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
    const { ok, data } = await apiPost('/api/admin-moderate', { action: 'check' });
    if(!ok || !data) return;
    _isAdmin = !!data.admin;
    const link = document.getElementById('mod-queue-link');
    if(link) link.style.display = _isAdmin ? '' : 'none';
  } catch(e){ console.warn('checkAdminEntry:', e && e.message || e); }
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
      const cap = escapeHtml(p.caption || '');
      const mediaUrl = escapeHtml(p.media_url || '');
      const media = p.media_url
        ? (p.media_type === 'video'
            ? `<video src="${mediaUrl}" controls style="width:100%;border-radius:12px;max-height:260px;background:#000;"></video>`
            : `<img src="${mediaUrl}" style="width:100%;border-radius:12px;max-height:260px;object-fit:cover;">`)
        : '';
      return `<div style="background:var(--white);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:12px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">${escapeHtml(p.media_type||'post')} · ${new Date(p.created_at).toLocaleString('pt-BR')}</div>
        ${media}
        ${cap ? `<div style="font-size:13px;color:var(--ink);margin:8px 0;">${cap}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button onclick="modAction('${escapeJsArg(p.id)}','approve',this)" style="flex:1;padding:10px;border:none;border-radius:10px;background:#2ec4b6;color:#fff;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">Aprovar</button>
          <button onclick="modAction('${escapeJsArg(p.id)}','reject',this)" style="flex:1;padding:10px;border:none;border-radius:10px;background:#e63946;color:#fff;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">Rejeitar</button>
        </div>
      </div>`;
    }).join('');
  } catch(e){
    console.error('openModQueue:', e && e.message || e);
    if(list) list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Erro ao carregar.</div>';
  }
}

async function modAction(postId, action, btn){
  try {
    const card = btn?.closest('div[style*="background:var(--white)"]');
    if(btn){ btn.disabled = true; btn.textContent = '...'; }
    const { ok, data } = await apiPost('/api/admin-moderate', { action, postId });
    if(!ok || !data || !data.ok){ toast('Erro: ' + ((data && data.error) || 'falha')); if(btn){ btn.disabled=false; btn.textContent = action==='approve'?'Aprovar':'Rejeitar'; } return; }
    toast(action === 'approve' ? 'Post aprovado' : 'Post rejeitado');
    if(card) card.remove();
    if(typeof loadFeed === 'function') loadFeed();
  } catch(e){
    console.error('modAction:', e && e.message || e);
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

async function sendAiChat(textArg, speakReply){
  if (!gateProClient('Chat com o Seu Zé')) return;
  let text;
  if(textArg){
    text = String(textArg).trim();
  } else {
    const input = document.getElementById('ai-chat-input');
    text = input ? input.value.trim() : '';
    if(input) input.value = '';
  }
  if(!text) return;
  const msgsEl = document.getElementById('ai-chat-msgs');

  msgsEl.innerHTML += '<div style="display:flex;gap:8px;margin-bottom:12px;justify-content:flex-end;"><div style="background:var(--ink);color:#fff;border-radius:14px;padding:10px 14px;font-size:13px;max-width:85%;">'+escapeHtml(text)+'</div></div>';
  msgsEl.scrollTop = msgsEl.scrollHeight;

  const typingId = 'typing-' + Date.now();
  msgsEl.innerHTML += '<div id="'+typingId+'" style="display:flex;gap:8px;margin-bottom:12px;"><img src="img/seu-ze.webp" alt="Seu Zé" style="width:28px;height:28px;border-radius:50%;object-fit:cover;object-position:center top;background:#1a1a2e;flex-shrink:0;"><div style="background:var(--cream);border-radius:14px;padding:10px 14px;font-size:13px;color:var(--muted);max-width:85%;"><span style="display:inline-block;animation:typing 1.2s infinite;">•</span><span style="display:inline-block;animation:typing 1.2s infinite .15s;">•</span><span style="display:inline-block;animation:typing 1.2s infinite .3s;">•</span></div></div>';
  msgsEl.scrollTop = msgsEl.scrollHeight;

  let reply = null;
  let aiError = null;
  try {
    const { ok, data, error } = await apiPost('/api/chat-ai', { message: text, history: _aiChatHistory });
    if (ok && data && data.reply) reply = data.reply;
    else aiError = (data && data.error) || error;
  } catch(e) {
    aiError = String(e?.message || e);
  }

  if (!reply) {
    console.warn('chat-ai fallback:', aiError && aiError.message || aiError);
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
      else reply = 'Conexão com o Seu Zé falhou no momento. Tente novamente em alguns segundos.';
    }
    if (!/^(Sou o Seu Zé|Sou um assistente virtual)/i.test(reply)) {
      reply = 'Sou o Seu Zé (assistente virtual). Qualquer confirmação de informações ditas aqui eu recomendo checar com o representante da marca ou lojista que você escolher.\n\n' + reply;
    }
  } else {
    _aiChatHistory.push({ role: 'user', content: text });
    _aiChatHistory.push({ role: 'assistant', content: reply });
    if (_aiChatHistory.length > 20) _aiChatHistory = _aiChatHistory.slice(-20);
  }

  const typingEl = document.getElementById(typingId);
  if (typingEl) typingEl.remove();
  const formatted = escapeHtml(reply).replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  msgsEl.innerHTML += '<div style="display:flex;gap:8px;margin-bottom:12px;"><img src="img/seu-ze.webp" alt="Seu Zé" style="width:28px;height:28px;border-radius:50%;object-fit:cover;object-position:center top;background:#1a1a2e;flex-shrink:0;"><div style="background:var(--cream);border-radius:14px;padding:10px 14px;font-size:13px;color:var(--ink);max-width:85%;line-height:1.45;">'+formatted+'</div></div>';
  msgsEl.scrollTop = msgsEl.scrollHeight;
  if(speakReply && reply) falarSeuZe(reply);
}

// ══ MODO CONVERSAÇÃO POR VOZ COM O SEU ZÉ (PRO) ══
// Grava a fala → Whisper transcreve → manda no chat-ai → resposta do
// Seu Zé é falada de volta via OpenAI TTS.
let _aiVoiceRecorder = null;
let _aiVoiceChunks = [];
let _aiVoiceStream = null;
let _aiVoiceAutoStop = null;
let _aiVoiceAudio = null;

async function aiChatToggleVoice(){
  if(_aiVoiceRecorder && _aiVoiceRecorder.state === 'recording'){
    aiChatStopVoice();
    return;
  }
  // Se está tocando uma resposta, corta
  if(_aiVoiceAudio && !_aiVoiceAudio.paused){
    try { _aiVoiceAudio.pause(); } catch(e){}
    _aiVoiceAudio = null;
  }
  if (!gateProClient('Conversa por voz com o Seu Zé')) return;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ toast('Seu navegador não suporta gravação de áudio'); return; }
  if(typeof MediaRecorder === 'undefined'){ toast('Seu navegador não suporta MediaRecorder'); return; }
  try { _aiVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(e){ toast('Permissão de microfone negada'); return; }
  _aiVoiceChunks = [];
  try { _aiVoiceRecorder = new MediaRecorder(_aiVoiceStream); }
  catch(e){
    toast('Erro ao iniciar gravação: ' + e.message);
    if(_aiVoiceStream){ _aiVoiceStream.getTracks().forEach(t => t.stop()); _aiVoiceStream = null; }
    return;
  }
  _aiVoiceRecorder.ondataavailable = e => { if(e.data && e.data.size > 0) _aiVoiceChunks.push(e.data); };
  _aiVoiceRecorder.onstop = async () => {
    const mimeType = _aiVoiceRecorder.mimeType || 'audio/webm';
    const blob = new Blob(_aiVoiceChunks, { type: mimeType });
    if(_aiVoiceStream){ _aiVoiceStream.getTracks().forEach(t => t.stop()); _aiVoiceStream = null; }
    await aiChatHandleVoice(blob);
  };
  _aiVoiceRecorder.start();
  const btn = document.getElementById('ai-chat-mic-btn');
  if(btn){ btn.innerHTML = '⏹'; btn.style.background = '#c00'; btn.title = 'Parar e enviar'; }
  if(_aiVoiceAutoStop) clearTimeout(_aiVoiceAutoStop);
  _aiVoiceAutoStop = setTimeout(() => { if(_aiVoiceRecorder && _aiVoiceRecorder.state === 'recording') aiChatStopVoice(); }, 60000);
}

function aiChatStopVoice(){
  if(_aiVoiceRecorder && _aiVoiceRecorder.state === 'recording') _aiVoiceRecorder.stop();
  if(_aiVoiceAutoStop){ clearTimeout(_aiVoiceAutoStop); _aiVoiceAutoStop = null; }
  const btn = document.getElementById('ai-chat-mic-btn');
  if(btn){ btn.innerHTML = '🎤'; btn.style.background = 'linear-gradient(135deg,#8338ec,var(--p1))'; btn.title = 'Falar com o Seu Zé'; }
}

async function aiChatHandleVoice(blob){
  toast('Transcrevendo sua fala...');
  try {
    const fd = new FormData();
    fd.append('audio', blob, 'voice.webm');
    const { ok, data } = await apiPost('/api/transcribe', fd, { multipart: true });
    if(!ok || !data || !data.text){
      toast('Não consegui entender: ' + ((data && data.error) || 'tente de novo'));
      return;
    }
    await sendAiChat(data.text, true);
  } catch(e){
    toast('Erro: ' + (e.message || e));
  }
}

async function falarSeuZe(text){
  if(!text) return;
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 1500) })
    });
    if(!r.ok){
      console.warn('tts error: status', r.status);
      try { if(_aiVoiceAudio){ _aiVoiceAudio.pause(); } } catch(_) {}
      _aiVoiceAudio = null;
      if(r.status === 429){ try { toast(window.ERR ? window.ERR.RATE_LIMIT : 'Muitas tentativas.'); } catch(_) {} }
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    if(_aiVoiceAudio){ try { _aiVoiceAudio.pause(); } catch(e){} }
    _aiVoiceAudio = new Audio(url);
    _aiVoiceAudio.play().catch(e => console.warn('audio play:', e && e.message || e));
    _aiVoiceAudio.onended = () => { URL.revokeObjectURL(url); _aiVoiceAudio = null; };
  } catch(e){
    console.warn('falarSeuZe:', e && e.message || e);
    try { if(_aiVoiceAudio){ _aiVoiceAudio.pause(); } } catch(_) {}
    _aiVoiceAudio = null;
    try { toast(window.ERR ? window.ERR.NETWORK : 'Sem conexão.'); } catch(_) {}
  }
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
    const { ok, status, data } = await apiPost('/api/chat-ai', { message: prompt, history: [] });
    if(ok && data && data.reply){
      // Remove a linha de disclaimer do assistente, se vier
      let txt = String(data.reply).replace(/^\s*Sou (o Seu Zé|um assistente virtual)[^\n]*\n+/i, '').trim();
      if(obsEl) obsEl.value = txt;
      toast('Escopo sugerido pelo Seu Zé ✨');
    } else if(status === 503){
      await appAlert('A sugestão pelo Seu Zé ainda não está ativa: configure OPENAI_API_KEY ou GEMINI_API_KEY no Cloudflare Pages (Environment variables) e refaça o deploy.\n\nVocê pode preencher "Observações" manualmente e usar "Gerar Orçamento" normalmente.');
    } else {
      await appAlert('Não foi possível gerar o escopo agora.\n\n' + ((data && data.error) || ('HTTP ' + status)) + '\n\nTente novamente em instantes.');
    }
  } catch(e){
    await appAlert('Falha ao chamar o Seu Zé: ' + (e?.message || 'tente de novo'));
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = orig; }
  }
}

function gerarOrcamentoIA(){
  if (!gateProClient('Orçamento com Seu Zé')) return;
  const cliente = document.getElementById('ai-orc-cliente').value.trim() || 'Cliente';
  const servico = document.getElementById('ai-orc-servico').value;
  const area = parseFloat(document.getElementById('ai-orc-area').value) || 0;
  const comodos = parseInt(document.getElementById('ai-orc-comodos').value) || 0;
  const numDemaos = parseInt(document.getElementById('ai-orc-demaos').value) || 2;
  const fator = parseFloat(document.getElementById('ai-orc-condicao').value) || 1;
  const precoM2 = parseBRL(document.getElementById('ai-orc-preco').value);
  const obs = document.getElementById('ai-orc-obs').value.trim();
  const cobranca = (document.getElementById('ai-orc-cobranca')||{}).value || 'm2';
  const valorFechado = parseBRL((document.getElementById('ai-orc-valorfechado')||{}).value);
  const materialMode = (document.getElementById('ai-orc-material')||{}).value || 'incluso';
  const matInc = materialMode !== 'cliente';
  const extras = ((document.getElementById('ai-orc-extras')||{}).value || '').trim();
  const formaPgto = (document.getElementById('ai-orc-pgto')||{}).value || 'À vista';
  const parcelas = parseInt((document.getElementById('ai-orc-parcelas')||{}).value) || 0;
  const entrada = parseBRL((document.getElementById('ai-orc-entrada')||{}).value);
  const tiposPgto = [...document.querySelectorAll('#ai-orc-tipos input[type=checkbox]:checked')].map(c=>c.value);

  if(area <= 0){ toast('Informe a área em m²'); return; }
  if(cobranca === 'fechado'){
    if(valorFechado <= 0){ toast('Informe o valor fechado'); return; }
  } else if(precoM2 <= 0){ toast('Informe o valor por m²'); return; }

  // Cálculos
  const litros = Math.ceil((area * fator * numDemaos) / 11 * 1.1);
  const l18 = Math.ceil(litros / 18);
  const custoTinta = matInc ? l18 * 320 : 0; // estimativa R$320/galão 18L premium
  const custoMaoObra = cobranca === 'fechado' ? valorFechado : area * precoM2;
  const total = cobranca === 'fechado' ? valorFechado : (custoTinta + custoMaoObra);

  const pintorName = document.getElementById('myprofile-name')?.textContent || 'Pintor';
  const hoje = dateBR(new Date());

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
  if(matInc){
    itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Tinta premium ('+litros+'L ≈ '+l18+' galões 18L)</span><span style="font-weight:600;">R$ '+custoTinta.toLocaleString('pt-BR')+'</span></div>';
    itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Lixa, massa, selador, fita crepe</span><span style="color:var(--muted);">Incluso</span></div>';
  } else {
    itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Tinta e materiais</span><span style="color:var(--muted);">Por conta do cliente</span></div>';
  }
  if(extras){
    itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Extras: '+escapeHtml(extras)+'</span><span style="color:var(--muted);">Incluso</span></div>';
  }

  // Mão de obra / serviço
  const diasEstimados = Math.ceil(area / 40); // ~40m²/dia
  if(cobranca === 'fechado'){
    itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Serviço (preço fechado)</span><span style="font-weight:600;">R$ '+valorFechado.toLocaleString('pt-BR')+'</span></div>';
  } else {
    itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Mão de obra ('+area+'m² × R$'+precoM2+'/m²)</span><span style="font-weight:600;">R$ '+custoMaoObra.toLocaleString('pt-BR')+'</span></div>';
  }

  // Forma de pagamento
  const pgtoLines = [];
  pgtoLines.push('Forma: ' + formaPgto + (parcelas>1 ? ' ('+parcelas+'x)' : ''));
  if(entrada > 0) pgtoLines.push('Entrada/sinal: R$ ' + entrada.toLocaleString('pt-BR'));
  if(parcelas > 1){
    const base = Math.max(total - entrada, 0);
    pgtoLines.push(parcelas + 'x de R$ ' + (base/parcelas).toLocaleString('pt-BR',{maximumFractionDigits:2}));
  }
  if(tiposPgto.length) pgtoLines.push('Aceita: ' + tiposPgto.join(', '));
  let pgtoHtml = pgtoLines.map(l=>'<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• '+escapeHtml(l)+'</div>').join('');

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
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Forma de pagamento</div>
      <div style="margin-bottom:14px;">${pgtoHtml}</div>
      <div style="background:var(--cream);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:14px;font-weight:700;color:var(--ink);">TOTAL</div>
        <div style="font-size:22px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">R$ ${total.toLocaleString('pt-BR')}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button onclick="gerarPDFOrcamento()" style="flex:1;padding:12px;background:var(--p1);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">📄 Baixar PDF</button>
      <button onclick="compartilharOrcamento()" style="flex:1;padding:12px;background:var(--ink);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">📤 Enviar</button>
    </div>
    <button onclick="salvarOrcamento()" style="width:100%;margin-top:8px;padding:12px;background:#2ec4b6;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">💾 Salvar no Pipeline de orçamentos</button>
    <div id="ai-orc-materiais" style="margin-top:14px;"></div>
  `;

  // Save data for PDF
  const pItens = [];
  prepItems.forEach(item=>pItens.push({desc:item,valor:'Incluso'}));
  if(matInc){
    pItens.push({desc:'Tinta premium ('+litros+'L aprox. '+l18+' galoes 18L)',valor:'R$ '+custoTinta.toLocaleString('pt-BR')});
    pItens.push({desc:'Lixa, massa, selador, fita crepe',valor:'Incluso'});
  } else {
    pItens.push({desc:'Tinta e materiais',valor:'Por conta do cliente'});
  }
  if(extras) pItens.push({desc:'Extras: '+extras,valor:'Incluso'});
  if(cobranca === 'fechado') pItens.push({desc:'Servico (preco fechado)',valor:'R$ '+valorFechado.toLocaleString('pt-BR')});
  else pItens.push({desc:'Mao de obra ('+area+'m2 x R$'+precoM2+'/m2)',valor:'R$ '+custoMaoObra.toLocaleString('pt-BR')});
  _lastOrcData = {pintor:pintorName,cliente,servico,area,demaos:numDemaos,condicao:condicaoText,hoje,total,itens:pItens,obs:[obs,numDemaos+' demaos','Prazo: '+diasEstimados+' dias uteis','Garantia 1 ano'].filter(Boolean),pagamento:pgtoLines};

  const resultEl = document.getElementById('ai-orc-result');
  resultEl.innerHTML = resultHtml;
  resultEl.style.display = 'block';
  resultEl.scrollIntoView({ behavior: 'smooth' });
  loadMaterialSuggestions(litros);
}

async function compartilharOrcamento(){
  const doc = _buildOrcDoc();
  if(!doc){
    // Sem dados estruturados → compartilha o texto
    const text = document.getElementById('ai-orc-result')?.innerText || '';
    if(navigator.share){ navigator.share({ title:'Orçamento - QueroUmaCor', text }).catch(()=>{}); }
    else { navigator.clipboard.writeText(text).then(()=>toast('Orçamento copiado!')).catch(()=>toast('Erro ao copiar')); }
    return;
  }
  const file = new File([doc.output('blob')], 'orcamento-queroumacor.pdf', { type:'application/pdf' });
  try {
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title:'Orçamento - QueroUmaCor', text:'Segue o orçamento gerado no QueroUmaCor.' });
      return;
    }
  } catch(e){ if(e && e.name === 'AbortError') return; /* outros erros → cai pro download */ }
  // Navegador sem suporte a compartilhar arquivo → baixa o PDF
  doc.save('orcamento-queroumacor.pdf');
  toast('PDF salvo — anexe no WhatsApp para enviar.');
}

// ══ PDF GENERATION ══
let _lastOrcData = {};
// Monta o documento jsPDF do orçamento e o retorna (null se sem dados/lib)
function _buildOrcDoc(){
  if(typeof window.jspdf === 'undefined') return null;
  const d = _lastOrcData;
  if(!d || !(d.itens && d.itens.length) && !d.total) return null;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
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
  y+=6;
  // Forma de pagamento
  if(d.pagamento && d.pagamento.length){
    doc.setFont(undefined,'bold'); doc.setFontSize(10);
    doc.text('FORMA DE PAGAMENTO',15,y); y+=7;
    doc.setFont(undefined,'normal'); doc.setFontSize(9);
    d.pagamento.forEach(p=>{ doc.text('• '+p,15,y); y+=5; if(y>270){doc.addPage();y=20;} });
    y+=6;
  }
  // Total
  doc.setFillColor(245,240,235); doc.rect(10,y-4,190,18,'F');
  doc.setFont(undefined,'bold'); doc.setFontSize(14);
  doc.setTextColor(255,107,53);
  doc.text('TOTAL: R$ '+(d.total||0).toLocaleString('pt-BR'),105,y+7,{align:'center'});
  return doc;
}
function gerarPDFOrcamento(){
  const doc = _buildOrcDoc();
  if(!doc){ toast('Carregando PDF...'); return; }
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
      <button onclick="addToCart('${p.id}',1,'${escapeJsArg(p.name)}',${p.price||0})" style="margin-top:4px;padding:4px 8px;background:var(--ink);color:#fff;border:none;border-radius:6px;font-size:9px;font-weight:700;cursor:pointer;">+ Carrinho</button></div>
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
  await syncQuotesToJobs();
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
  const optimizeBtn = items.length>=2
    ? `<button onclick="otimizarDiaAgenda()" style="width:100%;padding:10px 12px;margin-bottom:10px;background:linear-gradient(135deg,#8338ec,var(--p1));color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:800;cursor:pointer;font-family:'DM Sans',sans-serif;">🗺️ Otimizar dia (PRO)</button><div id="agenda-day-suggest"></div>`
    : '';
  el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-weight:700;margin:6px 0;">${label} · ${items.length} projeto(s)</div>${optimizeBtn}` + items.map(j=>{
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
    revenue: parseBRL(document.getElementById('job-receita').value),
    material_cost: parseBRL(document.getElementById('job-custo').value),
    notes: document.getElementById('job-notas').value.trim()
  };
  if(!job.client_name){ toast('Informe o cliente'); return; }
  const { error } = await sb.from('jobs').insert(job);
  if(handleSbError(error)) return;
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

async function otimizarDiaAgenda(){
  if (!gateProClient('Otimizar dia com Seu Zé')) return;
  if(!_agSel){ toast('Selecione um dia'); return; }
  const dayJobs = (_agJobs||[]).filter(j=> j.scheduled_date && String(j.scheduled_date).slice(0,10)===_agSel);
  if(dayJobs.length<2){ toast('Precisa de 2+ obras no mesmo dia'); return; }
  const box = document.getElementById('agenda-day-suggest');
  if(box) box.innerHTML = `<div style="background:var(--cream);border:1px dashed var(--border);border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;color:var(--muted);">🤖 Otimizando rota com Seu Zé...</div>`;
  toast('Otimizando rota com Seu Zé...');
  try{
    const payload = {
      date: _agSel,
      jobs: dayJobs.map(j=>({
        id: String(j.id),
        client_name: j.client_name||'',
        address: j.address||'',
        scheduled_time: j.scheduled_time||''
      }))
    };
    const { ok, data } = await apiPost('/api/agenda-order', payload);
    if(!ok || !Array.isArray(data?.ordered_ids)){
      const msg = data?.error || 'Erro ao otimizar';
      if(box) box.innerHTML = `<div style="background:#fdecea;border:1px solid #e74c3c;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;color:#e74c3c;">${escapeHtml(msg)}</div>`;
      toast(msg);
      return;
    }
    const byId = {}; dayJobs.forEach(j=>{ byId[String(j.id)] = j; });
    const rows = data.ordered_ids.map((id,i)=>{
      const j = byId[String(id)]; if(!j) return '';
      return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.05);">
        <div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#8338ec,var(--p1));color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;color:var(--ink);">${escapeHtml(j.client_name||'')}${j.scheduled_time?` <span style="font-weight:500;color:var(--muted);">· ${escapeHtml(j.scheduled_time)}</span>`:''}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(j.address||'(sem endereço)')}</div>
        </div>
      </div>`;
    }).join('');
    const notes = typeof data.notes==='string' && data.notes.trim() ? data.notes.trim() : '';
    if(box){
      box.innerHTML = `<div style="background:var(--white);border:1.5px solid #8338ec;border-radius:12px;padding:12px;margin-bottom:10px;box-shadow:0 2px 8px rgba(131,56,236,.12);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:12px;font-weight:800;color:#8338ec;">🗺️ Ordem sugerida pelo Seu Zé</div>
          <button onclick="document.getElementById('agenda-day-suggest').innerHTML='';" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;line-height:1;padding:0 4px;">×</button>
        </div>
        ${rows}
        ${notes?`<div style="font-size:11px;color:var(--muted);margin-top:8px;font-style:italic;">${escapeHtml(notes)}</div>`:''}
        <div style="font-size:10px;color:var(--muted);margin-top:8px;background:var(--cream);padding:6px 8px;border-radius:8px;">⚠️ Sugestão baseada só no texto do endereço (não usa GPS). Confirme a rota no seu app de mapas.</div>
      </div>`;
    }
  }catch(e){
    console.warn('otimizarDiaAgenda:', e && e.message || e);
    if(box) box.innerHTML = `<div style="background:#fdecea;border:1px solid #e74c3c;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;color:#e74c3c;">Erro ao otimizar: ${escapeHtml(String(e?.message||e))}</div>`;
    toast('Erro ao otimizar');
  }
}

// ══ CHECKLIST DE OBRA ══
let _checklistItems = [];
let _checklistRowId = null;
let _checklistSaveQueue = Promise.resolve();
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

async function loadChecklist(){
  const sb = getSupabase();
  if(!sb || !currentUser){ _checklistItems = []; _checklistRowId = null; renderChecklist(); return; }
  try {
    const { data } = await sb.from('checklists').select('id, items')
      .eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(1);
    if(data && data.length){
      _checklistRowId = data[0].id;
      _checklistItems = Array.isArray(data[0].items) ? data[0].items : [];
    } else { _checklistRowId = null; _checklistItems = []; }
  } catch(e){ console.warn('loadChecklist:', e && e.message || e); _checklistItems = []; _checklistRowId = null; }
  renderChecklist();
}

// Salva no Supabase. Os saves são enfileirados para que o primeiro
// INSERT termine (e fixe _checklistRowId) antes do próximo, evitando
// criar linhas duplicadas em cliques rápidos.
function saveChecklist(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const snapshot = JSON.parse(JSON.stringify(_checklistItems));
  _checklistSaveQueue = _checklistSaveQueue.then(async () => {
    try {
      if(_checklistRowId){
        await sb.from('checklists').update({ items: snapshot })
          .eq('id', _checklistRowId).eq('user_id', currentUser.id);
      } else {
        const { data } = await sb.from('checklists')
          .insert({ user_id: currentUser.id, title: 'Checklist de Obra', items: snapshot })
          .select('id').single();
        if(data && data.id) _checklistRowId = data.id;
      }
    } catch(e){ console.warn('saveChecklist:', e && e.message || e); }
  }).catch(e => { console.warn('checklist save:', e && e.message || e); _checklistSaveQueue = Promise.resolve(); });
}

// ══ ANOTAÇÕES (notas do pintor) ══
let _editingNoteId = null;
function startEditNote(id){ _editingNoteId = id; loadNotes(); }
function cancelEditNote(){ _editingNoteId = null; loadNotes(); }
async function saveEditNote(id){
  const ta = document.getElementById('edit-note-'+id);
  const body = ta ? ta.value.trim() : '';
  if(!body){ toast('Escreva algo na anotação'); return; }
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const { error } = await sb.from('notes').update({ body }).eq('id', id).eq('user_id', currentUser.id);
  if(handleSbError(error)) return;
  _editingNoteId = null;
  toast('Anotação atualizada ✅');
  loadNotes();
}

async function loadNotes(){
  const sb = getSupabase();
  const list = document.getElementById('notes-list');
  if(!list) return;
  if(!sb || !currentUser){ list.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px;">Faça login para usar as anotações.</div>'; return; }
  list.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:16px;">Carregando...</div>';
  try {
    const { data, error } = await sb.from('notes').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false});
    if(error) throw error;
    const notes = data || [];
    if(!notes.length){
      list.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px;">Nenhuma anotação ainda. Escreva acima e toque em Salvar.</div>';
      return;
    }
    const _notesHdr = '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:4px 0 10px;">Anotações salvas ('+notes.length+')</div>';
    list.innerHTML = _notesHdr + notes.map(n => {
      const date = n.created_at ? new Date(n.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      if(n.id === _editingNoteId){
        return '<div style="background:var(--cream);border-radius:11px;padding:12px;margin-bottom:8px;">'
          + '<textarea id="edit-note-'+n.id+'" rows="3" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid var(--p1);border-radius:8px;font-size:13px;font-family:DM Sans,sans-serif;outline:none;resize:vertical;">'+escapeHtml(n.body||'')+'</textarea>'
          + '<div style="display:flex;gap:8px;margin-top:8px;">'
          +   '<button onclick="saveEditNote(\''+n.id+'\')" style="flex:1;padding:9px;background:var(--ink);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Salvar</button>'
          +   '<button onclick="cancelEditNote()" style="flex:1;padding:9px;background:var(--white);color:var(--ink);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Cancelar</button>'
          + '</div></div>';
      }
      return '<div style="background:var(--cream);border-radius:11px;padding:12px;margin-bottom:8px;">'
        + '<div style="font-size:13px;color:var(--ink);line-height:1.5;white-space:pre-wrap;">'+escapeHtml(n.body||'')+'</div>'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">'
        + '<span style="font-size:10px;color:var(--muted);">'+date+'</span>'
        + '<span style="font-size:11px;">'
        +   '<span onclick="startEditNote(\''+n.id+'\')" style="color:var(--ink);cursor:pointer;font-weight:600;margin-right:14px;">Editar</span>'
        +   '<span onclick="deletarNota(\''+n.id+'\')" style="color:var(--p4);cursor:pointer;font-weight:600;">Excluir</span>'
        + '</span>'
        + '</div></div>';
    }).join('');
  } catch(e){
    console.warn('loadNotes:', e && e.message || e);
    list.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px;">Erro ao carregar anotações.</div>';
  }
}

async function salvarNota(){
  const ctx = requireSession();
  if(!ctx) return;
  const sb = ctx.sb;
  const ta = document.getElementById('note-new');
  const body = ta ? ta.value.trim() : '';
  if(!body){ toast('Escreva algo na anotação'); return; }
  const { error } = await sb.from('notes').insert({ user_id: currentUser.id, body });
  if(handleSbError(error, 'Erro ao salvar')) return;
  if(ta) ta.value = '';
  toast('Anotação salva ✅');
  loadNotes();
}

async function deletarNota(id){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  if(!(await appConfirm('Excluir esta anotação?', { okLabel:'Excluir' }))) return;
  const { error } = await sb.from('notes').delete().eq('id', id).eq('user_id', currentUser.id);
  if(handleSbError(error)) return;
  toast('Anotação excluída');
  loadNotes();
}

// ══ GRAVAÇÃO DE ÁUDIO → TRANSCRIÇÃO (PRO) ══
// Grava até 5 min de áudio, manda pro Whisper e cola o texto na nota.
let _recMediaRecorder = null;
let _recChunks = [];
let _recStartTime = 0;
let _recTimerInterval = null;
const REC_MAX_MS = 5 * 60 * 1000;

async function iniciarGravacaoNota(){
  if (!gateProClient('Gravação por áudio')) return;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    toast('Seu navegador não suporta gravação de áudio'); return;
  }
  if(typeof MediaRecorder === 'undefined'){
    toast('Seu navegador não suporta MediaRecorder'); return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(e){ toast('Permissão de microfone negada'); return; }
  _recChunks = [];
  try { _recMediaRecorder = new MediaRecorder(stream); }
  catch(e){ toast('Erro ao iniciar gravação: ' + e.message); return; }
  _recMediaRecorder.ondataavailable = e => { if(e.data && e.data.size > 0) _recChunks.push(e.data); };
  _recMediaRecorder.onstop = async () => {
    const mimeType = _recMediaRecorder.mimeType || 'audio/webm';
    const blob = new Blob(_recChunks, { type: mimeType });
    stream.getTracks().forEach(t => t.stop());
    await transcreverAudio(blob);
  };
  _recMediaRecorder.start();
  _recStartTime = Date.now();
  const statusEl = document.getElementById('rec-status');
  if(statusEl) statusEl.style.display = 'block';
  const btn = document.getElementById('rec-audio-btn');
  if(btn) btn.disabled = true;
  _recTimerInterval = setInterval(() => {
    const elapsed = Date.now() - _recStartTime;
    const sec = Math.floor(elapsed / 1000);
    const t = document.getElementById('rec-timer');
    if(t) t.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    if(elapsed >= REC_MAX_MS) pararGravacaoNota();
  }, 250);
}

function pararGravacaoNota(){
  if(_recMediaRecorder && _recMediaRecorder.state === 'recording'){
    _recMediaRecorder.stop();
  }
  if(_recTimerInterval){ clearInterval(_recTimerInterval); _recTimerInterval = null; }
  const statusEl = document.getElementById('rec-status');
  if(statusEl) statusEl.style.display = 'none';
  const btn = document.getElementById('rec-audio-btn');
  if(btn) btn.disabled = false;
}

async function transcreverAudio(blob){
  toast('Transcrevendo áudio...');
  try {
    const fd = new FormData();
    fd.append('audio', blob, 'note.webm');
    const { ok, data } = await apiPost('/api/transcribe', fd, { multipart: true });
    if(!ok || !data || !data.text){
      toast('Erro: ' + ((data && data.error) || 'falha na transcrição'));
      return;
    }
    const ta = document.getElementById('note-new');
    if(ta){
      ta.value = (ta.value ? ta.value + '\n' : '') + data.text;
      ta.focus();
    }
    toast('Áudio transcrito ✅');
  } catch(e){
    toast('Erro: ' + (e.message || e));
  }
}

// ══ FINANCEIRO / LUCRO ══
async function loadFinanceiro(){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  await syncQuotesToJobs();
  const { data: jobs } = await sb.from('jobs').select('*').eq('painter_id', currentUser.id).eq('status','concluido').order('created_at',{ascending:false});
  let receita=0, custos=0;
  (jobs||[]).forEach(j=>{ receita+=(+j.revenue||0); custos+=(+j.material_cost||0); });
  const lucro = receita - custos;
  document.getElementById('fin-receita').textContent='R$ '+receita.toLocaleString('pt-BR');
  document.getElementById('fin-custos').textContent='R$ '+custos.toLocaleString('pt-BR');
  document.getElementById('fin-lucro').textContent='R$ '+lucro.toLocaleString('pt-BR');

  // Gráfico resumo (barras)
  const chartEl = document.getElementById('fin-chart');
  if(chartEl){
    const max = Math.max(receita, custos, Math.abs(lucro), 1);
    const bar = (label,val,color)=>{
      const pct = Math.max(2, Math.round(Math.abs(val)/max*100));
      return '<div style="margin-bottom:8px;">'
        + '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:3px;"><span>'+label+'</span><span style="font-weight:700;color:var(--ink);">R$ '+val.toLocaleString('pt-BR')+'</span></div>'
        + '<div style="background:var(--border);border-radius:6px;height:10px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:6px;"></div></div></div>';
    };
    chartEl.innerHTML = '<div style="background:var(--white);border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);">'
      + '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Resumo</div>'
      + bar('Receita', receita, '#2ec4b6')
      + bar('Gasto', custos, '#e63946')
      + bar('Lucro', lucro, 'var(--p1)')
      + '<div style="font-size:11px;color:var(--muted);margin-top:6px;">'+(jobs?jobs.length:0)+' lançamento(s)</div>'
      + '</div>';
  }

  const listEl = document.getElementById('fin-jobs-list');
  if(jobs && jobs.length>0){
    listEl.style.textAlign='left'; listEl.style.padding='0';
    listEl.innerHTML = jobs.map(j=>{
      const lc = (+j.revenue||0)-(+j.material_cost||0);
      return '<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);">'
        + '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:var(--ink);">'+escapeHtml(j.service_type||'Projeto')+'</div>'
        + '<div style="font-size:11px;color:var(--muted);">'+escapeHtml(j.client_name||'-')+' · Receb. R$ '+(+j.revenue||0).toLocaleString('pt-BR')+' · Gasto R$ '+(+j.material_cost||0).toLocaleString('pt-BR')+'</div></div>'
        + '<div style="font-weight:800;font-size:13px;color:'+(lc>=0?'#2ec4b6':'#e63946')+';white-space:nowrap;">R$ '+lc.toLocaleString('pt-BR')+'</div>'
        + '<button onclick="deleteFinEntry(\''+j.id+'\')" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:2px 6px;">×</button>'
        + '</div>';
    }).join('');
  } else {
    listEl.style.textAlign='center'; listEl.style.padding='12px';
    listEl.innerHTML = 'Nenhum lançamento';
  }
}

async function salvarFinEntry(){
  const sb = getSupabase(); if(!sb||!currentUser){ toast('Faça login'); return; }
  const nome = (document.getElementById('fin-nome').value||'').trim();
  const cliente = (document.getElementById('fin-cliente').value||'').trim();
  const recebido = parseBRL(document.getElementById('fin-recebido').value);
  const gasto = parseBRL(document.getElementById('fin-gasto').value);
  if(!nome && !cliente){ toast('Informe o nome do projeto ou cliente'); return; }
  if(recebido<=0 && gasto<=0){ toast('Informe um valor recebido ou gasto'); return; }
  const today = new Date(); const ymd = new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const { error } = await sb.from('jobs').insert({
    painter_id: currentUser.id,
    client_name: cliente || '-',
    service_type: nome || 'Projeto',
    revenue: recebido,
    material_cost: gasto,
    status: 'concluido',
    scheduled_date: ymd,
    notes: 'Lançamento financeiro'
  });
  if(handleSbError(error)) return;
  document.getElementById('fin-nome').value='';
  document.getElementById('fin-cliente').value='';
  document.getElementById('fin-recebido').value='';
  document.getElementById('fin-gasto').value='';
  toast('Lançamento adicionado!');
  loadFinanceiro();
}

async function deleteFinEntry(id){
  if(!(await appConfirm('Excluir este lançamento?', { okLabel:'Excluir' }))) return;
  const sb = getSupabase(); if(!sb||!currentUser) return;
  await sb.from('jobs').delete().eq('id',id).eq('painter_id',currentUser.id);
  loadFinanceiro();
}

// Análise IA do mês — PRO. Agrega últimos 30 dias vs 30 dias anteriores e
// pede ao backend (gpt-4o-mini) um parecer curto e acionável.
async function analisarFinanceiroIA(){
  if (!gateProClient('Análise do mês com Seu Zé')) return;
  const sb = getSupabase(); if(!sb||!currentUser){ toast('Faça login'); return; }
  const resultEl = document.getElementById('fin-ai-result');
  try {
    toast('Analisando com Seu Zé...');
    const now = Date.now();
    const d30 = new Date(now - 30*24*60*60*1000).toISOString();
    const d60 = new Date(now - 60*24*60*60*1000).toISOString();
    const { data: jobs, error } = await sb.from('jobs')
      .select('service_type,revenue,material_cost,created_at')
      .eq('painter_id', currentUser.id)
      .eq('status','concluido')
      .gte('created_at', d60)
      .order('created_at',{ascending:false});
    if(error) throw error;

    const inThis = [], inLast = [];
    (jobs||[]).forEach(j=>{
      const t = new Date(j.created_at).getTime();
      if(t >= now - 30*24*60*60*1000) inThis.push(j);
      else if(t >= now - 60*24*60*60*1000) inLast.push(j);
    });
    const agg = arr => {
      let receita=0, custos=0;
      arr.forEach(j=>{ receita+=(+j.revenue||0); custos+=(+j.material_cost||0); });
      return { receita, custos, lucro: receita - custos, jobsCount: arr.length };
    };
    const thisMonth = agg(inThis);
    const lastMonth = agg(inLast);
    const recentJobs = inThis.slice(0,8).map(j=>({
      service_type: j.service_type || 'Projeto',
      revenue: +j.revenue || 0,
      material_cost: +j.material_cost || 0
    }));

    const { ok, data } = await apiPost('/api/fin-analysis', { thisMonth, lastMonth, recentJobs });
    if(!ok || !data || !data.analysis){
      toast('Erro: '+(data && data.error ? data.error : 'Seu Zé indisponível'));
      return;
    }

    if(resultEl){
      resultEl.style.display = 'block';
      resultEl.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
        + '<span style="font-size:18px;">🤖</span>'
        + '<span style="font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;background:linear-gradient(135deg,#8338ec,var(--p1));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#8338ec;">Análise do mês com Seu Zé · PRO</span>'
        + '</div>'
        + '<div style="font-size:13px;line-height:1.55;color:var(--ink);">'+escapeHtml(String(data.analysis))+'</div>';
    }
  } catch(e){
    console.warn('analisarFinanceiroIA:', e && e.message || e);
    toast('Erro ao analisar: '+(e && e.message ? e.message : 'tente novamente'));
  }
}

// ══ AUTO-RESPOSTAS ══
let _autoReplyCfg = null;          // cache da config new_message
const _autoRepliedConvs = new Set(); // evita loop/repeticao por conversa

function arToggle(el){
  const cb = el.querySelector('input[type=checkbox]');
  if(!cb) return;
  cb.checked = !cb.checked;
  el.classList.toggle('on', cb.checked);
}
function arSync(id){
  const cb = document.getElementById(id);
  if(!cb) return;
  const sw = cb.closest('.ar-switch');
  if(sw) sw.classList.toggle('on', !!cb.checked);
}

async function loadAutoRespostas(){
  const sb = getSupabase(); if(!sb||!currentUser) return;
  try {
    const { data } = await sb.from('auto_responses').select('trigger_type, message_template, is_active').eq('user_id', currentUser.id);
    const byT = {};
    (data||[]).forEach(r => { byT[r.trigger_type] = r; });
    const set = (id, on, msg, r) => {
      const onEl = document.getElementById(id+'-on');
      const msgEl = document.getElementById(id+'-msg');
      if(onEl && r) onEl.checked = !!r.is_active;
      if(msgEl && r && r.message_template) msgEl.value = r.message_template;
    };
    set('ar-quote', true, '', byT['new_quote']);
    set('ar-followup', true, '', byT['follow_up']);
    set('ar-msg', true, '', byT['new_message']);
    arSync('ar-quote-on'); arSync('ar-followup-on'); arSync('ar-msg-on');
  } catch(e){ console.warn('loadAutoRespostas:', e && e.message || e); }
}

async function maybeAutoReply(m){
  try {
    if(!currentUser || !m || !m.sender_id || m.sender_id === currentUser.id) return;
    if(_autoRepliedConvs.has(m.conversation_id)) return;
    const sb = getSupabase(); if(!sb) return;
    if(_autoReplyCfg === null){
      const { data } = await sb.from('auto_responses').select('message_template, is_active').eq('user_id', currentUser.id).eq('trigger_type','new_message').maybeSingle();
      _autoReplyCfg = data || { is_active:false };
    }
    if(!_autoReplyCfg.is_active || !(_autoReplyCfg.message_template||'').trim()) return;
    _autoRepliedConvs.add(m.conversation_id);
    const txt = _autoReplyCfg.message_template.trim();
    const { error } = await sb.from('messages').insert({
      sender_id: currentUser.id,
      receiver_id: m.sender_id,
      conversation_id: m.conversation_id,
      content: txt,
      type: 'text'
    });
    if(error){ console.warn('auto-reply insert:', error.message); return; }
    const t = new Date();
    saveMsgLocal(m.conversation_id, { from:'me', content: txt, type:'text', time: t.getHours()+':'+(t.getMinutes()<10?'0':'')+t.getMinutes() });
    toast('Resposta automática enviada ⚡');
    if(currentChat === m.conversation_id) openChat(m.conversation_id);
    else loadChatList();
  } catch(e){ console.warn('maybeAutoReply:', e && e.message || e); }
}

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
  _autoReplyCfg = null; // recarrega config no proximo gatilho
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
    const avatar = avatarOf({ avatar_url: p.avatar_url, name: p.name||'P' });
    const stars = p.rating_avg ? '⭐ '+(+p.rating_avg).toFixed(1) : 'Sem avaliação';
    return `<div onclick="openUserProfile('${escapeJsArg(p.id)}')" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--white);border-radius:12px;margin-bottom:6px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.04);">
      <div style="width:28px;text-align:center;">${medal}</div>
      <img src="${escapeHtml(avatar)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
      <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${escapeHtml(p.name||'')}</div><div style="font-size:11px;color:var(--muted);">${p.tag?'@'+escapeHtml(p.tag):''} · ${escapeHtml((p.city||'')+', '+(p.state||''))}</div></div>
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
  // Botão de troca: liga só com 100+ pts; senão mostra quantos faltam
  const redeemBtn = document.getElementById('pts-redeem-btn');
  if(redeemBtn){
    if(saldo >= 100){
      redeemBtn.disabled = false;
      redeemBtn.style.opacity = '1';
      redeemBtn.style.cursor = 'pointer';
      redeemBtn.textContent = '⚡ Trocar 100 pts por 1 mês PRO';
    } else {
      redeemBtn.disabled = true;
      redeemBtn.style.opacity = '0.5';
      redeemBtn.style.cursor = 'not-allowed';
      redeemBtn.textContent = '⚡ Faltam ' + (100 - saldo) + ' pts pra liberar 1 mês PRO';
    }
  }
  const el = document.getElementById('pts-historico');
  if(!pts||pts.length===0) return;
  el.innerHTML = pts.map(p=>{
    const sign = p.type==='earned'?'+':'-';
    const color = p.type==='earned'?'#2ec4b6':'var(--p1)';
    return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>${escapeHtml(p.source||'')}</span><span style="color:${color};font-weight:700;">${sign}${p.amount} pts</span></div>`;
  }).join('');
}

// ══ TROCAR 100 PTS POR 1 MÊS PRO EXTRA ══
// Chama a RPC redeem_pro_with_points (SECURITY DEFINER) que valida o
// saldo, debita os pontos e estende o PRO em transação atômica no
// servidor — assim o cliente NÃO consegue mais bypassar fazendo
// UPDATE direto em profiles.is_pro pelo devtools.
async function trocarPontosPorPRO(){
  const ctx = requireSession('Faça login');
  if(!ctx) return;
  const sb = ctx.sb;
  const btn = document.getElementById('pts-redeem-btn');
  if(btn) btn.disabled = true;
  try {
    if(!(await appConfirm('Trocar 100 pts por 1 mês PRO extra?', { okLabel:'Trocar' }))){
      return;
    }
    const { data: newExp, error } = await sb.rpc('redeem_pro_with_points', { p_cost: 100 });
    if(error) throw error;
    if(typeof invalidateMyProfile === 'function') invalidateMyProfile();
    toast('1 mês PRO liberado! 🎉');
    loadPoints();
    if(typeof refreshProStatus === 'function') refreshProStatus();
  } catch(e){
    console.warn('trocarPontosPorPRO:', e && e.message || e);
    // Mensagens em português vêm direto do RAISE EXCEPTION da função
    toast('Erro: ' + (e.message || e));
  } finally {
    if(btn) btn.disabled = false;
  }
}

// ══ EARN POINTS HELPER (DEPRECATED) ══
// Mantido só como referência. Pontos agora são creditados via triggers
// SECURITY DEFINER no banco — não chame mais essa função. INSERT direto
// em points é bloqueado por policy (Bateria 3.2).
async function earnPoints(userId, amount, source, refId){
  console.warn('earnPoints() está deprecated — pontos são creditados via trigger no DB.');
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
  document.getElementById('orc-painter-id').value = painterId || '';
  const nameEl = document.getElementById('orc-painter-name');
  const avEl = document.getElementById('orc-painter-av');
  if(nameEl) nameEl.textContent = painterName || 'Profissional';
  if(avEl) avEl.src = avatarUrl(painterName||'Profissional');
  showScreen('orcamento');
}

// ══ MANIFESTAR INTERESSE EM OBRA ══
// Antes inseria uma row em orders com status='pending' eterno. Removido
// porque (a) não tinha fluxo de pagamento real, (b) admin malicioso podia
// marcar a order como 'paid' e disparar trigger de pontos. Hoje só
// notifica o artista; venda real vai usar fluxo MP quando existir.
async function comprarObra(postId, artistName, artistId, artType){
  if(!currentUser){ toast('Faça login pra falar com o artista'); return; }
  if(!(await appConfirm('Manifestar interesse em "'+artType+'" de '+artistName+'? O artista será notificado e entra em contato.', { okLabel:'Manifestar interesse' }))) return;
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
  }
}

function openChatWithUser(userId){
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

// ══ PUBLISH VIDEO (REELS) ══
// Updated publishPost to handle video media_type
// ══ CONTENT MODERATION ══
// Filtro local enxuto: só termos quase sempre problemáticos, com casamento
// por palavra inteira (\b…\b). Antes o substring bloqueava "armário"
// (arma), "pistolão" (pistola), "matar a sede" (matar), nome "Cornélio"
// (corno). Contexto fica pra IA decidir em /api/moderate.
const _blockedWords = [
  'pedofilia','pedofilo',
  'estupro','estuprar','estuprador',
  'cocaina','crackeira',
  'fuzil',
  'assassinar',
  'suicidio',
  'terrorismo','terrorista',
  'pornografia',
  'xxx',
  'nazismo'
];

const _blockedRe = (() => {
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alts = _blockedWords.map(w => esc(norm(w))).join('|');
  return new RegExp('\\b(' + alts + ')\\b', 'i');
})();

// Padrões fortes de scam: encurtadores e domínios típicos de golpe.
// URL normal (https://meusite.com.br, www.instagram.com/foo) NÃO bloqueia
// mais — autopromoção legítima de pintor passa, Gemini avalia contexto.
const _scamLinkRe = /(?:^|\W)(?:bit\.ly|tinyurl\.com|cutt\.ly|t\.me\/|goo\.gl\/|tiny\.cc|encurtador\.com\.br|is\.gd|shorturl\.at)/i;

function moderateContent(text){
  if(!text) return { approved: true, reason: null };
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const m = _blockedRe.exec(lower);
  if(m) return { approved: false, reason: 'blocked:' + m[1] };
  if(_scamLinkRe.test(lower)) return { approved: false, reason: 'link_suspicious' };
  return { approved: true, reason: null };
}

async function moderateContentAsync(text, imageUrl, hasMedia){
  const local = moderateContent(text || '');
  if (!local.approved) {
    // Palavra do hard-list → bloqueio total (não vai pro portal).
    // Encurtador suspeito → revisão humana (pode ser falso positivo).
    const sev = String(local.reason || '').startsWith('blocked:') ? 'hard' : 'soft';
    return { approved: false, reason: local.reason, severity: sev };
  }
  // Fail-safe: se há mídia (imagem/vídeo) e a moderação cair, vai pra revisão
  // humana em vez de publicar direto. Texto puro que passou no filtro local publica.
  const failSafe = hasMedia
    ? { approved: false, reason: 'mod_unavailable', severity: 'soft' }
    : { approved: true, reason: null };
  try {
    const sb = getSupabase();
    const { data:{ session } } = sb ? await sb.auth.getSession() : { data:{ session:null } };
    const { ok, data } = await apiPost('/api/moderate', {
      text: text || '',
      imageUrl: imageUrl || ''
    });
    if (!ok || !data) return failSafe;
    if (data.error || data.engine === 'failed') return failSafe;
    if (data.flagged) {
      return { approved: false, reason: 'ai:' + (data.reasons || []).join(','), severity: data.severity || 'soft' };
    }
    return { approved: true, reason: null };
  } catch(e){
    console.warn('moderateContentAsync fail-safe:', e && e.message || e);
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
  const _loaders = {'agenda-modal':loadAgenda,'agenda-add-modal':prefillNovoProjeto,'auto-resp-modal':loadAutoRespostas,'checklist-modal':loadChecklist,'lucro-modal':loadFinanceiro,'referral-modal':loadReferrals,'points-modal':loadPoints,'notes-modal':loadNotes};
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
  } catch(e){ console.warn('saveConvLocal err:', e && e.message || e); }
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
  } catch(e){ console.warn('saveMsgLocal err:', e && e.message || e); }
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
let calicolorsUserId = null;

let _searchNewChatToken = 0;
async function _searchNewChatUsersImpl(query){
  const container = document.getElementById('new-chat-users-list');
  if(!query || query.trim().length < 2){ container.innerHTML = ''; return; }
  const sb = getSupabase();
  if(!sb) return;
  const myToken = ++_searchNewChatToken;
  try {
    const q = query.replace('@','').trim().toLowerCase();
    const res = await sb.from('profiles').select('id, name, tag, avatar_url, role, user_type').limit(200);
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
  } catch(e){}
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
  chatData[convId].otherId = userId;

  // Load the other user's profile
  try {
    const { data: prof } = await sb.from('profiles').select('name, avatar_url, tag, role, user_type').eq('id', userId).single();
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
  } catch(e){}

  openChat(convId);
}

// ══ LOAD NOTIFICATIONS FROM SUPABASE ══
async function loadNotifications(){
  const sb = getSupabase();
  const container = document.getElementById('notif-list');
  if(!sb || !currentUser || !container) return;
  // Mark as read: clear badge
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
    try {
      const { data: notifRows } = await sb.from('notifications')
        .select('*').eq('user_id', myId).order('created_at', { ascending:false }).limit(20);
      (notifRows || []).forEach(nr => {
        notifs.push({ type:'app', appType:nr.type, name:nr.title||'QueroUmaCor', text:nr.body, time:nr.created_at, id:'n'+nr.id });
      });
    } catch(e){ /* tabela notifications pode não existir ainda */ }
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
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:'user_id=eq.'+myId }, payload => {
      const n = payload.new || {};
      updateNotifBadge(true);
      toast('🔔 ' + (n.title || 'Nova notificação'));
    })
    .subscribe();
}

// ══ PIPELINE AO VIVO — novo pedido aparece sem reabrir a tela ══
let _pipelineSub = null;
function setupPipelineSubscription(){
  if(_pipelineSub || !currentUser) return;
  const sb = getSupabase();
  if(!sb) return;
  _pipelineSub = sb.channel('pipeline-'+currentUser.id)
    .on('postgres_changes', { event:'*', schema:'public', table:'quotes', filter:'painter_id=eq.'+currentUser.id }, () => {
      const scr = document.getElementById('screen-pipeline');
      if(scr && scr.classList.contains('active')) loadPipeline();
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
    const statusLabels = { pending:'Aguardando', rascunho:'Rascunho', enviado:'Enviado', aprovado:'Aprovado', em_execucao:'Em execução', concluido:'Concluído', recusado:'Recusado', accepted:'Aceito', completed:'Concluido', rejected:'Rejeitado', processing:'Em andamento', shipped:'Enviado' };
    const statusClasses = { pending:'status-aguardando', rascunho:'status-aguardando', enviado:'status-respondido', aprovado:'status-concluido', em_execucao:'status-respondido', concluido:'status-concluido', recusado:'status-rejeitado', accepted:'status-respondido', completed:'status-concluido', rejected:'status-rejeitado', processing:'status-respondido', shipped:'status-concluido' };

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
      const name = other.name || 'Usuário';
      const avatar = avatarOf({ avatar_url: other.avatar_url, name: name });
      const st = statusLabels[q.status] || q.status || 'Pendente';
      const stClass = statusClasses[q.status] || 'status-aguardando';
      const date = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '';
      const price = q.price ? 'R$ '+Number(q.price).toLocaleString('pt-BR') : '';
      let qActions = '';
      if(isClient && q.status==='enviado'){
        qActions = '<div style="display:flex;gap:7px;margin-top:9px;">'
          + '<button onclick="aprovarQuoteCliente(\''+q.id+'\')" style="flex:1;padding:9px;background:#2ec4b6;color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Aprovar orçamento</button>'
          + '<button onclick="verSnapshot(\''+q.id+'\')" style="padding:9px 14px;background:var(--cream);color:var(--ink);border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ver</button>'
          + '</div>';
      } else if(['aprovado','em_execucao','concluido'].includes(q.status)){
        qActions = '<div style="margin-top:9px;"><button onclick="verSnapshot(\''+q.id+'\')" style="width:100%;padding:9px;background:var(--cream);color:var(--ink);border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ver escopo aprovado</button></div>';
      }
      html += '<div data-status="'+escapeHtml(q.status||'pending')+'" class="pedido-card">'
        + '<div class="pedido-head">'
        + '<div class="pedido-pav"><img src="'+escapeHtml(avatar)+'" alt=""></div>'
        + '<div><div class="pedido-painter">'+escapeHtml(name)+'</div><div class="pedido-tipo">'+escapeHtml(q.service_type||q.title||'Orcamento')+'</div></div>'
        + '<div class="pedido-status '+stClass+'">'+st+'</div>'
        + '</div>'
        + '<div class="pedido-meta">'+(price?'<span>'+price+'</span>':'')+'<span>'+date+'</span></div>'
        + qActions
        + '</div>';
    });
    container.innerHTML = html;
  } catch(e){
    console.error('loadPedidos error:', e && e.message || e);
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Erro ao carregar pedidos</div>';
  }
}

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
    const { data: prof } = await sb.from('profiles').select('name, tag, email, city, state, phone, specialties, avatar_url, role, user_type, business_logo_url').eq('id', currentUser.id).single();
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
      const { data: pr } = await sb.from('profiles').select('service_radius').eq('id', currentUser.id).single();
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

function openEditProfileAt(section){
  openEditProfile().then(() => {
    setTimeout(() => {
      const sheet = document.querySelector('#edit-profile-modal .sheet');
      if(section === 'specs'){
        const el = document.getElementById('ep-specs-wrap');
        if(el && sheet){ sheet.scrollTop = el.offsetTop - 16; }
        const list = document.getElementById('ep-specs-list');
        if(list && list.style.display === 'none') toggleEpSpecs();
      } else if(section === 'radius'){
        const el = document.getElementById('ep-radius-wrap');
        if(el && sheet){ sheet.scrollTop = el.offsetTop - 16; }
        const sel = document.getElementById('ep-radius');
        if(sel) sel.focus();
      }
    }, 80);
  });
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
  const { error } = await sb.from('profiles').update({ specialties: sel.join(', ') }).eq('id', currentUser.id);
  if(handleSbError(error)) return;
  if(typeof invalidateMyProfile === 'function') invalidateMyProfile();
  toast('Especialidades salvas ✅');
  closeModals();
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
      const { data: pr } = await sb.from('profiles').select('service_radius').eq('id', currentUser.id).single();
      if(pr && pr.service_radius != null) sel.value = pr.service_radius;
    } catch(e){}
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
  try {
    const { error } = await sb.from('profiles').update({ service_radius: valInt }).eq('id', currentUser.id);
    if(handleSbError(error)) return;
    if(typeof invalidateMyProfile === 'function') invalidateMyProfile();
    toast('Raio salvo ✅');
    closeModals();
  } catch(e){ toast('Erro: ' + (e.message || e)); }
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
  btn.textContent = 'Salvando...'; btn.disabled = true;
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
    const { data: existing } = await sb.from('profiles').select('id').eq('id', currentUser.id).single();
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
    console.warn('Invite validation error:', e && e.message || e);
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
  if(!name||name.includes('@')||!email||!pw){toast('Preencha nome, email e senha corretamente');return;}
  if(isProfessionalRole(role)){
    const selSpecs = document.querySelectorAll('#spec-grid .spec-chip.sel').length;
    if(selSpecs === 0){ toast('Selecione pelo menos uma especialidade'); return; }
  }

  // Mark invite as used
  if(validatedInviteCode && validatedInviteCode.id){
    try {
      const sb = getSupabase();
      await sb.from('invites').update({ uses: (validatedInviteCode.uses||0)+1 }).eq('id', validatedInviteCode.id);
    } catch(e){ console.warn('Could not update invite:', e && e.message || e); }
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
        console.error('sendChatMsg error:', error.message);
        toast('Erro ao enviar: ' + error.message);
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
let _avaliarQuotes = [];
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
      .in('status', ['concluido','completed','accepted'])
      .order('created_at', { ascending: false })
      .limit(10);
    if(error) throw error;
    _avaliarQuotes = quotes || [];
    if(!quotes || quotes.length === 0){
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:40px;margin-bottom:12px;">⭐</div><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum serviço para avaliar</div><div style="font-size:13px;">Quando um orçamento for concluído, você poderá avaliar aqui</div></div>';
      if(form) form.style.display = 'none';
      return;
    }
    // Show the first/most recent service to evaluate
    const q = quotes[0];
    const painter = q.painter || {};
    avaliarQuoteId = q.id;
    const avatar = avatarOf({ avatar_url: painter.avatar_url, name: painter.name||'P' });
    document.getElementById('avaliar-av-img').src = avatar;
    document.getElementById('avaliar-title').textContent = painter.name || 'Pintor';
    document.getElementById('avaliar-sub').textContent = (q.service_type||q.title||'Servico') + (painter.city ? ' · '+painter.city : '') + (q.area_m2 ? ' · '+q.area_m2+'m²' : '');
    container.innerHTML = '';
    if(form) form.style.display = 'block';
    // Show other services as selectable list if > 1
    if(quotes.length > 1) renderAvaliarServiceList();
  } catch(e){
    console.error('loadAvaliarScreen error:', e && e.message || e);
    container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum serviço para avaliar</div><div style="font-size:13px;">Solicite um orçamento primeiro</div></div>';
    if(form) form.style.display = 'none';
  }
}

function renderAvaliarServiceList(){
  const container = document.getElementById('avaliar-service-container');
  if(!container || _avaliarQuotes.length < 2) return;
  container.innerHTML = '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Selecione o serviço</div>' +
    _avaliarQuotes.map(qq => {
      const pp = qq.painter || {};
      const sel = qq.id === avaliarQuoteId;
      return '<div onclick="selectAvaliarService(\''+qq.id+'\')" style="padding:10px;background:'+(sel?'var(--cream)':'var(--white)')+';border-radius:10px;margin-bottom:6px;cursor:pointer;border:1px solid '+(sel?'var(--p1)':'var(--border)')+';font-size:13px;"><b>'+escapeHtml(pp.name||'Pintor')+'</b> — '+escapeHtml(qq.service_type||qq.title||'Serviço')+'</div>';
    }).join('');
}

function selectAvaliarService(quoteId){
  const q = _avaliarQuotes.find(x => x.id === quoteId);
  if(!q) return;
  avaliarQuoteId = q.id;
  const painter = q.painter || {};
  const avatar = avatarOf({ avatar_url: painter.avatar_url, name: painter.name||'P' });
  const av = document.getElementById('avaliar-av-img'); if(av) av.src = avatar;
  const tt = document.getElementById('avaliar-title'); if(tt) tt.textContent = painter.name || 'Pintor';
  const sb2 = document.getElementById('avaliar-sub');
  if(sb2) sb2.textContent = (q.service_type||q.title||'Serviço') + (painter.city ? ' · '+painter.city : '') + (q.area_m2 ? ' · '+q.area_m2+'m²' : '');
  renderAvaliarServiceList();
}

async function submitAvaliacao(){
  if(!starVal){toast('Selecione uma nota primeiro!');return;}
  const ctx = requireSession('Faca login primeiro');
  if(!ctx) return;
  const sb = ctx.sb;
  const criteria = [];
  document.querySelectorAll('.criteria-chip.sel').forEach(c => criteria.push(c.textContent.trim()));
  const comment = document.getElementById('avalia-ta')?.value.trim() || '';
  try {
    // Usa a RPC submit_review (SECURITY DEFINER) — valida no servidor:
    // quote pertence ao caller, rating 1-5, sem duplicata
    const { error } = await sb.rpc('submit_review', {
      p_quote_id: avaliarQuoteId || null,
      p_painter_id: null,
      p_rating: starVal,
      p_comment: comment || null,
      p_criteria: criteria
    });
    if(error) throw error;
    toast('Avaliacao enviada! '+starLabels[starVal]);
    starVal = 0;
    document.querySelectorAll('.star-btn').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.criteria-chip.sel').forEach(c => c.classList.remove('sel'));
    if(document.getElementById('avalia-ta')) document.getElementById('avalia-ta').value = '';
    setTimeout(()=>showScreen('myprofile'),1200);
  } catch(e){
    console.error('submitAvaliacao error:', e && e.message || e);
    toast('Erro ao enviar avaliacao: ' + (e.message || e));
  }
}

// ══ ORCAMENTO ══
function openOrcamento(){
  const p = painters[currentPainter];
  if(p){
    document.querySelector('.opc-name').innerHTML = escapeHtml(p.name||'') + (p.pro ? ' <span style="background:var(--ink);color:var(--p1);font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;">PRO</span>' : '');
    document.querySelector('.opc-av img').src = p.img || 'https://i.pravatar.cc/150?img=11';
    document.querySelector('.opc-stars').textContent = '★★★★★ ' + (p.rating || '5.0');
    document.querySelector('.opc-sub').textContent = p.city || '';
  }
  // store painter supabase_id for insert (will be filled if painter has profile in DB)
  document.getElementById('orc-painter-id').value = p && p.supabase_id ? p.supabase_id : '';
  showScreen('orcamento');
}
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
    console.error('sendOrc error:', error && error.message || error);
    toast('❌ Erro ao enviar: ' + (error.message || error));
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
let chatStoreAdded = false;

// Track which message IDs are already rendered to avoid duplicates
const renderedMsgIds = new Set();

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
  if(!session){ toast('Sessao expirada. Faca login novamente.'); return; }

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
    console.error('sendMsg error:', error.message);
    toast('Erro ao enviar: ' + error.message);
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
  // Prevent duplicate messages
  if(m.id && renderedMsgIds.has(m.id)) return;
  if(m.id) renderedMsgIds.add(m.id);
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
  const ctx = requireSession('Faca login primeiro');
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


// ══ MARKETPLACE ══
let cartCount = 0;
let cartItems = [];
let shirtQty = 1;
let logoState = {pintor: true, cali: true};
let mktProducts = [];

// Dicionário determinístico: cor escrita no nome → hex. Compostos primeiro.
const COLOR_DICT = [
  ['branco neve','#fbfbf7'],['branco gelo','#eef0ea'],['branco fosco','#f4f3ee'],['off white','#efece1'],['branco','#f6f5f0'],
  ['preto fosco','#1c1c1c'],['preto','#1a1a1a'],
  ['cinza chumbo','#4b4f54'],['cinza grafite','#3a3d40'],['grafite','#3a3d40'],['cinza claro','#c7c9c8'],['cinza escuro','#5a5d5f'],['cinza concreto','#9a9b96'],['concreto','#9a9b96'],['cinza','#9b9d9c'],['prata','#c5c7c9'],['aluminio','#b8bcc0'],
  ['azul claro','#9ec7e8'],['azul bebe','#bcd9ee'],['azul royal','#1f4ea1'],['azul marinho','#1b2a4a'],['azul petroleo','#1f5560'],['azul turquesa','#2bb6c4'],['turquesa','#2bb6c4'],['azul','#2f6fb0'],
  ['verde musgo','#5a6b3b'],['verde limao','#bcd64a'],['verde agua','#bfe3d8'],['verde bandeira','#1e7a3d'],['verde oliva','#6b6b3a'],['verde','#2e8b57'],
  ['amarelo ouro','#e0a526'],['amarelo canario','#f5d427'],['amarelo','#f2c531'],['ouro','#caa233'],['dourado','#caa233'],
  ['vermelho','#c0392b'],['vinho','#5e1f24'],['bordo','#5e1f24'],['carmim','#9b1c2e'],
  ['laranja','#e67e22'],['terracota','#b5562e'],['tijolo','#9c4a2f'],['salmao','#f0a78f'],
  ['rosa','#e79bb3'],['pink','#e84d8a'],['magenta','#c0337a'],
  ['roxo','#6b3fa0'],['lilas','#b9a5d6'],['violeta','#7a4fb0'],
  ['marrom','#6b4226'],['cafe','#4b3621'],['chocolate','#4b2e1e'],['caramelo','#a9743b'],['tabaco','#7a5230'],['imbuia','#5a3a22'],['mogno','#6e3326'],['cedro','#8a5a33'],['castanho','#5d3a22'],
  ['bege','#d8c6a8'],['areia','#d6c5a0'],['palha','#e3d5ad'],['creme','#efe6cf'],['nude','#e3c9b3'],['camurca','#c9a878'],['marfim','#efe7d2'],
  ['gelo','#eef0ea'],['perola','#ece7dd'],
];
function _normTxt(s){ return ' '+String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')+' '; }
// Cores "placeholder" que NÃO contam como cor escolhida de verdade
const _PLACEHOLDER_HEX = /^#?(c0622d|cccccc|ddd|dddddd|e8e2d9)$/i;
function resolveColorHex(p){
  const ch = p && p.color_hex ? String(p.color_hex).trim() : '';
  if(ch && !_PLACEHOLDER_HEX.test(ch.replace('#',''))) return ch;
  const n = _normTxt(p && p.name);
  for(const [k,hex] of COLOR_DICT){ if(n.includes(k)) return hex; }
  return ch || null;
}
function productBg(p){
  if(p && p.color_gradient) return 'linear-gradient(135deg,'+p.color_gradient+')';
  return resolveColorHex(p) || '#e8e2d9';
}
// true quando o produto tem cor (gradiente, hex real ou cor pelo nome) → mostrar swatch limpo, sem emoji
function hasProductColor(p){
  return !!(p && (p.color_gradient || resolveColorHex(p)));
}

// Mesma classificação automática do portal (marca/tipo no nome do produto).
// A ordem importa: o primeiro menu cuja palavra-chave casar vence.
const MKT_MENUS = [
  { key:'arte_urbana',  label:'🎨 Arte Urbana & Spray',   kw:['arte urbana','colorgin','spray','aerossol','aerosol','grafit','graffit'] },
  { key:'tintas',       label:'🪣 Tintas',                 kw:['tinta','esmalte','latex','látex','acrilic','acrílic','verniz','primer','seladora','fundo preparador','base coat','automotiva','suvinil','coral','sherwin'] },
  { key:'texturas',     label:'🧱 Texturas & Massas',      kw:['textura','grafiato','massa corrida','massa acrilic','massa pva','reboco','chapisco'] },
  { key:'epoxi',        label:'⚗️ Epóxi & Poliuretano',    kw:['epoxi','epóxi','poliuretano',' pu '] },
  { key:'solventes',    label:'💧 Solventes & Aditivos',   kw:['thinner','solvente','diluente','aguarras','aguarrás','acelerador','secante','catalisador','endurecedor','aditivo','redutor','removedor'] },
  { key:'adesivos',     label:'🧪 Adesivos & Colas',       kw:['adesivo','cola','silicone','vedante','veda calha','rejunte','massa epox','durepoxi'] },
  { key:'ferramentas',  label:'🧰 Ferramentas',            kw:['alicate','tesoura','chave','martelo','abre trinca','espatula','espátula','desempenadeira','colher de pedreiro','trena','serra','furadeira','broca','lixadeira','estilete','formao','formão','grosa','lima','torques'] },
  { key:'pintura',      label:'🖌️ Acessórios de Pintura',  kw:['rolo','pincel','trincha','bandeja','fita crepe','fita','lixa','cabo extensor','extensor','gaiola','luva','mascara','máscara','respirador','oculos','óculos','lona','plastico','plástico','crepe'] },
  { key:'eletrica',     label:'🔌 Elétrica',               kw:['tomada','adaptador','extens','lampada','lâmpada','disjuntor','filtro de linha','benjamim','fio ','interruptor'] },
  { key:'equipamentos', label:'🛠️ Equipamentos',           kw:['aerografo','aerógrafo','compressor','pistola','maquina','máquina','pulverizador','airless'] },
];
const MKT_MENU_LABEL = Object.assign({ outros:'📦 Outros' }, ...MKT_MENUS.map(m => ({ [m.key]: m.label })));
function mktClassify(p){
  const n = (' ' + (p && p.name || '') + ' ').toLowerCase();
  for(const m of MKT_MENUS){ if(m.kw.some(k => n.includes(k))) return m.key; }
  return 'outros';
}

// Virtualização básica: renderiza em batches de 80 com IntersectionObserver
// sentinel. Mantém comportamento (scroll mostra tudo) mas paga o custo
// de DOM aos poucos em vez de tudo no primeiro paint.
function _mktMountInfinite(container, items, batchSize){
  if(!container) return;
  batchSize = batchSize || 80;
  let cursor = 0;
  function appendBatch(){
    const slice = items.slice(cursor, cursor + batchSize);
    if(slice.length === 0) return;
    const sentinel = container.querySelector('.mkt-scroll-sentinel');
    if(sentinel) sentinel.remove();
    container.insertAdjacentHTML('beforeend', slice.map(renderProductRow).join(''));
    cursor += slice.length;
    if(cursor < items.length){
      const s = document.createElement('div');
      s.className = 'mkt-scroll-sentinel';
      s.style.cssText = 'grid-column:1/-1;height:1px;';
      container.appendChild(s);
      try {
        const io = new IntersectionObserver(entries => {
          if(entries[0].isIntersecting){ io.disconnect(); appendBatch(); }
        }, { rootMargin: '300px' });
        io.observe(s);
      } catch(_){ appendBatch(); }
    }
  }
  container.innerHTML = '';
  appendBatch();
}

function mktTab(key) {
  document.querySelectorAll('.mkt-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-key') === key));
  const si = document.getElementById('mkt-search'); if(si) si.value = '';
  const ss = document.getElementById('mkt-search-section'); if(ss) ss.style.display = 'none';
  document.querySelectorAll('#mkt-sections .mkt-menu-sec').forEach(s => {
    const on = s.getAttribute('data-key') === key;
    s.style.display = on ? 'block' : 'none';
    if(on && s.getAttribute('data-rendered') === '0'){
      const grid = s.querySelector('.mkt-products');
      if(grid){
        const items = key === 'todos' ? mktProducts : (_mktGrouped[key] || []);
        if(key === 'todos' && items.length > 80){
          _mktMountInfinite(grid, items, 80);
        } else {
          grid.innerHTML = items.map(renderProductRow).join('');
        }
      }
      s.setAttribute('data-rendered', '1');
    }
  });
}

// Carrega no Supabase o estado do usuário que antes ficava em
// localStorage (carrinho, contador de logo IA, stories vistos).
async function loadUserState(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  try {
    const data = await getMyProfile();
    if(data){
      cartItems = Array.isArray(data.cart) ? data.cart : [];
      _aiLogoCount = +data.ai_logo_gen_count || 0;
      _seenStories = (data.seen_stories && typeof data.seen_stories === 'object') ? data.seen_stories : {};
      updateCartBadge();
    }
  } catch(e){ console.warn('loadUserState:', e && e.message || e); }
}

async function saveCart(){
  // 1. Salva local primeiro (resiliente a falha de rede; chamadas seguintes
  //    de saveCart() re-tentam o Supabase com o cartItems atual).
  try {
    if(currentUser && currentUser.id){
      localStorage.setItem('cart_' + currentUser.id, JSON.stringify(cartItems));
    }
  } catch(_) {}
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  try {
    const { error } = await sb.from('profiles').update({ cart: cartItems }).eq('id', currentUser.id);
    if(error) console.warn('saveCart:', error.message);
  } catch(e){
    console.warn('saveCart:', e && e.message || e);
  }
}

function updateCartBadge(){
  cartCount = cartItems.reduce((s,c) => s + (c.qty||1), 0);
  const el = document.getElementById('cart-count');
  if(el){
    el.textContent = cartCount;
    el.style.display = cartCount > 0 ? '' : 'none';
  }
}
updateCartBadge();

function addToCart(productId, qty, name, price) {
  qty = Math.max(1, parseInt(qty) || 1);
  if(productId){
    let p = mktProducts.find(x => x.id === productId);
    if(!p && name){ p = { id: productId, name: name, price: Number(price) || 0 }; }
    if(p){
      const existing = cartItems.find(x => x.id === p.id);
      if(existing){
        existing.qty = (existing.qty || 1) + qty;
      } else {
        cartItems.push({ id:p.id, name:p.name, price:p.price, color_hex:p.color_hex, color_gradient:p.color_gradient, volume:p.volume, qty:qty });
      }
    }
  }
  saveCart();
  updateCartBadge();
  toast('Adicionado ao carrinho!');
  setTimeout(() => { renderCartModal(); showModal('cart-modal'); }, 300);
}

function changeCartQty(index, delta){
  if(!cartItems[index]) return;
  const newQty = (cartItems[index].qty || 1) + delta;
  if(newQty < 1){ removeFromCart(index); return; }
  cartItems[index].qty = newQty;
  saveCart();
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
    const bg = productBg(item);
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
  saveCart();
  updateCartBadge();
  renderCartModal();
}

async function submitCartOrder(){
  if(cartItems.length === 0){ toast('Carrinho vazio!'); return; }
  const ctx = requireSession('Faca login primeiro');
  if(!ctx) return;
  const sb = ctx.sb;
  const btn = document.getElementById('cart-submit-btn');
  const originalLabel = btn.textContent;
  btn.textContent = 'Criando pedido...'; btn.disabled = true;
  try {
    const total = cartItems.reduce((sum, item) => sum + Number(item.price || 0) * (item.qty || 1), 0);
    const { data: inserted, error } = await sb.from('orders').insert({
      user_id: currentUser.id,
      items: cartItems,
      total: total,
      status: 'pending',
      created_at: new Date().toISOString()
    }).select('id').single();
    if(error) throw error;
    const orderId = inserted && inserted.id;
    if(!orderId) throw new Error('Pedido criado sem ID');

    // Pega o token e cria a preference no Mercado Pago Checkout Pro
    btn.textContent = 'Gerando pagamento...';
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ throw new Error('Sessão expirada — faça login'); }
    const { ok, status, data } = await apiPost('/api/mp-checkout-loja', { orderId });
    if(!ok || !data || !data.init_point){
      // Fallback: se MP não estiver configurado, mantém fluxo antigo
      if(status === 503){
        toast('Pedido recebido! A loja entrará em contato (pagamento online em breve).');
        cartItems = []; saveCart(); updateCartBadge(); closeModals();
        return;
      }
      throw new Error((data && data.error) || ('Erro ' + status));
    }

    // Limpa o carrinho ANTES de redirecionar — se o user voltar, não duplica
    cartItems = []; saveCart(); updateCartBadge();
    toast('Redirecionando para o Mercado Pago...');
    window.location.href = data.init_point;
  } catch(e){
    console.error('submitCartOrder error:', e && e.message || e);
    toast('Erro: ' + (e.message || 'tente novamente'));
    btn.textContent = originalLabel; btn.disabled = false;
  }
}

function getCategoryEmoji(cat){
  return cat === 'texturas' ? '🖌️' : cat === 'epoxi' ? '⚗️' : cat === 'acessorios' ? '🎭' : '🪣';
}

function getProductImage(p){
  if(p.image_url) return p.image_url;
  if(p._imgCache !== undefined) return p._imgCache;
  const _setImg = (v) => { p._imgCache = v; return v; };
  const n = (p.name||'').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,''); // strip accents for matching

  // Tintas Brazilian — fotos reais do catálogo, sem sufixo de tamanho
  const brMap = [
    [['alta emborrachada','tinta emborrachada','alta performance'],'br-alta-performance'],
    [['piso dura'],'br-piso-dura-premium'],
    [['pinta super','pinta+'],'br-pinta-super-standard'],
    [['classic standard','tinta acrilica classic'],'br-tinta-classic-standard'],
    [['economica turbo','tinta economica turbo'],'br-economica-turbo'],
    [['tinta acrilica premium','acrilica premium'],'br-tinta-acrilica-premium'],
    [['liancryl'],'br-liancryl-piso'],
    [['alkylux'],'br-alkylux-esmalte'],
    [['r.u.r.a.i','rurai'],'br-rurai-esmalte'],
    [['fundo acabamento','fundo e acabamento','fundo & acabamento'],'br-fundo-acabamento'],
    [['zarcao'],'br-fundo-zarcao'],
    [['fundo nivelador'],'br-fundo-nivelador-madeira'],
    [['galvilux'],'br-fundo-galvilux'],
    [['sintelux'],'br-sintelux-esmalte'],
    [['esmalte base agua','esmalte base d'],'br-esmalte-base-agua'],
    [['seladora concentrada','seladora madeira concentrada'],'br-seladora-madeira-conc'],
    [['colorlac'],'br-colorlac'],
    [['colorbase'],'br-colorbase'],
    [['colordur'],'br-colordur'],
    [['colorlux'],'br-colorlux'],
    [['quick primer'],'br-quick-primer'],
    [['primer pu hs 5','primer pu hs 5:1'],'br-primer-pu-hs'],
    [['primer pu hs 8','primer pu hs 8:1'],'br-primer-pu-hs-81'],
    [['primer cromato','cromato de zinco'],'br-primer-cromato-zinco'],
    [['primer sintetico'],'br-primer-sintetico'],
    [['primer colorfill','colorfill'],'br-primer-colorfill'],
    [['primer universal'],'br-primer-universal'],
    [['eliminador de cratera','aditivo cratera'],'br-aditivo-cratera'],
    [['catalisador esmalte'],'br-catalisador-esmalte'],
    [['acelerador de secagem','acelerador secagem'],'br-acelerador-secagem'],
    [['pasta fosqueante','fosqueante'],'br-pasta-fosqueante'],
    [['wash primer','preto fosco vinil'],'br-wash-primer'],
    [['batida de pedra'],'br-batida-pedra'],
    [['seladora para plastico','seladora plastico'],'br-seladora-plastico'],
    [['massa rapida'],'br-massa-rapida'],
    [['removedor pastoso'],'br-removedor-pastoso'],
    [['pano pega po','pega po'],'br-pano-pega-po'],
    [['restaura plastico','restaura plast'],'br-restaura-plastico'],
    [['vedador de capo','vedador capo'],'br-vedador-capo'],
    [['profissional economico'],'br-profissional-economico'],
    [['telhas tijolos','resina acrilica base agua'],'br-telhas-tijolos-resina'],
    [['resina acrilica base solvente','base solvente'],'br-resina-base-solvente'],
    [['gesso drywall','fundo e acabamento drywall'],'br-gesso-drywall'],
    [['verniz copal','copal verniz'],'br-verniz-copal'],
    [['verniz filtro','filtro solar verniz'],'br-verniz-filtro-solar'],
    [['verniz maritimo'],'br-verniz-maritimo'],
    [['seladora para madeira','seladora madeira'],'br-seladora-madeira'],
    [['fundo preparador'],'br-fundo-preparador'],
    [['massa corrida'],'br-massa-corrida'],
    [['massa acrilica'],'br-massa-acrilica'],
    [['selador acrilico'],'br-selador-acrilico'],
    [['thinner 6137','thinner de limpeza'],'br-thinner-diluente'],
  ];
  for(const [keys, base] of brMap){
    if(keys.some(k => n.includes(k))) return '/products/'+base+'.webp';
  }

  // Detect container size from product name
  function sizeVariant(){
    // Quarto / 0,9L / 900ml
    if(/0[,.]9\s*l|900\s*m[l]|quarto/.test(n)) return '-quarto';
    // Galão / 3,6L / 3,2L / 5L / 1/4
    if(/3[,.]6\s*l|3[,.]2\s*l|[45]\s*l[ts^]|[45]\s*lts|gal[aã]o|1\/4/.test(n)) return '-galao';
    // Lata / balde 18L or 16L → base image (no suffix)
    return '';
  }

  const suf = sizeVariant();

  const m = [
    [['aguarras','diluente aguarras'],'diluente-aguarras'],
    [['aquacryl super premium'],'aquacryl-super-premium'],
    [['metalatex litoral'],'metalatex-litoral'],
    [['metalatex elastic'],'metalatex-elastic'],
    [['metalatex bactercryl','bactercryl'],'metalatex-bactercryl'],
    [['metalatex super lavavel brilho','lavavel brilho'],'metalatex-super-lavavel-brilho'],
    [['metalatex super lavavel fosco','lavavel fosco'],'metalatex-super-lavavel-fosco'],
    [['metalatex requinte','requinte'],'metalatex-requinte'],
    [['efeitos especiais'],'efeitos-especiais'],
    [['texturarte'],'texturarte'],
    [['eco resina termica','resina termica'],'eco-resina-termica'],
    [['esmalte sintetico super secagem'],'esmalte-sintetico-super-secagem'],
    [['esmalte sintetico super protecao'],'esmalte-sintetico-super-protecao'],
    [['eco esmalte'],'eco-esmalte'],
    [['esmalte sintetico'],'esmalte-sintetico-tradicional'],
    [['eco epoxi'],'eco-epoxi'],
    [['novacor piso ultra','piso ultra'],'novacor-piso-ultra'],
    [['novacor piso premium','piso premium'],'novacor-piso-premium'],
    [['novacor extra'],'novacor-extra'],
    [['novacor cobre mais','cobre mais'],'novacor-cobre-mais'],
    [['novacor esmalte','esmalte novacor'],'novacor-esmalte-sintetico'],
    [['kem tone','kemtone'],'kem-tone'],
    [['gesso','drywall'],'novacor-gesso-drywall'],
    [['massa corrida'],'massa-corrida'],
    [['massa acrilica'],'massa-acrilica'],
    [['fundo preparador','eco fundo'],'eco-fundo-preparador'],
    [['restauracao'],'restauracao'],
    [['novacor resina impermeabilizante'],'novacor-resina-impermeabilizante'],
    [['eco resina impermeabilizante','resina impermeabilizante'],'eco-resina-impermeabilizante'],
    [['super galvite','galvite'],'super-galvite'],
    [['verniz shertol','shertol'],'verniz-shertol'],
    [['verniz filtro solar','filtro solar'],'verniz-filtro-solar'],
    [['verniz maritimo'],'verniz-maritimo'],
    [['verniz copal','copal'],'verniz-copal'],
    [['seladora para madeira','seladora madeira'],'seladora-madeira'],
    [['corante xadrez','xadrez'],'corante-xadrez'],
    [['corante globocor','globocor'],'corante-globocor'],
    [['tinta premium'],'tinta-premium'],
  ];
  for(const [keys, base] of m){
    if(keys.some(k => n.includes(k))){
      // Use size variant if the file exists, otherwise fall back to base
      if(suf) return _setImg('/products/'+base+suf+'.webp');
      return _setImg('/products/'+base+'.webp');
    }
  }
  return _setImg(null);
}

function _isArteUrbanaSpray(p){
  const n = (p.name||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  return n.includes('arte urbana') || n.includes('arte-urbana');
}

function renderProductCard(p){
  const isSpray = _isArteUrbanaSpray(p);
  const img = isSpray ? null : getProductImage(p);
  const bg = productBg(p);
  const emoji = getCategoryEmoji(p.category);
  const badgeHtml = p.badge ? (p.badge === 'NOVO' ? '<span class="mkt-badge-new">NOVO</span>' : '<span class="mkt-badge-promo">'+p.badge+'</span>') : '';
  const stockClass = p.stock <= 5 ? 'low' : 'ok';
  const stockIcon = p.stock <= 5 ? '⚠️' : '✅';
  const priceFormatted = 'R$' + Number(p.price||0).toFixed(2).replace('.',',');
  let swatchContent;
  if(isSpray){
    swatchContent = badgeHtml
      + '<img src="/products/arte-urbana-can.webp" alt="" style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);height:95%;width:auto;object-fit:contain;pointer-events:none;">';
  } else {
    swatchContent = img
      ? badgeHtml+'<img src="'+img+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">'
      : badgeHtml+(hasProductColor(p) ? '' : emoji);
  }
  const swatchStyle = isSpray
    ? 'background:'+bg+';overflow:hidden;padding:0;position:relative;'
    : 'background:'+bg+';overflow:hidden;padding:0;';
  return '<div class="mkt-card" onclick="openProductDetail(\''+escapeJsArg(p.id)+'\')"><div class="mkt-swatch" style="'+swatchStyle+'">'+swatchContent+'</div><div class="mkt-card-body"><div class="mkt-card-name">'+escapeHtml(p.name||'')+'</div><div class="mkt-card-code">'+escapeHtml(p.code||'')+'</div><div class="mkt-card-price">'+priceFormatted+'</div>'+(p.stock !== undefined ? '<div class="mkt-card-stock '+stockClass+'">'+stockIcon+' '+escapeHtml(String(p.stock))+' unid</div>' : '')+'<button class="mkt-card-add" onclick="event.stopPropagation();openProductDetail(\''+escapeJsArg(p.id)+'\')">+ Carrinho</button></div></div>';
}

function renderProductRow(p){
  const isSpray = _isArteUrbanaSpray(p);
  const img = isSpray ? null : getProductImage(p);
  const bg = productBg(p);
  const emoji = getCategoryEmoji(p.category);
  const price = 'R$' + Number(p.price||0).toFixed(2).replace('.',',');
  const stk = (p.stock !== undefined && p.stock !== null) ? ' · ' + p.stock + ' un' : '';
  let icContent, icStyle;
  if(isSpray){
    icStyle = 'background:'+bg+';overflow:hidden;padding:0;position:relative;';
    icContent = '<img src="/products/arte-urbana-can.webp" alt="" style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);height:100%;width:auto;object-fit:contain;">';
  } else {
    icContent = img
      ? '<img src="'+img+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">'
      : (hasProductColor(p) ? '' : emoji);
    icStyle = img ? 'background:#f5f5f5;overflow:hidden;padding:0;' : 'background:'+bg+';';
  }
  const inactive = p.active === false;
  return '<div class="mkt-row"'+(inactive?' style="opacity:.5"':'')+' onclick="openProductDetail(\''+p.id+'\')">'
    + '<div class="mkt-row-ic" style="'+icStyle+'">'+icContent+'</div>'
    + '<div class="mkt-row-info"><div class="mkt-row-name">'+escapeHtml(p.name||'')+(inactive?' <span style="font-size:10px;color:var(--muted);">(inativo)</span>':'')+'</div>'
    + '<div class="mkt-row-sub">'+(p.code?('Cód '+escapeHtml(String(p.code))):'')+stk+'</div>'
    + '<div class="mkt-row-price">'+price+'</div></div>'
    + '<button class="mkt-row-add" onclick="event.stopPropagation();openProductDetail(\''+p.id+'\')">+ Carrinho</button>'
    + '</div>';
}

function _mktSearchImpl(q){
  q = (q||'').trim().toLowerCase();
  const searchSec = document.getElementById('mkt-search-section');
  const secs = document.querySelectorAll('#mkt-sections .mkt-menu-sec');
  if(!q){
    if(searchSec) searchSec.style.display = 'none';
    const activeTab = document.querySelector('.mkt-tab.active');
    const activeKey = activeTab ? activeTab.getAttribute('data-key') : null;
    let shown = false;
    secs.forEach(s => {
      const on = s.getAttribute('data-key') === activeKey;
      s.style.display = on ? 'block' : 'none';
      if(on) shown = true;
    });
    if(!shown && secs[0]) secs[0].style.display = 'block';
    return;
  }
  secs.forEach(s => { s.style.display = 'none'; });
  const res = (mktProducts||[]).filter(p =>
    (p.name||'').toLowerCase().includes(q) || String(p.code||'').toLowerCase().includes(q));
  const grid = document.getElementById('mkt-search-grid');
  const title = document.getElementById('mkt-search-title');
  if(title) title.textContent = res.length > 60
    ? (res.length + ' resultados (mostrando 60 — refine a busca)')
    : (res.length + ' resultado(s)');
  if(grid) grid.innerHTML = res.length
    ? res.slice(0,60).map(renderProductRow).join('')
    : '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Nenhum produto encontrado</div>';
  if(searchSec) searchSec.style.display = 'block';
}
const mktSearch = (window.debounce ? window.debounce(_mktSearchImpl, 200) : _mktSearchImpl);

function openProductDetail(productId){
  const p = mktProducts.find(x => x.id === productId);
  if(!p){ showModal('product-detail-modal'); return; }
  const bg = productBg(p);
  const emoji = getCategoryEmoji(p.category);
  const modal = document.getElementById('product-detail-modal');
  const sheet = modal.querySelector('.sheet');
  const priceFormatted = 'R$' + Number(p.price||0).toFixed(2).replace('.',',');
  sheet.innerHTML = '<div class="sheet-handle"></div>'
    + '<div style="height:140px;background:'+(getProductImage(p)?'#f5f5f5':bg)+';border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:60px;margin-bottom:16px;overflow:hidden;">'+(getProductImage(p)?'<img src="'+escapeHtml(getProductImage(p))+'" alt="" style="width:100%;height:100%;object-fit:cover;">':(hasProductColor(p)?'':emoji))+'</div>'
    + '<div style="font-size:20px;font-weight:800;font-family:Syne,sans-serif;">'+escapeHtml(p.name||'')+'</div>'
    + '<div style="font-size:12px;color:var(--muted);margin-top:2px;margin-bottom:10px;">'+(p.code ? 'Cód. '+escapeHtml(p.code)+' · ' : '')+escapeHtml(p.line||'')+'</div>'
    + (p.description ? '<div style="font-size:13.5px;color:#555;line-height:1.5;margin-bottom:14px;">'+escapeHtml(p.description)+'</div>' : '')
    + '<div style="display:flex;gap:10px;margin-bottom:14px;">'
    + (p.rendimento ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Rendimento</div><div style="font-size:14px;font-weight:700;">'+escapeHtml(String(p.rendimento))+'</div></div>' : '')
    + (p.demaos ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Demãos</div><div style="font-size:14px;font-weight:700;">'+escapeHtml(String(p.demaos))+'</div></div>' : '')
    + (p.secagem ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Secagem</div><div style="font-size:14px;font-weight:700;">'+escapeHtml(String(p.secagem))+'</div></div>' : '')
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

let _mktLoadedAt = 0;
let _mktGrouped = {};
const _MKT_TTL = 5 * 60 * 1000; // 5 min

// Constrói abas + seções. Só renderiza as linhas da 1ª seção; as demais
// são renderizadas sob demanda em mktTab() (lazy).
function renderMktUI(){
  _mktGrouped = {};
  mktProducts.forEach(p => { const k = mktClassify(p); (_mktGrouped[k] = _mktGrouped[k] || []).push(p); });
  const orderedKeys = MKT_MENUS.map(m => m.key).concat(['outros']).filter(k => _mktGrouped[k] && _mktGrouped[k].length);
  const total = mktProducts.length;

  const tabsEl = document.getElementById('mkt-tabs');
  if(tabsEl){
    const todosTab = total
      ? '<div class="mkt-tab active" data-key="todos" onclick="mktTab(\'todos\')">📦 Todos ('+total+')</div>'
      : '';
    const catTabs = orderedKeys.map(k =>
      '<div class="mkt-tab" data-key="'+k+'" onclick="mktTab(\''+k+'\')">'
      + MKT_MENU_LABEL[k] + ' (' + _mktGrouped[k].length + ')</div>'
    ).join('');
    tabsEl.innerHTML = todosTab + catTabs || '<div class="mkt-tab active">Sem produtos</div>';
  }
  const secEl = document.getElementById('mkt-sections');
  if(secEl){
    if(orderedKeys.length === 0){
      secEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted);font-size:13px;">Nenhum produto cadastrado</div>';
    } else {
      // Seção "Todos" — render virtualizado (primeiros 80 + scroll sentinel)
      // pra não pagar custo de 1000+ produtos no DOM no primeiro paint.
      const firstBatch = mktProducts.slice(0, 80);
      const needsSentinel = mktProducts.length > 80;
      const todosHtml = '<div class="mkt-menu-sec" data-key="todos" data-rendered="1" style="display:block">'
        + '<div class="mkt-section-title">📦 Todos os produtos · '+total+' itens</div>'
        + '<div class="mkt-products" id="mkt-todos-grid">'+firstBatch.map(renderProductRow).join('')
          + (needsSentinel ? '<div class="mkt-scroll-sentinel" style="grid-column:1/-1;height:1px;"></div>' : '')
        + '</div>'
        + '</div>';
      const catHtml = orderedKeys.map(k =>
        '<div class="mkt-menu-sec" data-key="'+k+'" data-rendered="0" style="display:none">'
        + '<div class="mkt-section-title">'+MKT_MENU_LABEL[k]+' · '+_mktGrouped[k].length+' itens <span style="color:var(--muted);font-weight:600;">(de '+total+' no total)</span></div>'
        + '<div class="mkt-products"></div>'
        + '</div>'
      ).join('');
      secEl.innerHTML = todosHtml + catHtml;
      // Engata o IntersectionObserver pra carregar batches conforme rola
      if(mktProducts.length > 80){
        const grid = document.getElementById('mkt-todos-grid');
        const sentinel = grid && grid.querySelector('.mkt-scroll-sentinel');
        if(grid && sentinel){
          let cursor = 80;
          function _mktAppendBatch(){
            const slice = mktProducts.slice(cursor, cursor + 80);
            if(slice.length === 0) return;
            const s = grid.querySelector('.mkt-scroll-sentinel');
            if(s) s.remove();
            grid.insertAdjacentHTML('beforeend', slice.map(renderProductRow).join(''));
            cursor += slice.length;
            if(cursor < mktProducts.length){
              const ns = document.createElement('div');
              ns.className = 'mkt-scroll-sentinel';
              ns.style.cssText = 'grid-column:1/-1;height:1px;';
              grid.appendChild(ns);
              try {
                const io = new IntersectionObserver(entries => {
                  if(entries[0].isIntersecting){ io.disconnect(); _mktAppendBatch(); }
                }, { rootMargin: '300px' });
                io.observe(ns);
              } catch(_){ _mktAppendBatch(); }
            }
          }
          try {
            const io = new IntersectionObserver(entries => {
              if(entries[0].isIntersecting){ io.disconnect(); _mktAppendBatch(); }
            }, { rootMargin: '300px' });
            io.observe(sentinel);
          } catch(_){ _mktAppendBatch(); }
        }
      }
    }
  }
}

const _MKT_HIDDEN = /\bbase\s+(vy|z|xy|w|ly|e|f)\b/i;
function _isMktHidden(p){ return _MKT_HIDDEN.test(p.name||''); }

async function loadMktProducts(_attempt){
  _attempt = _attempt || 0;
  const setSec = (msg) => { const el = document.getElementById('mkt-sections'); if(el) el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted);font-size:13px;">'+msg+'</div>'; };
  // Cache: se carregado há pouco, só re-renderiza (não rebaixa o catálogo)
  if(mktProducts.length && (Date.now() - _mktLoadedAt) < _MKT_TTL){
    renderMktUI();
    return;
  }
  const sb = getSupabase();
  if(!sb){
    if(_attempt < 20){ setTimeout(() => loadMktProducts(_attempt + 1), 500); return; }
    setSec('Não foi possível conectar. <a href="#" onclick="loadMktProducts(0);return false" style="color:var(--p1);font-weight:700;">Tentar de novo</a>');
    return;
  }
  try {
    const PAGE = 1000;
    const byId = new Map();
    for(let pageNo = 0; pageNo < 30; pageNo++){
      const from = pageNo * PAGE;
      const { data, error } = await sb.from('products').select('*').order('name').range(from, from + PAGE - 1);
      if(error) throw error;
      if(!data || data.length === 0) break;
      const before = byId.size;
      data.forEach(p => { byId.set(p.id, p); });
      if(byId.size === before) break;       // sem progresso → evita loop infinito
      if(data.length < PAGE) break;          // última página
    }
    mktProducts = Array.from(byId.values()).filter(p => !_isMktHidden(p));
    _mktLoadedAt = Date.now();
    renderMktUI();
  } catch(e){
    console.error('loadMktProducts error:', e && e.message || e);
    setSec('Erro ao carregar produtos: ' + escapeHtml(String(e && e.message || e)) + ' <a href="#" onclick="loadMktProducts(0);return false" style="color:var(--p1);font-weight:700;">Tentar de novo</a>');
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

let _aiLogoCount = 0;
function _aiLogoGenCount(){ return _aiLogoCount; }
// Atomic via RPC SECURITY DEFINER (bump_ai_logo_count): incrementa no DB
// e devolve o novo count autoritativo. Antes era UPDATE direto com
// falha silente — atacante podia ganhar 2ª logo grátis se rede caísse.
async function _aiLogoBumpCount(){
  const sb = getSupabase();
  if(!sb || !currentUser){
    _aiLogoCount = _aiLogoCount + 1;  // fallback otimista offline
    return;
  }
  try {
    const { data, error } = await sb.rpc('bump_ai_logo_count');
    if (error) throw error;
    if (data && typeof data.count === 'number') {
      _aiLogoCount = data.count;
    } else {
      _aiLogoCount = _aiLogoCount + 1;
    }
  } catch (e) {
    console.warn('_aiLogoBumpCount:', e && e.message || e);
    _aiLogoCount = _aiLogoCount + 1;  // fallback otimista — não bloqueia UX
  }
  return _aiLogoCount;
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
    const ok = await appConfirm(
      'Gerar mais 3 opções de logo custa ' + _aiLogoFmtBRL(AI_LOGO_REGEN_PRICE_BRL) + '.\n\n'
      + 'Esse valor cobre o custo do Seu Zé + processamento.\n\n'
      + 'Deseja prosseguir?',
      { okLabel:'Gerar (pago)' }
    );
    if (!ok) return;
    toast(_aiLogoFmtBRL(AI_LOGO_REGEN_PRICE_BRL) + ' debitado · gerando...');
  }

  const btn = document.getElementById('ai-logo-btn');
  btn.disabled = true;
  btn.textContent = 'Gerando com Seu Zé...';

  let urls = null;
  let aiError = null;
  try {
    const { ok, data, error } = await apiPost('/api/generate-logo', { name, style });
    if (ok && data && Array.isArray(data.urls) && data.urls.length) {
      urls = data.urls;
    } else {
      aiError = (data && data.error) || error;
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
    toast('3 logos gerados pelo Seu Zé ✨');
  } else {
    console.warn('AI logo fallback:', aiError && aiError.message || aiError);
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

// ══ AI ART GENERATOR (Instagram) ══
// Pipeline: usuário escolhe foto + estilo → /api/ig-art devolve arte (data URL)
// e legenda → usuário posta no feed ou baixa. PRO + rate-limit no backend.
let _aiArtPhotoDataUrl = null;     // base64 da foto enviada
let _aiArtStyle = 'portrait';
let _aiArtResultDataUrl = null;    // base64 da arte gerada (pra reuso no post)
let _aiArtResultCaption = '';

function openAiArt(){
  if(!gateProClient('Gerar arte pra Instagram com Seu Zé')) return;
  _aiArtReset();
  showModal('ai-art-modal');
}

function _aiArtPickFile(input){
  const f = input && input.files && input.files[0];
  if(!f) return;
  if(!f.type.startsWith('image/')){ toast('Selecione uma imagem'); return; }
  if(f.size > 8 * 1024 * 1024){ toast('Foto muito grande (máx 8MB)'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    _aiArtPhotoDataUrl = e.target.result;
    const img = document.getElementById('ai-art-preview');
    const drop = document.getElementById('ai-art-drop');
    const acts = document.getElementById('ai-art-photo-actions');
    if(img){ img.src = e.target.result; img.style.display = 'block'; }
    if(drop) drop.style.display = 'none';
    if(acts) acts.style.display = 'flex';
  };
  reader.readAsDataURL(f);
}

function _aiArtSetStyle(el){
  if(!el) return;
  _aiArtStyle = el.getAttribute('data-style') || 'portrait';
  document.querySelectorAll('#ai-art-styles .ai-art-style').forEach(c => {
    c.classList.remove('sel');
    c.style.border = '2px solid var(--border)';
    c.style.background = '#fff';
  });
  el.classList.add('sel');
  el.style.border = '2px solid var(--p1)';
  el.style.background = 'rgba(255,107,53,.08)';
}

async function gerarArteIG(){
  if(!_aiArtPhotoDataUrl){ toast('Escolha uma foto primeiro'); return; }
  const btn = document.getElementById('ai-art-gen-btn');
  if(btn){ btn.disabled = true; btn.textContent = '✨ Seu Zé tá pintando...'; }
  try {
    const businessName = (typeof getMyProfile === 'function')
      ? ((await getMyProfile())?.business_name || '')
      : '';
    const hint = (document.getElementById('ai-art-hint')?.value || '').trim();
    const { ok, status, data, error } = await apiPost('/api/ig-art', {
      photoDataUrl: _aiArtPhotoDataUrl,
      style: _aiArtStyle,
      captionHint: hint,
      businessName
    });
    if(!ok || !data || !data.imageDataUrl){
      // Mostra a causa real (modelo errado, sem permissão, etc) — não engole o erro
      const msg = (data && data.error) || error || ('HTTP ' + (status || '?'));
      console.error('ig-art falhou:', { status, data, error });
      // Toast curto + alert com detalhe completo pra debug
      toast('Falha: ' + msg.slice(0, 80));
      if(msg.length > 80 && typeof appAlert === 'function'){
        appAlert('Detalhe técnico:\n\n' + msg);
      }
      return;
    }
    _aiArtResultDataUrl = data.imageDataUrl;
    _aiArtResultCaption = String(data.caption || '');
    const resImg = document.getElementById('ai-art-result-img');
    const resCap = document.getElementById('ai-art-result-caption');
    const resBox = document.getElementById('ai-art-result');
    if(resImg) resImg.src = data.imageDataUrl;
    if(resCap) resCap.value = _aiArtResultCaption;
    if(resBox){
      resBox.style.display = 'block';
      setTimeout(() => resBox.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }
    toast('Arte pronta! ✨');
  } catch(e){
    console.warn('gerarArteIG:', e);
    toast('Erro ao falar com o Seu Zé');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = '✨ Gerar arte com Seu Zé'; }
  }
}

function _aiArtDownload(){
  if(!_aiArtResultDataUrl){ toast('Gere uma arte primeiro'); return; }
  const a = document.createElement('a');
  a.href = _aiArtResultDataUrl;
  a.download = 'arte-ig-' + _aiArtStyle + '-' + Date.now() + '.png';
  document.body.appendChild(a); a.click(); a.remove();
  toast('Arte baixada 📥');
}

function _aiArtReset(){
  _aiArtPhotoDataUrl = null;
  _aiArtResultDataUrl = null;
  _aiArtResultCaption = '';
  const img = document.getElementById('ai-art-preview');
  const drop = document.getElementById('ai-art-drop');
  const acts = document.getElementById('ai-art-photo-actions');
  const resBox = document.getElementById('ai-art-result');
  const hint = document.getElementById('ai-art-hint');
  const input = document.getElementById('ai-art-input');
  if(img){ img.src = ''; img.style.display = 'none'; }
  if(drop) drop.style.display = 'block';
  if(acts) acts.style.display = 'none';
  if(resBox) resBox.style.display = 'none';
  if(hint) hint.value = '';
  if(input) input.value = '';
  // Reseta seleção pro default "portrait"
  const def = document.querySelector('#ai-art-styles .ai-art-style[data-style="portrait"]');
  if(def) _aiArtSetStyle(def);
}

// Posta a arte gerada no feed do usuário usando o pipeline existente
// (upload pra storage 'posts' + insert em posts com status approved).
async function _aiArtPost(){
  if(!_aiArtResultDataUrl){ toast('Gere uma arte primeiro'); return; }
  const sb = getSupabase();
  if(!sb || !currentUser){ toast('Faça login'); return; }
  const caption = (document.getElementById('ai-art-result-caption')?.value || '').trim();
  toast('Publicando…');
  try {
    // Converte data URL pra Blob
    const m = /^data:([^;]+);base64,(.+)$/.exec(_aiArtResultDataUrl);
    if(!m) throw new Error('arte inválida');
    const mime = m[1];
    const binary = atob(m[2]);
    const arr = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) arr[i] = binary.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const ext = (mime.split('/')[1] || 'png').replace(/\W/g,'') || 'png';
    const path = currentUser.id + '/ai-art-' + Date.now() + '.' + ext;
    const { error: upErr } = await sb.storage.from('posts').upload(path, blob, { contentType: mime, upsert: false });
    if(upErr) throw upErr;
    const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
    const mediaUrl = urlData?.publicUrl;
    if(!mediaUrl) throw new Error('sem publicUrl');

    // Modera só o texto (a arte foi gerada pelo nosso pipeline; pula moderação de imagem)
    const modResult = (typeof moderateContentAsync === 'function')
      ? await moderateContentAsync(caption, null, false)
      : { approved: true };
    if(!modResult.approved && modResult.severity === 'hard'){
      try { await sb.storage.from('posts').remove([path]); } catch(_){}
      toast('Legenda bloqueada: ' + (modResult.reason || ''));
      return;
    }
    const status = modResult.approved ? 'approved' : 'pending';
    const { error: insErr } = await sb.from('posts').insert({
      user_id: currentUser.id,
      caption: caption || null,
      media_url: mediaUrl,
      media_type: 'image',
      status,
      created_at: new Date().toISOString()
    });
    if(insErr) throw insErr;
    closeModals();
    toast(status === 'approved' ? 'Post publicado no seu feed! 🎉' : 'Post enviado pra revisão');
    if(typeof loadFeed === 'function') loadFeed();
  } catch(e){
    console.warn('_aiArtPost:', e);
    toast('Erro ao publicar: ' + (e?.message || 'tente de novo'));
  }
}

function selectAiLogo(el){
  document.querySelectorAll('.shirt-ai-logo-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  _aiLogoSelected = parseInt(el.dataset.idx) || 0;
  _applyLogoToShirt();
}

async function usarLogoIA(){
  if(_aiLogoSelected === null || !_aiLogoLastName){ toast('Gere um logo primeiro'); return; }
  _applyLogoToShirt();
  const src = _aiLogoCurrentSrc();
  if(!src){ toast('Logo aplicado na camiseta! 👕'); return; }
  toast('Salvando seu logo no perfil...');
  const url = await salvarLogoNoPerfil(src, _aiLogoLastName);
  if(url){
    _applyOwnLogoToShirt(url, _aiLogoLastName);
    toast('Logo salvo no seu perfil! 👕');
  } else {
    toast('Logo aplicado (não foi possível salvar no perfil)');
  }
}

// Persiste o logo (gerado por IA ou enviado) no perfil do PRO, para reuso
// em futuras camisetas e branding. Sobe para o storage e grava em profiles.
async function salvarLogoNoPerfil(src, label){
  const sb = getSupabase();
  if(!sb || !currentUser || !src) return null;
  try {
    const resp = await fetch(src);
    const blob = await resp.blob();
    const isSvg = (blob.type && blob.type.indexOf('svg') !== -1) || /^data:image\/svg/i.test(src);
    const ext = isSvg ? 'svg' : 'png';
    const path = currentUser.id + '/business_logo.' + ext;
    const { error: upErr } = await sb.storage.from('posts')
      .upload(path, blob, { upsert:true, contentType: blob.type || (isSvg?'image/svg+xml':'image/png') });
    if(upErr) throw upErr;
    const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
    const publicUrl = (urlData && urlData.publicUrl) ? urlData.publicUrl + '?t=' + Date.now() : null;
    if(!publicUrl) throw new Error('sem publicUrl');
    await sb.from('profiles').update({ business_logo_url: publicUrl, business_name: label || null }).eq('id', currentUser.id);
    try { localStorage.setItem('business_logo_url', publicUrl); } catch(e){}
    return publicUrl;
  } catch(e){
    console.warn('salvarLogoNoPerfil (storage):', e && e.message || e);
    // Fallback: grava o próprio src direto no perfil para não perder o logo
    try {
      await sb.from('profiles').update({ business_logo_url: src, business_name: label || null }).eq('id', currentUser.id);
      try { localStorage.setItem('business_logo_url', src); } catch(e2){}
      return src;
    } catch(e2){ console.warn('salvarLogoNoPerfil (fallback):', e2 && e2.message || e2); return null; }
  }
}

function baixarLogo(){
  const src = _aiLogoCurrentSrc();
  if(!src){ toast('Gere ou selecione um logo primeiro'); return; }
  const isSvg = /^data:image\/svg/i.test(src);
  const a = document.createElement('a');
  a.href = src;
  a.download = 'logo-' + String(_aiLogoLastName||'queroumacor').replace(/\s+/g,'-').toLowerCase() + (isSvg?'.svg':'.png');
  document.body.appendChild(a); a.click(); a.remove();
  toast('Logo baixado 📥');
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
  const unit = shirtQty >= 5 ? 39.90 * 0.85 : 39.90;
  addToCart('shirt-personalizada', shirtQty, 'Camiseta Personalizada', unit);
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
  } catch(e){ console.warn('loadQualsList:', e && e.message || e); box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Erro ao carregar.</div>'; }
}

async function addQualification(btn){
  const title = document.getElementById('q-title').value.trim();
  if(!title){ toast('Informe o título'); return; }
  const ctx = requireSession('Faça login');
  if(!ctx) return;
  const sb = ctx.sb;
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
  } catch(e){ console.error('addQualification:', e && e.message || e); toast('Erro: ' + (e.message||'falha')); }
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
  } catch(e){ console.error('deleteQualification:', e && e.message || e); toast('Erro ao remover'); }
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
  } catch(e){ console.warn('loadCoursesList:', e && e.message || e); box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Erro ao carregar.</div>'; }
}

async function addCourse(btn){
  const title = document.getElementById('c-title').value.trim();
  if(!title){ toast('Informe o título'); return; }
  const ctx = requireSession('Faça login');
  if(!ctx) return;
  const sb = ctx.sb;
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
      price: isFree ? null : (parseBRL(document.getElementById('c-price').value) || null)
    });
    if(error) throw error;
    ['c-title','c-sub','c-cover','c-link','c-duration','c-price'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('c-free').checked = false;
    toast('Curso adicionado');
    loadCoursesList();
  } catch(e){ console.error('addCourse:', e && e.message || e); toast('Erro: ' + (e.message||'falha')); }
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
  } catch(e){ console.error('deleteCourse:', e && e.message || e); toast('Erro ao remover'); }
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
let _feedOffset = 0;
const FEED_PAGE = 30;

async function loadFeed(){
  _lastFeedLoad = Date.now();
  // Cache de HTML em localStorage foi removido: a string crescia até
  // ~400KB e o setItem/getItem síncrono engasgava o main thread em
  // mobile, sem ganho real (a hidratação dos posts via Supabase é
  // rápida e o skeleton já cobre o primeiro paint).
  // Limpa entradas antigas pra liberar quota (storage cap em iOS Safari).
  try {
    const uid = currentUser ? currentUser.id : 'anon';
    localStorage.removeItem('feedCache_v2_' + uid);
    localStorage.removeItem('storiesCache_v2_' + uid);
  } catch(_){}
  // Fetch followingIds once, share with both
  const feedIds = await getFollowingIds();
  await Promise.all([loadStories(feedIds), loadPosts(feedIds)]);
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
    console.warn('getFollowingIds error:', e && e.message || e);
    return [currentUser.id];
  }
}

// ══ AUTOPLAY DE VÍDEOS NO FEED (estilo Instagram) ══
// Vídeos começam mudos (regra de autoplay dos navegadores); o botão de
// som no canto liga/desliga o áudio para a sessão inteira.
let _feedMuted = true;
let _feedVideoObserver = null;
let _obsVideos = new WeakSet();

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

async function loadPosts(feedIds, append){
  try {
    const sb = getSupabase();
    if(!sb) return;
    if(!feedIds) feedIds = await getFollowingIds();
    const offset = append ? _feedOffset : 0;
    // Build query - if user has following list, filter by it; otherwise show all recent posts
    let query = sb.from('posts').select(POST_COLS).neq('media_type', 'story');
    // Only show approved posts (or posts without status for backwards compat)
    query = query.or('status.eq.approved,status.is.null');
    if(feedIds.length > 0) query = query.in('user_id', feedIds);
    query = query.order('created_at', { ascending: false }).range(offset, offset + FEED_PAGE - 1);
    let { data: posts, error } = await query;
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

    // Load profiles, likes, comments, saved_posts ALL in parallel
    const userIds = [...new Set(posts.map(p => p.user_id))];
    const postIds = posts.map(p => p.id);
    let myLikes = [];
    let likeCounts = {};
    let savedPosts = [];
    let commentsMap = {};
    const queries = [
      sb.from('profiles').select('id, name, tag, avatar_url, role, user_type').in('id', userIds),
      sb.from('comments').select('id, post_id, user_id, text, created_at').in('post_id', postIds).order('created_at', { ascending: true }).limit(postIds.length * 5)
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
      let name = prof.name || 'Usuário';
      if(name.includes('@')) name = name.split('@')[0];
      const tag = prof.tag ? '@' + prof.tag : '';
      const avatar = avatarOf({ avatar_url: prof.avatar_url, name: name });
      const time = getTimeAgo(p.created_at);
      const caption = p.caption || '';
      const liked = myLikes.includes(p.id);
      const saved = savedPosts.includes(p.id);
      const isVideo = !!p.media_url && (isVideoUrl(p.media_url) || p.media_type === 'video');
      const mediaSrc = escapeHtml(p.media_url || '');
      const imgHtml = p.media_url ? (isVideo ? '<div class="feed-video-wrap" style="position:relative;width:100%;background:#000;"><video class="feed-video" src="'+mediaSrc+'" muted loop playsinline preload="metadata" onclick="toggleFeedVideoPlay(this)" style="width:100%;display:block;object-fit:cover;max-height:500px;"></video><button class="feed-video-mute" onclick="event.stopPropagation();toggleFeedVideoMute(this)" aria-label="Som" style="position:absolute;right:10px;bottom:10px;width:34px;height:34px;border-radius:50%;border:none;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">'+_feedVolIcon(true)+'</button></div>' : '<img src="'+mediaSrc+'" alt="" loading="lazy" style="width:100%;display:block;object-fit:cover;">') : '';
      const likeCount = likeCounts[p.id] || 0;
      const brushFill = liked ? 'var(--p4)' : 'none';
      const brushStroke = liked ? 'var(--p4)' : 'var(--ink)';
      const paletteFill = saved ? 'var(--p1)' : 'none';
      const paletteStroke = saved ? 'var(--p1)' : 'var(--ink)';

      html += '<div class="mpost" data-post-id="'+escapeHtml(p.id)+'" data-author-role="'+escapeHtml(prof.role||'')+'">';
      html += '<div class="mpost-head">';
      html += '<div class="av-ring"><div class="av-inner"><img src="'+escapeHtml(avatar)+'" alt=""></div></div>';
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
      html += '<button class="act-btn" onclick="sharePost(\''+p.id+'\')">'
        +'<svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>'
        +'<span class="act-label">Compartilhar</span>'
        +'</button>';
      // Orçamento (qualquer post que não seja o seu próprio)
      if(!currentUser || p.user_id !== currentUser.id){
        html += '<button class="act-btn" onclick="abrirOrcamentoChat(\''+p.user_id+'\',\''+escapeJsArg(name)+'\')">'
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
          let cName = cp.name || 'Usuário';
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
        html += '<button onclick="comprarObra(\''+escapeJsArg(p.id)+'\',\''+escapeJsArg(name)+'\',\''+escapeJsArg(p.user_id)+'\',\''+escapeJsArg(p.art_type||'Obra')+'\')" style="flex:1;padding:10px;background:linear-gradient(135deg,#8338ec,var(--p1));color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">🎨 Interesse · R$ '+p.price.toLocaleString('pt-BR')+'</button>';
        html += '<button onclick="openChatWithUser(\''+p.user_id+'\')" style="padding:10px 14px;background:var(--white);color:var(--ink);border:1.5px solid var(--border);border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">💬</button>';
        html += '</div>';
      }
      html += '</div>';
    });
    // Botão "Ver mais" só se a página veio cheia (pode haver mais)
    if(posts.length === FEED_PAGE){
      html += '<div style="text-align:center;padding:16px 0 28px;"><button id="feed-more-btn" onclick="loadMoreFeed(this)" style="background:none;border:1.5px solid var(--border);border-radius:20px;padding:10px 24px;font-size:13px;font-weight:700;color:var(--ink);cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ver mais publicações</button></div>';
    }
    if(append){
      // Remove o botão "Ver mais" antigo e anexa só os novos posts
      const oldBtn = document.getElementById('feed-more-btn');
      if(oldBtn && oldBtn.closest('div')) oldBtn.closest('div').remove();
      container.insertAdjacentHTML('beforeend', html);
      observeFeedVideos(false);
    } else {
      container.innerHTML = html;
      observeFeedVideos(true);
    }
    _feedOffset = offset + posts.length;
  } catch(e){
    console.error('loadPosts error:', e && e.message || e);
  }
}

async function loadMoreFeed(btn){
  // Evita duplicar a página 1 se clicado antes do feed inicial estabelecer o offset
  if(_feedOffset === 0) return;
  if(btn){ btn.textContent = 'Carregando...'; btn.disabled = true; }
  await loadPosts(null, true);
  filterFeedPosts();
}

function stripEmail(s){
  if(!s) return s;
  return String(s).replace(/([A-Za-z0-9._%+\-]+)@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '@$1');
}
function cleanHandle(p, fb){
  if(p && p.tag) return '@' + p.tag;
  return stripEmail((p && p.name) || fb || 'Usuário');
}

function escapeHtml(str){
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}
// Escapa um valor para uso DENTRO de uma string JS em atributo onclick="..."
function escapeJsArg(str){
  return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/[<>]/g, '');
}

async function sendPasswordReset(){
  const email = (document.getElementById('login-email')?.value || '').trim();
  if(!email || !/^\S+@\S+\.\S+$/.test(email)){ toast('Digite seu email no campo acima primeiro'); return; }
  const sb = getSupabase();
  if(!sb){ toast('Aguarde, carregando...'); return; }
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if(handleSbError(error)) return;
    toast('Email de recuperação enviado! Verifique sua caixa de entrada.');
  } catch(e){ console.warn('sendPasswordReset:', e && e.message || e); toast('Erro ao enviar email'); }
}

async function doSetNewPassword(){
  const newPw = (document.getElementById('reset-pw-new')?.value || '');
  const confirmPw = (document.getElementById('reset-pw-confirm')?.value || '');
  if(newPw.length < 8){ toast('A senha deve ter ao menos 8 caracteres'); return; }
  if(newPw !== confirmPw){ toast('As senhas não coincidem'); return; }
  const sb = getSupabase();
  if(!sb){ toast('Aguarde...'); return; }
  try {
    const { error } = await sb.auth.updateUser({ password: newPw });
    if(handleSbError(error)) return;
    document.getElementById('reset-pw-new').value = '';
    document.getElementById('reset-pw-confirm').value = '';
    closeModals();
    toast('Senha alterada com sucesso!');
    showScreen('feed');
  } catch(e){ console.warn('doSetNewPassword:', e && e.message || e); toast('Erro ao salvar senha'); }
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
  } catch(e){ console.warn('togglePostLike error:', e && e.message || e); }
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
  } catch(e){ toast('Erro ao comentar'); console.warn('comment error:', e && e.message || e); }
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
  } catch(e){ toast('Erro ao apagar'); console.warn('delete error:', e && e.message || e); }
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
  } catch(e){ console.warn('toggleSavePost error:', e && e.message || e); }
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
  if(!(await appConfirm('Tem certeza que deseja deletar este post?', { okLabel:'Deletar' }))) return;
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
    if(handleSbError(error, 'Erro ao deletar')) return;
    // Remove from DOM
    const postEl = document.querySelector('.mpost[data-post-id="'+_currentOptPostId+'"]');
    if(postEl) postEl.remove();
    toast('Post deletado!');
    _currentOptPostId = null;
  } catch(e){ toast('Erro ao deletar'); console.warn('post delete error:', e && e.message || e); }
}

// Report post
let _reportPostId = null;
let _reportUserId = null;

function reportPost(){
  if(!currentUser){ toast('Faça login para denunciar'); return; }
  if(!_currentOptPostId){ toast('Post não encontrado'); return; }
  _reportPostId = _currentOptPostId;
  _reportUserId = _currentOptUserId;
  showModal('report-reason-modal');
}

async function submitReport(reason){
  closeModals();
  if(!currentUser || !_reportPostId){ toast('Não foi possível enviar a denúncia'); return; }
  const sb = getSupabase();
  if(!sb){ toast('Não foi possível enviar a denúncia'); return; }
  try {
    const { error } = await sb.from('reports').insert({
      reporter_id: currentUser.id,
      post_id: _reportPostId,
      target_user_id: _reportUserId || null,
      reason: reason
    });
    if(handleSbError(error, 'Erro ao enviar denúncia')) return;
    toast('Denúncia enviada. Obrigado — nossa equipe vai analisar.');
  } catch(e){
    console.warn('submitReport error:', e && e.message || e);
    toast('Erro ao enviar denúncia');
  } finally {
    _reportPostId = null;
    _reportUserId = null;
  }
}

// Story delete
async function deleteCurrentStory(){
  if(!currentUser) return;
  const group = storyGroups[currentStoryGroup];
  if(!group || group.user_id !== currentUser.id) return;
  const story = group.stories[currentStoryIndex];
  if(!story) return;
  if(!(await appConfirm('Deletar este story?', { okLabel:'Deletar' }))) return;
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
      renderCurrentStory();
    }
    toast('Story deletado!');
  } catch(e){ toast('Erro ao deletar story'); console.warn('story delete error:', e && e.message || e); }
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
  return dateBR(dateStr);
}

// Stories data grouped by user
let storyGroups = [];
let currentStoryGroup = 0;
let currentStoryIndex = 0;
let storyTimer = null; // mantido pra compat; agora guarda rAF id
let _storyRafId = null;
const STORY_DURATION = 5000; // 5 seconds per story like IG

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
      const avatar = p.avatar_url || g.stories[0].media_url || avatarUrl(p.name||'U');
      const seen = isStoryGroupSeen(g.user_id) ? ' seen' : '';
      html += `<div class="story">
        <div class="story-ring${seen}" style="cursor:pointer" onclick="openStoryViewer(${gi})"><div class="story-inner"><img src="${escapeHtml(avatar)}" alt=""></div></div>
        <span class="story-name" style="cursor:pointer" onclick="openUserProfile('${escapeJsArg(g.user_id)}')">${escapeHtml(name)}</span>
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

let _seenStories = {};
function isStoryGroupSeen(userId){ return !!_seenStories[userId]; }
function markStoryGroupSeen(userId){
  _seenStories[userId] = Date.now();
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
  document.getElementById('story-viewer-avatar').src = avatarOf({ avatar_url: p.avatar_url, name: p.name||'U' });
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

// Gera legenda + hashtags do post a partir da foto selecionada (PRO).
async function gerarLegendaPost(btn){
  if (!gateProClient('Gerar legenda com Seu Zé')) return;
  if(!postSelectedFiles || postSelectedFiles.length === 0){
    toast('Selecione uma foto primeiro');
    return;
  }
  const file = postSelectedFiles[0];
  if(getMediaType(file) === 'video'){
    toast('A legenda pelo Seu Zé só funciona com foto, não com vídeo');
    return;
  }
  if(file.size > 8 * 1024 * 1024){
    toast('Foto muito grande (máx 8 MB)');
    return;
  }
  const ta = document.getElementById('post-text-input');
  const orig = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.innerHTML = '✨ Gerando...'; }
  toast('Gerando legenda com Seu Zé...');
  try {
    const fd = new FormData();
    fd.append('image', file, file.name || 'foto.jpg');
    const { ok, status, data, error } = await apiPost('/api/caption', fd, { multipart: true });
    if(!ok){
      toast('Não foi possível gerar a legenda agora');
      console.warn('caption error:', (data && data.error) || error || status);
      return;
    }
    const caption = (data?.caption || '').toString().trim();
    const hashtags = Array.isArray(data?.hashtags) ? data.hashtags.filter(h => typeof h === 'string') : [];
    if(!caption && hashtags.length === 0){
      toast('O Seu Zé não devolveu nada — tente outra foto');
      return;
    }
    const existing = (ta.value || '').trim();
    const tagLine = hashtags.join(' ');
    const built = [caption, tagLine].filter(Boolean).join('\n\n');
    ta.value = existing ? (existing + '\n\n' + built) : built;
    ta.focus();
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch(_){}
    toast('Legenda gerada ✨');
  } catch(e){
    console.error('gerarLegendaPost:', e && e.message || e);
    toast('Falha ao gerar legenda');
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = orig; }
  }
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
        console.error('Upload error:', upError && upError.message || upError);
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
        } catch(e){ console.warn('cleanup upload:', e && e.message || e); }
      }
      toast('Conteúdo bloqueado pela moderação (' + modResult.reason + ')');
      btn.textContent = 'Publicar'; btn.disabled = false;
      return;
    }
    // Vídeo sempre entra pendente até a análise assíncrona liberar
    const postStatus = isVideo ? 'pending' : (modResult.approved ? 'approved' : 'pending');

    // Sale data (grafiteiro)
    const forSale = document.getElementById('post-for-sale')?.checked || false;
    const price = forSale ? parseBRL(document.getElementById('post-price')?.value) : 0;
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
      console.error('Post insert error:', insertErr && insertErr.message || insertErr);
      toast('Erro ao publicar: ' + (insertErr.message || JSON.stringify(insertErr)));
    } else {
      // Vídeo: dispara a análise assíncrona (frames + áudio) no servidor
      if(isVideo && insertData && insertData[0]){
        apiPost('/api/moderate-video', { postId: insertData[0].id, mediaUrl: imageUrl, caption: content })
          .then(() => { if(typeof loadFeed === 'function') loadFeed(); })
          .catch(e => console.warn('moderate-video:', e && e.message || e));
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
    console.error('publishPost error:', e && e.message || e);
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
        let req = sb.from('profiles')
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

// ══════════════════════════════
//  CHANGE 4: ARCHIVE CONVERSATIONS
// ══════════════════════════════
let archivedConvs = [];
let archivedExpanded = false;

async function loadArchivedConvs(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  try {
    const { data } = await sb.from('profiles').select('archived_conversations').eq('id', currentUser.id).single();
    if(data && Array.isArray(data.archived_conversations)){
      archivedConvs = data.archived_conversations;
      applyArchivedState();
    }
  } catch(e){ console.warn('loadArchivedConvs:', e && e.message || e); }
}
function saveArchivedConvs(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  sb.from('profiles').update({ archived_conversations: archivedConvs }).eq('id', currentUser.id)
    .then(({ error }) => { if(error) console.warn('saveArchivedConvs:', error.message); });
}

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
    saveArchivedConvs();
    toast('Conversa arquivada');
    applyArchivedState();
  }
}

function unarchiveConversation(convId){
  archivedConvs = archivedConvs.filter(id => id !== convId);
  saveArchivedConvs();
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
showScreen = function(n, _fromPop){
  _origShowScreen(n, _fromPop);
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
  const phone = (document.getElementById('s-phone')||{}).value ? document.getElementById('s-phone').value.trim() : '';
  const cityField = (document.getElementById('s-city')||{}).value ? document.getElementById('s-city').value.trim() : '';
  const stateField = (document.getElementById('s-state')||{}).value ? document.getElementById('s-state').value.trim() : '';
  if(!name || name.includes('@')){ toast('Preencha seu nome (não use o email como nome)'); return; }
  if(!tag || tag.length < 3){ toast('Escolha uma tag com pelo menos 3 caracteres'); return; }
  if(!email){ toast('Preencha seu email'); return; }
  if(!phone){ toast('Preencha seu WhatsApp'); return; }
  if(!cityField){ toast('Preencha sua cidade'); return; }
  if(!stateField){ toast('Selecione seu estado'); return; }
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
  } catch(e){ console.warn('Tag check error:', e && e.message || e); }
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
    console.warn('Tag check error:', e && e.message || e);
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
    } catch(dbErr){ console.warn('Invite DB insert skipped:', dbErr && dbErr.message || dbErr); }
    // Always show the code to the user
    generatedInviteCode[view] = code;
    document.getElementById('my-invite-code-' + view).style.display = 'block';
    document.getElementById('my-invite-code-value-' + view).textContent = code;
    document.getElementById('share-invite-btn-' + view).style.display = 'block';
    btn.textContent = 'Gerar Novo Codigo';
    btn.disabled = false;
    toast('Codigo gerado!');
  } catch(e){
    console.error('generateInviteCode error:', e && e.message || e);
    toast('Erro ao gerar codigo');
    btn.textContent = 'Gerar Codigo de Convite'; btn.disabled = false;
  }
}

async function shareInviteCode(view){
  const code = generatedInviteCode[view];
  if(!code){ toast('Gere um codigo primeiro'); return; }
  const text = 'Oi! Use meu codigo ' + code + ' para se cadastrar no QueroUmaCor - o app para pintores e clientes!';
  if(navigator.share){
    navigator.share({ title: 'Convite QueroUmaCor', text: text }).catch(()=>{});
  } else if(navigator.clipboard){
    navigator.clipboard.writeText(code).then(()=>toast('Codigo copiado!')).catch(()=>toast('Codigo: '+code));
  } else {
    await appPrompt('Copie o codigo:', { initial: code });
  }
}

// Feed is loaded by initAuth after auth check completes


// ══ FEATURE 3 — Maquininha (slot "coming soon") ══
// Mede interesse em receber pagamento no cartao. Zero processamento de pagamento.
async function abrirMaquininha(){
  try {
    const sb = getSupabase();
    if(currentUser && sb){
      sb.from('feature_interest').insert({
        user_id: currentUser.id,
        feature: 'maquininha',
        action: 'click'
      }).then(()=>{}, ()=>{});
      // Pre-preenche o contato com o telefone do perfil, se o input estiver vazio
      const input = document.getElementById('maquininha-contato');
      if(input && !input.value){
        sb.from('profiles').select('phone').eq('id', currentUser.id).single()
          .then(({ data }) => { if(data && data.phone && !input.value){ input.value = data.phone; } }, ()=>{});
      }
    }
  } catch(e){ console.error('abrirMaquininha error:', e && e.message || e); }
  showModal('maquininha-modal');
}

async function entrarListaMaquininha(){
  const input = document.getElementById('maquininha-contato');
  const contato = input ? input.value.trim() : '';
  try {
    const sb = getSupabase();
    if(currentUser && sb){
      await sb.from('feature_interest').insert({
        user_id: currentUser.id,
        feature: 'maquininha',
        action: 'waitlist',
        contact: contato
      });
    }
  } catch(e){ console.error('entrarListaMaquininha error:', e && e.message || e); }
  toast('Pronto! Avisaremos você assim que a maquininha estiver disponível.');
  closeModals();
}
