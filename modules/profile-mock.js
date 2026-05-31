// modules/profile-mock.js — feature "Perfil mock de pintor" (cards/popups + tabs)
// extraída do app.js. Fase 4 da modularização (etapa 1: COPIA pra criar a
// camada; próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: painters, escapeHtml, baStates, switchTab,
// showScreen, openUserProfile, openProfile, toast.
(function(){
  'use strict';

  // ══ LOAD PROFILE DYNAMICALLY ══
  function openProfile(id){
    if(typeof window!=='undefined'){ window.currentPainter = id; }
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
    // baStates é leftover de mock antigo nunca declarado — guard pra não crashar.
    if(typeof baStates !== 'undefined') baStates['ba-p']=false;  // eslint-disable-line no-undef
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

  // ══ PROFILE TABS ══
  function switchTab(n){
    ['works','vids','certs','reviews','cursos'].forEach(t=>{
      document.getElementById('ptab-'+t)?.classList.toggle('active',t===n);
      const el=document.getElementById('tab-'+t);
      if(el) el.style.display=t===n?'block':'none';
    });
  }

  window.Modules = window.Modules || {};
  window.Modules.profileMock = {
    openProfile, showPainterCard, openPainterPopupProfile, switchTab
  };
})();
