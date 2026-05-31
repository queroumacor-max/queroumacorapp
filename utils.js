// @ts-check
// utils.js — funções utilitárias puras (sem DOM/rede pesado) extraídas
// do app.js. Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Tudo pendurado em window.Utils.
(function(){
  'use strict';

  // Helpers de formatação de R$ (pt-BR): aceita "500", "500,00", "1.500,00",
  // "1500.50" no input e devolve Number; o blur formata pra "1.500,00".
  /** @param {unknown} val @returns {number} */
  function parseBRL(val){
    const raw = String(val == null ? '' : val).trim();
    if(!raw) return 0;
    // Normaliza: tira pontos de milhar e usa ponto como decimal
    const n = Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  /** @param {HTMLInputElement | null | undefined} el @returns {void} */
  function fmtBRL(el){
    if(!el) return;
    const raw = String(el.value || '').trim();
    if(!raw){ return; }
    const n = parseBRL(raw);
    if(!Number.isFinite(n) || n < 0){ return; }
    el.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // adiciona esses atributos no HTML — não setar aqui por toast() pra evitar
  // recriar o live region a cada chamada (quebra anúncio).
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let tt;
  /** @param {string} msg @returns {void} */
  function toast(msg){
    const el=document.getElementById('toast-el');
    if(!el) return;
    // Garante role/aria-live mesmo se o HTML ainda não foi atualizado.
    if(!el.hasAttribute('role')) el.setAttribute('role','status');
    if(!el.hasAttribute('aria-live')) el.setAttribute('aria-live','polite');
    el.textContent=msg; el.classList.add('show');
    clearTimeout(tt); tt=setTimeout(()=>el.classList.remove('show'),2200);
  }

  // ══ MODALS ══
  /** @param {string} id @returns {void} */
  function showModal(id){
    // A11y: salva foco anterior pra restaurar depois e move foco pro 1º focável do modal
    window._lastFocus = document.activeElement;
    const m = document.getElementById(id);
    if(!m) return;
    m.classList.add('open');
    setTimeout(() => {
      const focusable = m.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if(focusable){ try { focusable.focus(); } catch(_){} }
    }, 50);
  }

  /** @returns {void} */
  function closeModals(){
    document.querySelectorAll('.overlay').forEach(m=>m.classList.remove('open'));
    // A11y: restaura foco no elemento que abriu o modal
    if(window._lastFocus && typeof window._lastFocus.focus === 'function'){
      try { window._lastFocus.focus(); } catch(_){}
    }
  }
  /** @param {string} id @returns {void} */
  function hideModal(id){
    document.getElementById(id)?.classList.remove('open');
    if(window._lastFocus && typeof window._lastFocus.focus === 'function'){
      try { window._lastFocus.focus(); } catch(_){}
    }
  }

  /** @param {unknown} str @returns {string} */
  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[ch]));
  }
  // Escapa um valor para uso DENTRO de uma string JS em atributo onclick="..."
  /** @param {unknown} str @returns {string} */
  function escapeJsArg(str){
    return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/[<>]/g, '');
  }

  /** @param {string | null | undefined} dateStr @returns {string} */
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

  /** @param {string | null | undefined} s @returns {string} */
  function stripEmail(s){
    if(!s) return s;
    return String(s).replace(/([A-Za-z0-9._%+\-]+)@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '@$1');
  }
  /**
   * @param {{ tag?: string, name?: string } | null | undefined} p
   * @param {string} [fb]
   * @returns {string}
   */
  function cleanHandle(p, fb){
    if(p && p.tag) return '@' + p.tag;
    return stripEmail((p && p.name) || fb || 'Usuário');
  }

  /** @param {File | null | undefined} file @returns {'video' | 'image'} */
  function getMediaType(file){
    if(!file) return 'image';
    if(file.type && file.type.startsWith('video/')) return 'video';
    const ext = file.name?.split('.').pop()?.toLowerCase();
    if(['mp4','webm','mov','avi'].includes(ext)) return 'video';
    return 'image';
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

  /** @param {string | null | undefined} u @returns {boolean} */
  function isVideoUrl(u){
    return /\.(mp4|webm|mov|m4v|ogg|ogv)(\?|#|$)/i.test(u || '');
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

  function _normTxt(s){ return ' '+String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')+' '; }

  function _hashStr(s){
    let h = 0;
    for(let i=0;i<s.length;i++){ h = ((h<<5) - h) + s.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }

  function _starStr(r){
    const n = Math.round(Number(r)||0);
    return '★★★★★'.slice(0,n) + '☆☆☆☆☆'.slice(0, 5-n);
  }

  function _agYmd(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }

  // Normaliza nome de cliente para dedup (lowercase + trim + colapsa espaços).
  /** @param {unknown} s @returns {string} */
  function crmNormName(s){
    return String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
  }

  // Meses inteiros entre uma data e hoje.
  /** @param {string | null | undefined} dateStr @returns {number | null} */
  function crmMonthsSince(dateStr){
    if(!dateStr) return null;
    const d = new Date(dateStr);
    if(isNaN(d.getTime())) return null;
    const now = new Date();
    let m = (now.getFullYear()-d.getFullYear())*12 + (now.getMonth()-d.getMonth());
    if(now.getDate() < d.getDate()) m -= 1;
    return Math.max(0, m);
  }

  // ── UX helpers (item #19/#20/#21/#22 do audit React) ─────────────────────

  // Desabilita botão + troca label durante async. Retorna função pra restaurar.
  // Uso:
  //   const restore = setButtonLoading(btn, 'Enviando...');
  //   try { await foo(); } finally { restore(); }
  function setButtonLoading(btn, label){
    if(!btn) return () => {};
    const origText = btn.textContent;
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    if(label) btn.textContent = label;
    btn.dataset._loading = '1';
    return () => {
      btn.disabled = wasDisabled;
      btn.textContent = origText;
      delete btn.dataset._loading;
    };
  }

  // Empty state padrão. Retorna HTML string pra injetar em container vazio.
  // Uso: el.innerHTML = emptyState({title:'Sem leads', message:'...', actionLabel:'Ver feed', actionOnclick:"showScreen('feed')"});
  function emptyState(opts){
    opts = opts || {};
    const icon = escapeHtml(opts.icon || '📭');
    const title = escapeHtml(opts.title || 'Nada por aqui');
    const message = escapeHtml(opts.message || '');
    const action = opts.actionLabel
      ? `<button type="button" onclick="${opts.actionOnclick || ''}" style="margin-top:14px;padding:10px 18px;background:var(--p1);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">${escapeHtml(opts.actionLabel)}</button>`
      : '';
    return `<div class="empty-state" style="text-align:center;padding:40px 20px;color:var(--muted);">
      <div style="font-size:48px;margin-bottom:12px;opacity:.7;">${icon}</div>
      <div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:6px;">${title}</div>
      <div style="font-size:13px;line-height:1.5;max-width:300px;margin:0 auto;">${message}</div>
      ${action}
    </div>`;
  }

  // Error state com botão "Tentar de novo". retryFn é registrado em
  // window.__retryHandlers via id único (evita escapar funções no onclick).
  function errorState(message, retryFn){
    const id = '_retry_' + Math.random().toString(36).slice(2,9);
    window.__retryHandlers = window.__retryHandlers || {};
    if(typeof retryFn === 'function') window.__retryHandlers[id] = retryFn;
    const button = retryFn
      ? `<button type="button" onclick="(function(){var f=window.__retryHandlers&&window.__retryHandlers['${id}'];if(f){delete window.__retryHandlers['${id}'];f();}})();" style="margin-top:14px;padding:10px 18px;background:var(--p1);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">Tentar de novo</button>`
      : '';
    return `<div class="error-state" style="text-align:center;padding:40px 20px;color:var(--muted);">
      <div style="font-size:48px;margin-bottom:12px;opacity:.7;">⚠️</div>
      <div style="font-size:14px;color:var(--ink);margin-bottom:6px;line-height:1.5;max-width:320px;margin-left:auto;margin-right:auto;">${escapeHtml(message)}</div>
      ${button}
    </div>`;
  }

  // Skeleton loading row — repete N vezes, retorna HTML string.
  // Usa CSS class .skel definida em styles.css com shimmer animation.
  function skeletonRows(count, opts){
    opts = opts || {};
    const height = opts.height || '64px';
    const margin = opts.margin || '8px';
    let html = '';
    for(let i = 0; i < (count || 3); i++){
      html += `<div class="skel" style="height:${height};margin-bottom:${margin};border-radius:10px;"></div>`;
    }
    return html;
  }

  window.Utils = {
    parseBRL, fmtBRL, toast,
    showModal, closeModals, hideModal,
    escapeHtml, escapeJsArg, getTimeAgo, stripEmail, cleanHandle,
    getMediaType, _compressImageFile, isVideoUrl, _extractVideoFrame,
    _normTxt, _hashStr, _starStr, _agYmd,
    crmNormName, crmMonthsSince,
    setButtonLoading, emptyState, errorState, skeletonRows
  };
})();
