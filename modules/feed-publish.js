// modules/feed-publish.js — feature "Publicar post no feed" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, currentMode,
// toast, showModal, openUserProfile, getMediaType, gateProClient, apiPost,
// moderateContentAsync, parseBRL, closeModals, showError, loadFeed.
// Estado `currentPostType` e `postSelectedFiles` ficam encapsulados no módulo.
(function(){
  'use strict';

  // ══════════════════════════════
  //  CHANGE 1: DYNAMIC FEED
  // ══════════════════════════════
  let currentPostType = 'post';
  function setPostType(type){
    currentPostType = type;
    const storyBtn = document.getElementById('post-type-story');
    const postBtn = document.getElementById('post-type-post');
    // R23: pode ser chamado antes do modal carregar — guard nos botões
    if(storyBtn && postBtn){
      if(type === 'story'){
        storyBtn.style.background = 'var(--ink)'; storyBtn.style.color = '#fff';
        postBtn.style.background = 'var(--white)'; postBtn.style.color = 'var(--ink)';
      } else {
        postBtn.style.background = 'var(--ink)'; postBtn.style.color = '#fff';
        storyBtn.style.background = 'var(--white)'; storyBtn.style.color = 'var(--ink)';
      }
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

  // ══════════════════════════════
  //  CHANGE 2: POSTING SYSTEM
  // ══════════════════════════════
  let postSelectedFiles = [];

  function handlePostFiles(input){
    // R23: input.files pode ser null se o handler vier de um trigger sintético
    const files = (input && input.files) ? Array.from(input.files) : [];
    if(!files.length) return;
    postSelectedFiles = [files[0]]; // only 1 image for story
    const previewArea = document.getElementById('post-preview-area');
    const previewImages = document.getElementById('post-preview-images');
    const pickerArea = document.getElementById('post-picker-area');
    if(previewArea) previewArea.style.display = 'block';
    if(pickerArea) pickerArea.style.display = 'none';
    if(!previewImages) return;
    previewImages.innerHTML = '';
    const url = URL.createObjectURL(files[0]);
    previewImages.innerHTML = getMediaType(files[0]) === 'video'
      ? `<video src="${url}" controls playsinline class="post-preview-img" style="max-height:200px;border-radius:10px;object-fit:cover;background:#000;"></video>`
      : `<img src="${url}" class="post-preview-img" style="max-height:200px;border-radius:10px;object-fit:cover;">`;
  }

  function clearPostImages(){
    postSelectedFiles = [];
    const previewArea = document.getElementById('post-preview-area');
    const pickerArea = document.getElementById('post-picker-area');
    const fileInput = document.getElementById('post-file-input');
    if(previewArea) previewArea.style.display = 'none';
    if(pickerArea) pickerArea.style.display = 'block';
    if(fileInput) fileInput.value = '';
  }

  // Gera legenda + hashtags do post a partir da mídia selecionada (PRO).
  // Foto: enviada direta. Vídeo: extrai um frame ~1s dentro via canvas e
  // envia como JPG — backend só sabe processar imagem.
  async function gerarLegendaPost(btn){
    // Double-submit guard: ignora cliques repetidos enquanto a legenda gera.
    if(btn && btn.dataset._loading) return;
    if (!gateProClient('Gerar legenda com Seu Zé')) return;
    if(!postSelectedFiles || postSelectedFiles.length === 0){
      toast('Selecione uma foto ou vídeo primeiro');
      return;
    }
    const file = postSelectedFiles[0];
    const isVideo = getMediaType(file) === 'video';
    if(file.size > 50 * 1024 * 1024){
      toast(isVideo ? 'Vídeo grande demais (máx 50 MB)' : 'Foto muito grande (máx 8 MB)');
      return;
    }
    if(!isVideo && file.size > 8 * 1024 * 1024){
      toast('Foto muito grande (máx 8 MB)');
      return;
    }
    const ta = document.getElementById('post-text-input');
    const orig = btn ? btn.innerHTML : '';
    if(btn){ btn.disabled = true; btn.innerHTML = '✨ Gerando...'; btn.dataset._loading = '1'; }
    toast(isVideo ? 'Extraindo frame do vídeo...' : 'Gerando legenda com Seu Zé...');
    try {
      let imgBlob;
      let imgName;
      if(isVideo){
        try { imgBlob = await _extractVideoFrame(file); }
        catch(e){ console.warn('frame extract:', e); toast('Não consegui ler o vídeo. Tente outro arquivo.'); return; }
        imgName = 'frame.jpg';
      } else {
        imgBlob = file;
        imgName = file.name || 'foto.jpg';
      }
      toast('Gerando legenda com Seu Zé...');
      const fd = new FormData();
      fd.append('image', imgBlob, imgName);
      // Cancellable: se o usuário fechar o composer antes da legenda chegar
      // (rede lenta), aborta — não pinta texto no textarea órfão.
      const res = await apiPostCancellable('post:caption', '/api/caption', fd, { multipart: true });
      if (res && res.aborted) {
        console.info('caption: cancelado pelo usuário (modal fechado)');
        return;
      }
      const { ok, status, data, error } = res;
      if(!ok){
        toast('Não foi possível gerar a legenda agora');
        console.warn('caption error:', (data && data.error) || error || status);
        return;
      }
      const caption = (data?.caption || '').toString().trim();
      // R24: data.hashtags pode vir null/undefined do backend
      const hashtags = Array.isArray(data?.hashtags) ? data.hashtags.filter(h => typeof h === 'string') : [];
      if(!caption && hashtags.length === 0){
        toast('O Seu Zé não devolveu nada — tente outra mídia');
        return;
      }
      // R23: ta pode não existir se o modal foi fechado durante a geração
      if(!ta){ toast('Modal fechou — legenda perdida'); return; }
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
      if(btn){ btn.disabled = false; btn.innerHTML = orig; delete btn.dataset._loading; }
    }
  }

  // Extrai um frame ~1s dentro do vídeo via <video> + canvas, retorna Blob JPG.
  function _extractVideoFrame(file){
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.src = url;
      let done = false;
      const cleanup = () => { try { URL.revokeObjectURL(url); } catch(_){} };
      const fail = (msg) => { if(done) return; done = true; cleanup(); reject(new Error(msg)); };
      const timer = setTimeout(() => fail('timeout lendo vídeo'), 15000);
      v.addEventListener('loadedmetadata', () => {
        const target = Math.min(1, Math.max(0, (v.duration || 2) * 0.25));
        try { v.currentTime = target; } catch(_) { v.currentTime = 0; }
      });
      v.addEventListener('seeked', () => {
        if(done) return;
        try {
          const w = v.videoWidth || 720;
          const h = v.videoHeight || 1280;
          const maxSide = 1280;
          const scale = Math.min(1, maxSide / Math.max(w, h));
          const cw = Math.round(w * scale);
          const ch = Math.round(h * scale);
          const c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          const ctx = c.getContext('2d');
          ctx.drawImage(v, 0, 0, cw, ch);
          c.toBlob(blob => {
            done = true; clearTimeout(timer); cleanup();
            if(!blob) return reject(new Error('canvas vazio'));
            resolve(blob);
          }, 'image/jpeg', 0.85);
        } catch(e){ fail('canvas: ' + (e?.message || e)); }
      });
      v.addEventListener('error', () => fail('vídeo não carregou'));
    });
  }

  async function publishPost(){
    const sb = getSupabase();
    if(!sb){ toast('Erro: Supabase indisponível'); return; }
    const btn = document.getElementById('post-publish-btn');
    // Double-submit guard: ignora cliques repetidos enquanto publica.
    if(btn && btn.dataset._loading) return;
    const type = currentPostType; // 'story' or 'post'
    try {
      const { data:{ session } } = await sb.auth.getSession();
      if(!session){ toast('Faça login para publicar'); return; }
      // R23: textarea pode não existir se modal já fechou
      const ta = document.getElementById('post-text-input');
      const content = (ta && ta.value ? ta.value.trim() : '');

      // Story requires image; Post can be text-only
      if(type === 'story' && postSelectedFiles.length === 0){
        toast('Adicione uma imagem para o story');
        return;
      }
      if(type === 'post' && postSelectedFiles.length === 0 && !content){
        toast('Adicione uma imagem ou texto');
        return;
      }

      if(btn){
        btn.textContent = 'Publicando...';
        btn.disabled = true;
        btn.dataset._loading = '1';
      }
      let imageUrl = null;

      // Upload image if selected
      if(postSelectedFiles.length > 0){
        const file = postSelectedFiles[0];
        const ext = (file.name.split('.').pop() || '').toLowerCase() || (getMediaType(file) === 'video' ? 'mp4' : 'jpg');
        const path = session.user.id + '/' + Date.now() + '.' + ext;
        const { error: upError } = await sb.storage.from('posts').upload(path, file, {
          contentType: file.type || (getMediaType(file) === 'video' ? 'video/mp4' : 'image/jpeg'),
          upsert: false
        });
        if(upError){
          console.error('Upload error:', upError && upError.message || upError);
          toast('Erro no upload: ' + upError.message);
          if(btn){ btn.textContent = 'Publicar'; btn.disabled = false; delete btn.dataset._loading; }
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
        if(btn){ btn.textContent = 'Publicar'; btn.disabled = false; delete btn.dataset._loading; }
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

      if(btn){
        btn.textContent = 'Publicar';
        btn.disabled = false;
        delete btn.dataset._loading;
      }

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
        // R23: textarea pode já não existir após closeModals
        const taPost = document.getElementById('post-text-input');
        if(taPost) taPost.value = '';
        clearPostImages();
        // Reset type to story for next time
        setPostType('story');
        await loadFeed();
      }
    } catch(e) {
      showError('publish-post', e, 'Não foi possível publicar o post.');
      if(btn){ btn.textContent = 'Publicar'; btn.disabled = false; delete btn.dataset._loading; }
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.feedPublish = {
    setPostType, openPortfolioComposer, previewPublicProfile,
    handlePostFiles, clearPostImages, gerarLegendaPost, publishPost
  };
})();
