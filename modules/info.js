// modules/info.js — feature "info" (página de ajuda / legal / contato).
// Fase 4 etapa 2: cópia fiel das funções top-level do app.js. App.js
// continua tendo os originais (sem regressão). Migração de call sites
// e remoção dos duplicados vem em PR futuro.
(function(){
  'use strict';

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
    if(!currentUser){ toast('Faça login'); return; }
    if(!(await appConfirm('Excluir conta? Vamos processar em até 15 dias úteis (LGPD). Você pode reabrir entrando em contato pelo email ' + (SUPPORT && SUPPORT.email || 'loja@calicolors.com.br') + '.', { okLabel:'Sim, excluir' }))) return;
    const reason = await appPrompt('(Opcional) Por que está excluindo?', '', { okLabel: 'Confirmar pedido' });
    if(reason === null) return;
    try {
      const sb = getSupabase();
      const { data, error } = await sb.rpc('request_account_deletion', { p_reason: reason || null });
      if(error) throw error;
      toast('Pedido registrado. Processaremos em até 15 dias. Você receberá confirmação por email.');
    } catch(e){
      console.warn('requestAccountDeletion:', e && e.message || e);
      toast('Erro: ' + (e && e.message || 'tente de novo'));
    }
  }

  // LGPD — baixar todos os dados do usuário (chama /api/me-export que retorna JSON).
  async function baixarMeusDados(){
    if(!currentUser){ toast('Faça login pra baixar seus dados'); return; }
    toast('Preparando seu arquivo...');
    try {
      const sb = getSupabase();
      const { data: { session } } = await sb.auth.getSession();
      if(!session) throw new Error('Sessão expirada');
      const r = await fetch('/api/me-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token })
      });
      if(!r.ok){
        const err = await r.json().catch(() => ({}));
        toast('Erro: ' + (err.error || 'tente de novo'));
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'queroumacor-meus-dados.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      toast('Download iniciado! ✅');
    } catch(e){
      console.warn('baixarMeusDados:', e && e.message || e);
      toast('Erro ao baixar dados — tente de novo');
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.info = {
    SUPPORT,
    openInfoPage, infoBack, supportWhatsApp, supportEmail,
    requestAccountDeletion, baixarMeusDados
  };
})();
