// modules/auth-pw.js — feature "Recuperação de senha" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, toast, handleSbError,
// _authRateCheck, closeModals, showScreen, showModal.
(function(){
  'use strict';

  async function sendPasswordReset(){
    const email = (document.getElementById('login-email')?.value || '').trim();
    if(!email || !/^\S+@\S+\.\S+$/.test(email)){ toast('Digite seu email no campo acima primeiro'); return; }
    const sb = getSupabase();
    if(!sb){ toast('Aguarde, carregando...'); return; }
    // Botão "Esqueceu a senha?" — pego via event.currentTarget (onclick inline).
    const btn = (typeof event !== 'undefined' && event && event.currentTarget) || null;
    if(btn && btn.dataset._loading) return; // double-submit guard
    // Rate limit advisory: bloqueia mais de 5 resets/min do mesmo IP.
    if(typeof _authRateCheck === 'function' && !(await _authRateCheck('reset'))) return;
    const restore = (typeof setButtonLoading === 'function') ? setButtonLoading(btn, 'Enviando...') : () => {};
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/update-password' });
      if(handleSbError(error)) return;
      toast('Email de recuperação enviado! Verifique sua caixa de entrada.');
    } catch(e){ console.warn('sendPasswordReset:', e && e.message || e); toast('Erro ao enviar email'); }
    finally { restore(); }
  }

  async function doSetNewPassword(){
    const newPw = (document.getElementById('reset-pw-new')?.value || '');
    const confirmPw = (document.getElementById('reset-pw-confirm')?.value || '');
    if(newPw.length < 8){ toast('A senha deve ter ao menos 8 caracteres'); return; }
    if(newPw !== confirmPw){ toast('As senhas não coincidem'); return; }
    const sb = getSupabase();
    if(!sb){ toast('Aguarde...'); return; }
    // Botão "Salvar nova senha" — type=submit dentro do form do modal reset-pw.
    const btn = document.querySelector('#reset-pw-modal button[type=submit]');
    if(btn && btn.dataset._loading) return; // double-submit guard
    const restore = (typeof setButtonLoading === 'function') ? setButtonLoading(btn, 'Salvando...') : () => {};
    try {
      const { error } = await sb.auth.updateUser({ password: newPw });
      if(handleSbError(error)) return;
      document.getElementById('reset-pw-new').value = '';
      document.getElementById('reset-pw-confirm').value = '';
      closeModals();
      toast('Senha alterada! Faça login com a nova senha.');
      showScreen('login');
    } catch(e){ console.warn('doSetNewPassword:', e && e.message || e); toast('Erro ao salvar senha'); }
    finally { restore(); }
  }

  // ══ UPDATE-PASSWORD SCREEN ══
  // Acionado quando o usuário chega via link de recuperação do email
  // (/update-password#access_token=...&type=recovery). O SDK do Supabase já
  // processa o hash e cria a sessão de recovery; aqui só confirmamos que ela
  // existe e abrimos o modal pro usuário digitar a nova senha.
  async function _initUpdatePasswordScreen(){
    try {
      const sb = getSupabase();
      if(!sb){ setTimeout(_initUpdatePasswordScreen, 300); return; }
      const { data: { session } } = await sb.auth.getSession();
      if(!session){
        toast('Link expirado ou inválido. Solicite um novo.');
        setTimeout(() => showScreen('login'), 2500);
        return;
      }
      showModal('reset-pw-modal');
    } catch(e){
      console.warn('_initUpdatePasswordScreen:', e && e.message || e);
      showScreen('login');
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.authPw = {
    sendPasswordReset, doSetNewPassword, _initUpdatePasswordScreen
  };
})();
