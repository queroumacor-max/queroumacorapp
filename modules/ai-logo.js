// modules/ai-logo.js — feature "Gerador de Logo IA + Camiseta personalizada"
// extraída do app.js. Fase 4 da modularização (etapa 1: COPIA pra criar a
// camada; próximo PR migra call sites e remove duplicatas do app.js).
//
// Cobre: geração de logo via IA (3 opções), fallback SVG offline, contador
// atômico de gerações (RPC bump_ai_logo_count), aplicação na camiseta mockup,
// salvar logo no perfil (storage `posts` + profiles.business_logo_url),
// upload manual de logo do PRO e baixar logo.
//
// Depende de globals do app.js: getSupabase, currentUser, escapeHtml, toast,
// appConfirm, apiPost, logoState, DB. Também depende de elementos do DOM
// (ai-logo-name, ai-logo-style, ai-logo-btn, ai-logo-grid, ai-logo-result,
// shirt-chest-logo, shirt-chest-placeholder, shirt-logo-pintor-chip,
// toggle-pintor, business-logo-btn).
(function(){
  'use strict';

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
  function _aiLogoSetCount(n){ _aiLogoCount = +n || 0; }
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
        const prof = await DB.profiles.getById(currentUser.id, 'business_logo_url, business_name');
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

  window.Modules = window.Modules || {};
  window.Modules.aiLogo = {
    // pure helpers
    _renderAiLogoSvg, _hashStr,
    // state
    _aiLogoGenCount, _aiLogoSetCount, _aiLogoBumpCount, _aiLogoUpdateBtn,
    _aiLogoCurrentSrc,
    // shirt apply
    _applyLogoToShirt, _applyOwnLogoToShirt,
    // user-facing actions
    gerarLogoIA, selectAiLogo, usarLogoIA, salvarLogoNoPerfil,
    baixarLogo, uploadBusinessLogo, loadBusinessLogo,
    // constants
    AI_LOGO_REGEN_PRICE_BRL
  };
})();
