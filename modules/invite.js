// modules/invite.js — feature "Convites" (códigos de convite) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, toast, withTimeout,
// appPrompt, validateInvite.
// O listener de boot (`if(document.readyState === 'loading') ...`) FICA no
// app.js — é boot code, não pertence ao módulo.
(function(){
  'use strict';

  // ══ INVITE CODE GENERATION ══
  // `generatedInviteCode` só é usado pelas funções deste módulo (confirmado
  // com grep no app.js: 3 ocorrências, todas aqui). Encapsular como var de
  // módulo (let interno no IIFE) é seguro.
  let generatedInviteCode = {};

  async function generateInviteCode(view){
    const sb = getSupabase();
    if(!sb){ toast('Erro: Supabase indisponível'); return; }
    const btn = document.getElementById('gen-invite-btn-' + view);
    const resetBtn = (txt) => { if(btn){ btn.textContent = txt; btn.disabled = false; } };
    if(btn){ btn.textContent = 'Gerando...'; btn.disabled = true; }
    try {
      // Usa currentUser direto. Antes await sb.auth.getSession() podia pendurar
      // (rede lenta) e o botão ficava preso em "Gerando...". Fallback: getSession
      // com timeout só se currentUser não estiver disponível.
      let uid = currentUser && currentUser.id;
      if(!uid){
        try {
          const r = await (typeof withTimeout === 'function' ? withTimeout(sb.auth.getSession(), 5000, 'getSession') : sb.auth.getSession());
          uid = r && r.data && r.data.session && r.data.session.user && r.data.session.user.id;
        } catch(_){}
      }
      if(!uid){ toast('Faça login primeiro'); resetBtn('Gerar código de convite'); return; }
      // Generate a unique code QUC-XXXXX
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = 'QUC-';
      for(let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
      // Mostra o código IMEDIATAMENTE — não depende do insert (que pode estar
      // lento). Persiste em background com timeout, sem travar a UI.
      generatedInviteCode[view] = code;
      const box = document.getElementById('my-invite-code-' + view);
      const val = document.getElementById('my-invite-code-value-' + view);
      const shareBtn = document.getElementById('share-invite-btn-' + view);
      if(box) box.style.display = 'block';
      if(val) val.textContent = code;
      if(shareBtn) shareBtn.style.display = 'block';
      resetBtn('Gerar novo código');
      toast('Código gerado!');
      const ins = sb.from('invites').insert({ code, created_by: uid, used: false, uses: 0, max_uses: 5 });
      (typeof withTimeout === 'function' ? withTimeout(ins, 8000, 'invite-insert') : ins)
        .then(res => { if(res && res.error) console.warn('invite insert:', res.error.code, res.error.message); })
        .catch(e => console.warn('invite insert (timeout/err):', e && e.message));
    } catch(e){
      console.error('generateInviteCode error:', e && e.message || e);
      toast('Erro ao gerar código');
      resetBtn('Gerar código de convite');
    }
  }

  async function shareInviteCode(view){
    const code = generatedInviteCode[view];
    if(!code){ toast('Gere um código primeiro'); return; }
    // Link que abre o app e pré-valida o código no signup (handler abaixo
    // lê ?invite= do URL e dispara validateInvite()).
    const link = (typeof window !== 'undefined' && window.location ? window.location.origin : 'https://queroumacor.com.br') + '/?invite=' + encodeURIComponent(code);
    const text = 'Oi! Use meu código ' + code + ' para se cadastrar no QueroUmaCor — o app pra pintores e clientes:\n' + link;
    if(navigator.share){
      // text + url: WhatsApp/Telegram renderizam o link clicável.
      try { await navigator.share({ title: 'Convite QueroUmaCor', text: text, url: link }); }
      catch(_){ /* usuário cancelou — silencioso */ }
    } else if(navigator.clipboard){
      navigator.clipboard.writeText(text).then(()=>toast('Convite copiado!')).catch(()=>toast(text));
    } else {
      await appPrompt('Copie o convite:', { initial: text });
    }
  }

  // Quando alguém abre o link compartilhado (?invite=QUC-XXXXX), pré-preenche
  // o campo de convite no signup e tenta validar automaticamente. Sem isso, o
  // link era só texto — o destinatário ainda tinha que digitar o código à mão.
  function _consumeInviteFromUrl(){
    try {
      const params = new URLSearchParams(window.location.search);
      const code = (params.get('invite') || '').trim().toUpperCase();
      if(!code) return;
      const setAndValidate = (attempt) => {
        attempt = attempt || 0;
        const input = document.getElementById('s-invite-code');
        if(!input){
          if(attempt < 20) setTimeout(() => setAndValidate(attempt+1), 250);
          return;
        }
        input.value = code;
        const sbReady = (typeof getSupabase === 'function') && getSupabase();
        if(sbReady && typeof validateInvite === 'function'){
          try { validateInvite(); } catch(e){ console.warn('auto-validate invite:', e && e.message); }
          // Limpa o ?invite= da URL pra não revalidar em reload.
          try { history.replaceState({}, '', window.location.pathname + window.location.hash); } catch(_){}
        } else if(attempt < 20){
          setTimeout(() => setAndValidate(attempt+1), 250);
        }
      };
      setAndValidate();
    } catch(e){ console.warn('consumeInviteFromUrl:', e && e.message); }
  }

  window.Modules = window.Modules || {};
  window.Modules.invite = {
    generateInviteCode, shareInviteCode, _consumeInviteFromUrl
  };
})();
