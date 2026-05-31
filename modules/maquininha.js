// modules/maquininha.js — feature "maquininha" (parceria de maquininha de cartão).
// Fase 4: cópia fiel das funções top-level do app.js. App.js continua tendo
// os originais (sem regressão). Migração de call sites e remoção dos
// duplicados vem em PR futuro.
(function(){
  'use strict';

  async function abrirMaquininha(){
    try {
      const sb = getSupabase();
      if(currentUser && sb){
        sb.from('feature_interest').insert({
          user_id: currentUser.id,
          feature: 'maquininha',
          action: 'click'
        }).then(()=>{}, ()=>{});
        // Pre-preenche o contato com o telefone do perfil, se o input estiver vazio
        const input = document.getElementById('maquininha-contato');
        if(input && !input.value){
          DB.profiles.getById(currentUser.id, 'phone')
            .then(d => { if(d && d.phone && !input.value){ input.value = d.phone; } }, ()=>{});
        }
      }
    } catch(e){ console.error('abrirMaquininha error:', e && e.message || e); }
    showModal('maquininha-modal');
  }

  async function entrarListaMaquininha(){
    const input = document.getElementById('maquininha-contato');
    const contato = input ? input.value.trim() : '';
    if(!currentUser){ toast('Faça login para entrar na lista'); return; }
    const sb = getSupabase();
    if(!sb){ toast('Sem conexão. Tente de novo.'); return; }
    try {
      const { error } = await sb.from('feature_interest').insert({
        user_id: currentUser.id,
        feature: 'maquininha',
        action: 'waitlist',
        contact: contato
      });
      if(error) throw error;
      toast('Pronto! Avisaremos você assim que a maquininha estiver disponível.');
      closeModals();
    } catch(e){
      showError('entrarListaMaquininha', e, 'Não conseguimos registrar — tente de novo.');
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.maquininha = {
    abrirMaquininha, entrarListaMaquininha
  };
})();
