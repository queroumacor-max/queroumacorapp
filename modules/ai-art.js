// modules/ai-art.js — feature "Arte pra Instagram" (gerador de arte via IA) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: gateProClient, showModal, toast, apiPost,
// appAlert, getMyProfile, getSupabase, currentUser, closeModals, loadFeed,
// moderateContentAsync, SUPABASE_URL, _isAdmin.
// Pipeline: usuário escolhe estilo → foto(s) → /api/ig-art devolve arte (data URL)
// e legenda → usuário posta no feed ou baixa. PRO + rate-limit no backend.
// Antes/Depois usa 2 fotos (antes + depois); outros estilos usam só 1.
(function(){
  'use strict';

  // ══ AI ART GENERATOR (Instagram) ══
  let _aiArtPhotoDataUrl = null;     // base64 da foto principal (slot 1)
  let _aiArtPhotoDataUrl2 = null;    // base64 da segunda foto (slot 2, antes/depois)
  let _aiArtStyle = 'profissional';  // estilo default
  let _aiArtAspect = 'square';       // square | vertical | horizontal
  let _aiArtResultDataUrl = null;    // base64 da arte gerada FINAL (pode ter logo)
  let _aiArtResultCaption = '';
  let _aiArtResultOriginal = null;   // base64 da arte SEM logo (pra alternar checkbox)

  function openAiArt(){
    if(!gateProClient('Gerar arte pra Instagram com Seu Zé')) return;
    _aiArtReset();
    _aiArtLoadTemplates();        // carrega previews dos tiles do storage
    _aiArtToggleAdminButtons();   // mostra/esconde botão de upload
    _aiArtUpdateCreditsUI();      // mostra créditos restantes do dia
    showModal('ai-art-modal');
  }

  // Contador de créditos diário (5/dia, espelha o limit do backend).
  // Conta gerações com sucesso por usuário+dia; reseta automaticamente
  // ao virar o dia. Fonte da verdade real é o backend — isso é só UX.
  const _AI_ART_DAILY_LIMIT = 5;
  function _aiArtCreditsKey(){
    const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : 'anon';
    const d = new Date();
    const day = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    return 'igArt:credits:' + uid + ':' + day;
  }
  function _aiArtGetUsed(){
    try { return Math.max(0, parseInt(localStorage.getItem(_aiArtCreditsKey()) || '0', 10) || 0); }
    catch(_){ return 0; }
  }
  function _aiArtIncUsed(){
    try { localStorage.setItem(_aiArtCreditsKey(), String(_aiArtGetUsed() + 1)); } catch(_){}
  }
  function _aiArtMaxUsed(){
    try { localStorage.setItem(_aiArtCreditsKey(), String(_AI_ART_DAILY_LIMIT)); } catch(_){}
  }
  function _aiArtUpdateCreditsUI(){
    const used = _aiArtGetUsed();
    const left = Math.max(0, _AI_ART_DAILY_LIMIT - used);
    const num = document.getElementById('ai-art-credits-num');
    const wrap = document.getElementById('ai-art-credits');
    const btn = document.getElementById('ai-art-gen-btn');
    if(num) num.textContent = left + '/' + _AI_ART_DAILY_LIMIT;
    if(wrap){
      // verde 3-5, amarelo 1-2, vermelho 0
      const col = left >= 3 ? '#0a8a4f' : (left >= 1 ? '#c97a00' : '#c0392b');
      if(num) num.style.color = col;
      wrap.style.opacity = left === 0 ? '1' : '';
    }
    if(btn){
      if(left === 0){
        btn.disabled = true;
        btn.textContent = '🚫 Limite diário atingido — volta amanhã';
        btn.style.cursor = 'not-allowed';
        btn.style.opacity = '0.65';
      } else {
        btn.disabled = false;
        btn.textContent = '✨ Gerar arte com Seu Zé';
        btn.style.cursor = 'pointer';
        btn.style.opacity = '';
      }
    }
  }

  // Mostra o botão ✏️ de upload nos tiles só se o user logado for admin.
  function _aiArtToggleAdminButtons(){
    const show = (typeof _isAdmin !== 'undefined' && _isAdmin);
    document.querySelectorAll('.ai-art-tile-upload').forEach(b => {
      b.style.display = show ? 'flex' : 'none';
      if(show){
        b.style.alignItems = 'center';
        b.style.justifyContent = 'center';
      }
    });
  }

  // Carrega o template visual de cada estilo (Supabase storage ou fallback static)
  // como background do tile. Se nem o storage nem o static existirem, mantém o
  // fallback CSS-gradient já desenhado no HTML.
  function _aiArtLoadTemplates(){
    const styles = ['profissional', 'trabalho', 'antesdepois'];
    const supaUrl = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : '';
    for (const key of styles){
      const tile = document.querySelector(`#ai-art-styles .ai-art-style[data-style="${key}"] .ai-art-tile-preview`);
      if(!tile) continue;
      const candidates = [];
      if(supaUrl){
        for (const ext of ['jpg','png','webp']){
          candidates.push(`${supaUrl}/storage/v1/object/public/style-refs/${key}.${ext}?v=${Date.now()}`);
        }
      }
      candidates.push(`/style-refs/${key}.jpg`);
      _aiArtTryLoadFirstAvailable(tile, candidates, 0);
    }
  }

  function _aiArtTryLoadFirstAvailable(tile, urls, i){
    if(i >= urls.length) return;
    const img = new Image();
    img.onload = () => {
      tile.style.backgroundImage = `url('${urls[i]}')`;
      const fb = tile.querySelector('.ai-art-fallback');
      if(fb) fb.style.display = 'none';
    };
    img.onerror = () => _aiArtTryLoadFirstAvailable(tile, urls, i + 1);
    img.src = urls[i];
  }

  // Upload de template do tile (admin-only). Abre file picker → compacta →
  // envia pro /api/upload-style-ref → atualiza preview do tile.
  let _aiArtUploadingStyle = null;
  function _aiArtUploadTemplate(styleKey){
    if(typeof _isAdmin === 'undefined' || !_isAdmin){
      toast('Só admin pode trocar template');
      return;
    }
    _aiArtUploadingStyle = styleKey;
    const input = document.getElementById('ai-art-template-input');
    if(!input) return;
    // Limpa handler anterior pra evitar empilhar
    input.onchange = async function(){
      const f = input.files && input.files[0];
      input.value = '';
      if(!f) return;
      if(!f.type.startsWith('image/')){ toast('Selecione uma imagem'); return; }
      if(f.size > 4 * 1024 * 1024){ toast('Template muito grande (máx 4MB)'); return; }
      toast('Subindo template…');
      try {
        // Compacta pra ~1024px de lado maior (templates não precisam ser enormes)
        const compressed = await _compressImageFile(f, 1024, 0.85);
        const { ok, status, data, error } = await apiPost('/api/upload-style-ref', {
          styleKey: _aiArtUploadingStyle,
          photoDataUrl: compressed
        });
        if(!ok || !data || !data.ok){
          const msg = (data && data.error) || error || ('HTTP ' + status);
          toast('Falha: ' + msg);
          return;
        }
        toast('Template atualizado! ✨');
        // Atualiza o preview do tile imediatamente
        const tile = document.querySelector(`#ai-art-styles .ai-art-style[data-style="${_aiArtUploadingStyle}"] .ai-art-tile-preview`);
        if(tile){
          tile.style.backgroundImage = `url('${data.url}')`;
          const fb = tile.querySelector('.ai-art-fallback');
          if(fb) fb.style.display = 'none';
        }
      } catch(e){
        console.warn('_aiArtUploadTemplate:', e);
        toast('Erro ao subir template');
      }
    };
    input.click();
  }

  // Comprime via canvas pra reduzir tamanho do request (CF Pages Functions
  // rejeita body > ~1MB). Resultado: lado maior ≤ 512px, JPEG q=0.7.
  // Base64 final fica em ~80-200KB típico (muito abaixo do limite).
  function _compressImageFile(file, maxDim, quality){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
      reader.onload = e => {
        const img = new Image();
        img.onerror = () => reject(new Error('Falha ao decodificar imagem'));
        img.onload = () => {
          const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * ratio));
          const h = Math.max(1, Math.round(img.height * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          // Fundo branco caso a imagem tenha transparência (JPEG não suporta alpha)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          try {
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch(err){ reject(err); }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function _aiArtPickFile(input, slot){
    slot = (slot === 2) ? 2 : 1;
    const f = input && input.files && input.files[0];
    if(!f) return;
    if(!f.type.startsWith('image/')){ toast('Selecione uma imagem'); return; }
    if(f.size > 8 * 1024 * 1024){ toast('Foto muito grande (máx 8MB)'); return; }
    toast('Processando imagem...');
    try {
      const compressed = await _compressImageFile(f, 512, 0.7);
      const approxKB = Math.round(compressed.length * 0.75 / 1024);
      if(approxKB > 900){
        toast('Imagem ainda grande demais (' + approxKB + 'KB). Tente outra.');
        return;
      }
      if(slot === 2){
        _aiArtPhotoDataUrl2 = compressed;
        const img = document.getElementById('ai-art-preview-2');
        const drop = document.getElementById('ai-art-drop-2');
        const acts = document.getElementById('ai-art-photo-actions-2');
        if(img){ img.src = compressed; img.style.display = 'block'; }
        if(drop) drop.style.display = 'none';
        if(acts) acts.style.display = 'flex';
      } else {
        _aiArtPhotoDataUrl = compressed;
        const img = document.getElementById('ai-art-preview');
        const drop = document.getElementById('ai-art-drop');
        const acts = document.getElementById('ai-art-photo-actions');
        if(img){ img.src = compressed; img.style.display = 'block'; }
        if(drop) drop.style.display = 'none';
        if(acts) acts.style.display = 'flex';
      }
    } catch(e){
      console.warn('_aiArtPickFile compress:', e);
      toast('Erro ao processar imagem. Tente outra foto.');
    }
  }

  function _aiArtSetStyle(el){
    if(!el) return;
    _aiArtStyle = el.getAttribute('data-style') || 'profissional';
    const needsTwo = (el.getAttribute('data-photos') === '2');
    document.querySelectorAll('#ai-art-styles .ai-art-style').forEach(c => {
      c.classList.remove('sel');
      c.style.border = '2px solid var(--border)';
      c.style.background = '#fff';
    });
    el.classList.add('sel');
    el.style.border = '2px solid var(--p1)';
    el.style.background = 'rgba(255,107,53,.08)';

    // Atualiza UI das fotos: slot 1 sempre, slot 2 só pra antes/depois
    const slot2 = document.getElementById('ai-art-slot-2');
    const slot1Label = document.getElementById('ai-art-slot-1-label');
    const photoTitle = document.getElementById('ai-art-photo-title');
    if(needsTwo){
      if(slot2) slot2.style.display = 'block';
      if(slot1Label) slot1Label.textContent = 'FOTO ANTES';
      if(photoTitle) photoTitle.textContent = '2. Suas fotos (antes + depois)';
    } else {
      if(slot2) slot2.style.display = 'none';
      if(slot1Label) slot1Label.textContent = 'SUA FOTO';
      if(photoTitle) photoTitle.textContent = '2. Sua foto';
      // Limpa estado da foto 2 se trocou de antes/depois pra outro estilo
      _aiArtPhotoDataUrl2 = null;
      const img2 = document.getElementById('ai-art-preview-2');
      const drop2 = document.getElementById('ai-art-drop-2');
      const acts2 = document.getElementById('ai-art-photo-actions-2');
      if(img2){ img2.src = ''; img2.style.display = 'none'; }
      if(drop2) drop2.style.display = 'block';
      if(acts2) acts2.style.display = 'none';
    }
  }

  function _aiArtSetAspect(el){
    if(!el) return;
    _aiArtAspect = el.getAttribute('data-aspect') || 'square';
    document.querySelectorAll('#ai-art-aspects .ai-art-aspect').forEach(c => {
      c.classList.remove('sel');
      c.style.border = '2px solid var(--border)';
      c.style.background = '#fff';
    });
    el.classList.add('sel');
    el.style.border = '2px solid var(--p1)';
    el.style.background = 'rgba(255,107,53,.08)';
  }

  async function gerarArteIG(){
    const btn = document.getElementById('ai-art-gen-btn');
    // CRÍTICO: créditos IA são FINITOS (5/dia) — double-click chamaria
    // /api/ig-art 2x e queimaria 2 créditos do dia. Guard ANTES de tudo.
    if(btn && btn.dataset._loading) return;
    if(!_aiArtPhotoDataUrl){ toast('Escolha uma foto primeiro'); return; }
    if(_aiArtStyle === 'antesdepois' && !_aiArtPhotoDataUrl2){
      toast('Antes/Depois precisa de 2 fotos (antes e depois)'); return;
    }
    const restore = (typeof setButtonLoading === 'function')
      ? setButtonLoading(btn, '✨ Seu Zé tá pintando...')
      : (() => { if(btn){ btn.disabled = false; btn.textContent = '✨ Gerar arte com Seu Zé'; } });
    try {
      const businessName = (typeof getMyProfile === 'function')
        ? ((await getMyProfile())?.business_name || '')
        : '';
      const hint = (document.getElementById('ai-art-hint')?.value || '').trim();
      const payload = {
        photoDataUrl: _aiArtPhotoDataUrl,
        style: _aiArtStyle,
        aspect: _aiArtAspect,
        captionHint: hint,
        businessName
      };
      if(_aiArtStyle === 'antesdepois' && _aiArtPhotoDataUrl2){
        payload.photoDataUrl2 = _aiArtPhotoDataUrl2;
      }
      // Cancellable: se o usuário fechar o modal antes de o Seu Zé responder,
      // closeModals/hideModal dispara cancelApi('ai-art:gen') e a Promise
      // resolve com aborted=true. ATENÇÃO: o backend pode já ter consumido
      // o crédito; só não pintamos UI órfã. Se isso for um problema, mover
      // o _aiArtIncUsed() pra resposta confirmada (já é o que fazemos).
      const res = await apiPostCancellable('ai-art:gen', '/api/ig-art', payload);
      if (res && res.aborted) {
        console.info('ig-art: cancelado pelo usuário (modal fechado)');
        return;
      }
      const { ok, status, data, error } = res;
      if(status === 429){
        _aiArtMaxUsed();
        _aiArtUpdateCreditsUI();
        toast('Limite diário atingido (5/dia). Volta amanhã.');
        return;
      }
      if(!ok || !data || !data.imageDataUrl){
        // Mostra a causa real (modelo errado, sem permissão, etc) — não engole o erro
        let msg = (data && data.error) || error || ('HTTP ' + (status || '?'));
        if(data && data.detail) msg += ' — ' + data.detail;
        if(data && data.model_tried) msg += ' [modelo: ' + data.model_tried + ']';
        console.error('ig-art falhou:', { status, data, error });
        toast('Falha: ' + msg.slice(0, 80));
        if(msg.length > 80 && typeof appAlert === 'function'){
          appAlert('Detalhe técnico:\n\n' + msg);
        }
        return;
      }
      _aiArtIncUsed();
      _aiArtUpdateCreditsUI();
      _aiArtResultDataUrl = data.imageDataUrl;
      _aiArtResultOriginal = data.imageDataUrl;
      _aiArtResultCaption = String(data.caption || '');
      const resImg = document.getElementById('ai-art-result-img');
      const resCap = document.getElementById('ai-art-result-caption');
      const resBox = document.getElementById('ai-art-result');
      const logoChk = document.getElementById('ai-art-logo-toggle');
      if(logoChk) logoChk.checked = false;
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
      restore();
      // Se chegou no limite (response 429 ou _aiArtIncUsed bateu no teto),
      // reaplica o estado "limite atingido" — _aiArtUpdateCreditsUI cuida disso.
      try { _aiArtUpdateCreditsUI(); } catch(_){}
    }
  }

  // Sobrepõe a logo do pintor (business_logo_url) no canto superior direito
  // da arte gerada. Renderiza via canvas — não toca no backend. O usuário
  // pode marcar/desmarcar o checkbox livremente: guardamos a versão original
  // em _aiArtResultOriginal pra alternar sem perder qualidade.
  async function _aiArtToggleLogo(){
    const chk = document.getElementById('ai-art-logo-toggle');
    if(!chk) return;
    if(!_aiArtResultOriginal){ toast('Gere uma arte primeiro'); chk.checked = false; return; }
    if(!chk.checked){
      _aiArtResultDataUrl = _aiArtResultOriginal;
      const resImg = document.getElementById('ai-art-result-img');
      if(resImg) resImg.src = _aiArtResultDataUrl;
      return;
    }
    // Tenta logo do profile
    let logoUrl = '';
    try {
      const prof = (typeof getMyProfile === 'function') ? await getMyProfile() : null;
      logoUrl = (prof && prof.business_logo_url) || localStorage.getItem('business_logo_url') || '';
    } catch(_){ logoUrl = ''; }
    if(!logoUrl){
      toast('Você ainda não cadastrou sua logo. Sobe lá no seu perfil profissional.');
      chk.checked = false;
      return;
    }
    try {
      const composed = await _aiArtComposeWithLogo(_aiArtResultOriginal, logoUrl);
      _aiArtResultDataUrl = composed;
      const resImg = document.getElementById('ai-art-result-img');
      if(resImg) resImg.src = composed;
      toast('Logo aplicada ✨');
    } catch(e){
      console.warn('_aiArtToggleLogo:', e);
      toast('Não consegui aplicar a logo (' + (e?.message || 'erro') + ')');
      chk.checked = false;
    }
  }

  // Compõe arte + logo via canvas, devolve data URL PNG.
  // Logo entra dentro de um cartão branco arredondado pra ficar legível
  // sobre qualquer fundo. Tamanho ~16% da menor dimensão, margem de 4%.
  function _aiArtComposeWithLogo(artDataUrl, logoUrl){
    return new Promise((resolve, reject) => {
      const artImg = new Image();
      artImg.crossOrigin = 'anonymous';
      artImg.onload = () => {
        const logoImg = new Image();
        logoImg.crossOrigin = 'anonymous';
        logoImg.onload = () => {
          try {
            const W = artImg.naturalWidth, H = artImg.naturalHeight;
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            const ctx = c.getContext('2d');
            ctx.drawImage(artImg, 0, 0, W, H);
            // Cartão da logo no canto superior direito
            const minDim = Math.min(W, H);
            const box = Math.round(minDim * 0.16);
            const pad = Math.round(minDim * 0.04);
            const x = W - box - pad;
            const y = pad;
            const radius = Math.round(box * 0.18);
            // Sombra suave
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.25)';
            ctx.shadowBlur = Math.round(minDim * 0.015);
            ctx.shadowOffsetY = Math.round(minDim * 0.005);
            // Fundo branco arredondado
            ctx.fillStyle = '#fff';
            _aiArtRoundRect(ctx, x, y, box, box, radius);
            ctx.fill();
            ctx.restore();
            // Desenha logo dentro do cartão respeitando proporção (contain)
            const inner = Math.round(box * 0.78);
            const ix = x + (box - inner) / 2;
            const iy = y + (box - inner) / 2;
            const lw = logoImg.naturalWidth, lh = logoImg.naturalHeight;
            const scale = Math.min(inner / lw, inner / lh);
            const dw = lw * scale, dh = lh * scale;
            const dx = ix + (inner - dw) / 2;
            const dy = iy + (inner - dh) / 2;
            ctx.drawImage(logoImg, dx, dy, dw, dh);
            resolve(c.toDataURL('image/png'));
          } catch(err){ reject(err); }
        };
        logoImg.onerror = () => reject(new Error('logo não carregou'));
        logoImg.src = logoUrl;
      };
      artImg.onerror = () => reject(new Error('arte não carregou'));
      artImg.src = artDataUrl;
    });
  }

  function _aiArtRoundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y,   x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x,   y+h, r);
    ctx.arcTo(x,   y+h, x,   y,   r);
    ctx.arcTo(x,   y,   x+w, y,   r);
    ctx.closePath();
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
    _aiArtPhotoDataUrl2 = null;
    _aiArtResultDataUrl = null;
    _aiArtResultOriginal = null;
    _aiArtResultCaption = '';
    const logoChk = document.getElementById('ai-art-logo-toggle');
    if(logoChk) logoChk.checked = false;
    // Slot 1
    const img = document.getElementById('ai-art-preview');
    const drop = document.getElementById('ai-art-drop');
    const acts = document.getElementById('ai-art-photo-actions');
    const input = document.getElementById('ai-art-input');
    const inputCam = document.getElementById('ai-art-input-cam');
    if(img){ img.src = ''; img.style.display = 'none'; }
    if(drop) drop.style.display = 'block';
    if(acts) acts.style.display = 'none';
    if(input) input.value = '';
    if(inputCam) inputCam.value = '';
    // Slot 2
    const img2 = document.getElementById('ai-art-preview-2');
    const drop2 = document.getElementById('ai-art-drop-2');
    const acts2 = document.getElementById('ai-art-photo-actions-2');
    const input2 = document.getElementById('ai-art-input-2');
    const inputCam2 = document.getElementById('ai-art-input-cam-2');
    if(img2){ img2.src = ''; img2.style.display = 'none'; }
    if(drop2) drop2.style.display = 'block';
    if(acts2) acts2.style.display = 'none';
    if(input2) input2.value = '';
    if(inputCam2) inputCam2.value = '';
    // Resto
    const resBox = document.getElementById('ai-art-result');
    const hint = document.getElementById('ai-art-hint');
    if(resBox) resBox.style.display = 'none';
    if(hint) hint.value = '';
    // Reseta seleção pro default "profissional" + "square"
    const def = document.querySelector('#ai-art-styles .ai-art-style[data-style="profissional"]');
    if(def) _aiArtSetStyle(def);
    const defAsp = document.querySelector('#ai-art-aspects .ai-art-aspect[data-aspect="square"]');
    if(defAsp) _aiArtSetAspect(defAsp);
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

  window.Modules = window.Modules || {};
  window.Modules.aiArt = {
    openAiArt,
    _aiArtCreditsKey, _aiArtGetUsed, _aiArtIncUsed, _aiArtMaxUsed, _aiArtUpdateCreditsUI,
    _aiArtToggleAdminButtons,
    _aiArtLoadTemplates, _aiArtTryLoadFirstAvailable, _aiArtUploadTemplate,
    _compressImageFile,
    _aiArtPickFile,
    _aiArtSetStyle, _aiArtSetAspect,
    gerarArteIG,
    _aiArtToggleLogo, _aiArtComposeWithLogo, _aiArtRoundRect,
    _aiArtDownload, _aiArtReset, _aiArtPost
  };
})();
