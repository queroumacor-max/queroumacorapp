// modules/autoresp.js — feature "Auto-respostas de chat" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Tudo pendurado em window.Modules.autoresp.
//
// Dependências globais (ainda no app.js): getSupabase, currentUser,
// currentChat, saveMsgLocal, openChat, loadChatList, toast.
(function(){
  'use strict';

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

  window.Modules = window.Modules || {};
  window.Modules.autoresp = {
    arToggle, arSync, loadAutoRespostas, maybeAutoReply, salvarAutoRespostas
  };
})();
