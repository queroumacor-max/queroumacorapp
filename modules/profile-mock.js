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
    // R23: painters[id] pode ser undefined se o caller passou um id inválido
    // (perfil real via openUserProfile, push notif velho, etc.). Sem o guard,
    // todo p.X abaixo crasha com "Cannot read property X of undefined".
    const p = (typeof painters === 'object' && painters && painters[id]) || null;
    if(!p){
      if(typeof toast === 'function') toast('Perfil indisponível');
      return;
    }

    // Hero
    const phAvatarImg = document.querySelector('.ph-avatar img');
    if(phAvatarImg) phAvatarImg.src = p.img || '';
    const phStatN = document.querySelectorAll('.ph-stat-n');
    if(phStatN[0]) phStatN[0].textContent = p.posts || 0;
    if(phStatN[1]) phStatN[1].textContent = p.seguidores || 0;
    if(phStatN[2]) phStatN[2].textContent = p.obras || 0;
    const phName=document.querySelector('.ph-name');
    if(phName) phName.innerHTML=escapeHtml(p.name||'')+(p.name && p.name.includes('✓')?'':' ✓')+(p.pro?' <span style="background:var(--p1);color:#fff;font-size:10px;padding:2px 8px;border-radius:20px;font-family:\'DM Sans\',sans-serif;font-weight:600">PRO</span>':'');
    const phBio = document.querySelector('.ph-bio');
    if(phBio) phBio.innerHTML=escapeHtml(p.bio||'').replace(/\n/g,'<br>');

    // Palette
    const pal=document.querySelector('.ph-palette');
    if(pal){
      const palette = Array.isArray(p.palette) ? p.palette : [];
      pal.innerHTML=palette.map(c=>`<div class="palette-dot" style="background:${c}"></div>`).join('');
    }

    // Rating summary — R23: valores numéricos podem ser undefined (perfil novo)
    const r5=+p.r5||0, r4=+p.r4||0, r3=+p.r3||0, r2=+p.r2||0, r1=+p.r1||0;
    const ratingTotal=(r5+r4+r3+r2+r1)||1;
    const crBig = document.querySelector('.cr-big-score');
    if(crBig) crBig.textContent=(+p.rating||0).toFixed(1);
    const crTotal = document.querySelector('.cr-total');
    if(crTotal) crTotal.textContent=(p.total||0)+' avaliações';
    const crBarFill = document.querySelectorAll('.cr-bar-fill');
    const crBarCount = document.querySelectorAll('.cr-bar-count');
    if(crBarFill[0]) crBarFill[0].style.width=(r5/ratingTotal*100)+'%';
    if(crBarCount[0]) crBarCount[0].textContent=r5;
    if(crBarFill[1]) crBarFill[1].style.width=(r4/ratingTotal*100)+'%';
    if(crBarCount[1]) crBarCount[1].textContent=r4;
    if(crBarFill[2]) crBarFill[2].style.width=(r3/ratingTotal*100)+'%';
    if(crBarCount[2]) crBarCount[2].textContent=r3;
    if(crBarFill[3]) crBarFill[3].style.width=(r2/ratingTotal*100)+'%';
    if(crBarCount[3]) crBarCount[3].textContent=r2;
    if(crBarFill[4]) crBarFill[4].style.width=(r1/ratingTotal*100)+'%';
    if(crBarCount[4]) crBarCount[4].textContent=r1;
    const crCatVal = document.querySelectorAll('.cr-cat-val');
    if(crCatVal[0]) crCatVal[0].textContent=(+p.rQual||0).toFixed(1);
    if(crCatVal[1]) crCatVal[1].textContent=(+p.rPont||0).toFixed(1);
    if(crCatVal[2]) crCatVal[2].textContent=(+p.rLimp||0).toFixed(1);

    // Portfolio BA
    const baA = document.getElementById('ba-p-a');
    const baB = document.getElementById('ba-p-b');
    if(baA) baA.src = p.baA || '';
    if(baB) baB.src = p.baB || '';
    // baStates é leftover de mock antigo nunca declarado — guard pra não crashar.
    if(typeof baStates !== 'undefined') baStates['ba-p']=false;  // eslint-disable-line no-undef
    if(baA) baA.style.opacity='1';
    if(baB) baB.style.opacity='0';

    // Portfolio grid — R24: imgs pode estar ausente em perfil novo
    const grid=document.querySelector('#tab-works .works-grid');
    if(grid){
      const imgs = Array.isArray(p.imgs) ? p.imgs : [];
      grid.innerHTML=imgs.map(u=>`<div class="works-grid-item" onclick="toast('Ver trabalho')"><img src="${u}" alt=""></div>`).join('');
    }

    // Specs — R24: specs pode estar ausente
    const specTags = document.querySelector('#tab-certs .spec-tags');
    if(specTags){
      const specs = Array.isArray(p.specs) ? p.specs : [];
      specTags.innerHTML=specs.map(s=>`<span style="background:var(--ink);color:#fff;padding:7px 14px;border-radius:20px;font-size:12.5px;font-weight:600;">${s}</span>`).join('');
    }

    // Certs — R24: certs pode estar ausente
    const certList = document.querySelector('#tab-certs .cert-list');
    if(certList){
      const certs = Array.isArray(p.certs) ? p.certs : [];
      certList.innerHTML=certs.map(c=>`
        <div class="cert-card" style="border-left:3px solid ${c.bc};">
          <div class="cert-ic" style="background:${c.bg};font-size:22px;">${c.ic}</div>
          <div class="cert-txt" style="flex:1"><div class="cert-n">${c.n}</div><div class="cert-o">${c.o}</div></div>
          <span style="background:#e8f5e9;color:#2e7d32;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;">✓ Verificado</span>
        </div>`).join('');
    }

    // Reviews — R24: reviews pode estar ausente
    const revList=document.querySelector('#tab-reviews .reviews-list');
    if(revList){
      const reviews = Array.isArray(p.reviews) ? p.reviews : [];
      const imgs2 = Array.isArray(p.imgs) ? p.imgs : [];
      revList.innerHTML=reviews.map(r=>{
        const stars=+r.stars||0;
        const filledStars='★'.repeat(stars)+'<span style="color:var(--border);">'+'★'.repeat(5-stars)+'</span>';
        return `<div class="rev-card">
          <div class="rev-head">
            <div class="rev-av"><img src="${r.img||''}" alt=""></div>
            <div style="flex:1"><div class="rev-name">${r.name||''}</div>
            <div style="display:flex;gap:10px;align-items:center;"><div style="color:var(--p1);font-size:14px;">${filledStars}</div><div class="rev-date" style="margin:0">${r.date||''}</div></div></div>
          </div>
          <div class="rev-text">${r.text||''}</div>
          ${r.photos && imgs2[0] && imgs2[1] ?`<div style="display:flex;gap:6px;margin-top:8px;"><img src="${imgs2[0]}" style="width:60px;height:60px;border-radius:8px;object-fit:cover;cursor:pointer" onclick="toast('Ver foto')"><img src="${imgs2[1]}" style="width:60px;height:60px;border-radius:8px;object-fit:cover;cursor:pointer" onclick="toast('Ver foto')"></div>`:''}
          <div style="display:flex;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
            <div style="text-align:center;flex:1"><div style="font-size:12px;color:var(--p1);">${'★'.repeat(+r.rQual||0)}</div><div style="font-size:10px;color:var(--muted);">Qualidade</div></div>
            <div style="text-align:center;flex:1"><div style="font-size:12px;color:var(--p1);">${'★'.repeat(+r.rPont||0)}</div><div style="font-size:10px;color:var(--muted);">Pontual</div></div>
            <div style="text-align:center;flex:1"><div style="font-size:12px;color:var(--p1);">${'★'.repeat(+r.rLimp||0)}</div><div style="font-size:10px;color:var(--muted);">Limpeza</div></div>
          </div>
        </div>`;
      }).join('')+`<div style="text-align:center;padding:14px 0;"><button onclick="toast('Carregando mais...')" style="background:none;border:1.5px solid var(--border);border-radius:20px;padding:9px 22px;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer;font-family:'DM Sans',sans-serif;">Ver todas as ${p.total||0} avaliações</button></div>`;
    }

    // Cursos — R24: cursos pode estar ausente
    const cursosTab=document.querySelector('#tab-cursos');
    const cursos = Array.isArray(p.cursos) ? p.cursos : [];
    if(cursosTab && cursos.length===0){
      cursosTab.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:36px;margin-bottom:10px;">📚</div><div style="font-size:14px;">Este pintor ainda não criou cursos.</div></div>';
    } else if(cursosTab) {
      cursosTab.innerHTML='<div style="font-size:13px;color:var(--muted);margin-bottom:14px;">Cursos criados por '+(p.name||'este pintor')+'</div>'+
      cursos.map(c=>`
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
    // R23: painters[id] pode ser undefined (id inválido / dados mock removidos)
    const p = (typeof painters === 'object' && painters && painters[id]) || null;
    if(!p){
      if(typeof toast === 'function') toast('Profissional indisponível');
      return;
    }
    const ppImg = document.getElementById('pp-img');
    if(ppImg) ppImg.src = p.img || '';
    const ppName = document.getElementById('pp-name');
    if(ppName) ppName.textContent = p.name || '';
    const ppSub = document.getElementById('pp-sub');
    if(ppSub){
      const firstSpec = (p.specs && p.specs[0]) || '';
      ppSub.textContent = p.sub || ((p.city||'') + (firstSpec ? ' · ' + firstSpec : ''));
    }
    const ppStars = document.getElementById('pp-stars');
    if(ppStars){
      const rating = +p.rating || 0;
      ppStars.textContent = '★'.repeat(Math.floor(rating)) + ' ' + rating.toFixed(1) + ' · ' + (p.total||0) + ' avaliações';
    }
    const pop = document.getElementById('painter-popup');
    if(!pop) return;
    pop.dataset.painterId = id;
    pop.classList.add('show');
    const ppBtn = pop.querySelector('.pp-btn');
    if(ppBtn) ppBtn.onclick = () => openProfile(id);
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
