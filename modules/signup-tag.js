// modules/signup-tag.js — feature "Validação de tag/handle no signup" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, toast, signupNext, tagAvailable
// (let no app.js — aqui escrevemos em window.tagAvailable pra manter o estado
// observável; quando essa cópia virar a fonte de verdade, app.js deixa de
// declarar a `let` e usa só window.tagAvailable).
(function(){
  'use strict';

  function setTagAvailable(v){
    window.tagAvailable = v;
    // se o app.js ainda tem a `let tagAvailable`, o call site original continua
    // mandando — esse módulo só vai virar fonte de verdade no PR de migração.
  }

  async function validateAndGoStep3(){
    const name = document.getElementById('s-name').value.trim();
    const tag = document.getElementById('s-tag').value.trim();
    const email = document.getElementById('s-email').value.trim();
    const pw = document.getElementById('s-pw').value;
    const phone = (document.getElementById('s-phone')||{}).value ? document.getElementById('s-phone').value.trim() : '';
    const cityField = (document.getElementById('s-city')||{}).value ? document.getElementById('s-city').value.trim() : '';
    const stateField = (document.getElementById('s-state')||{}).value ? document.getElementById('s-state').value.trim() : '';
    if(!name || name.includes('@')){ toast('Preencha seu nome (não use o email como nome)'); return; }
    if(!tag || tag.length < 3){ toast('Escolha uma tag com pelo menos 3 caracteres'); return; }
    if(!email){ toast('Preencha seu email'); return; }
    if(!phone){ toast('Preencha seu WhatsApp'); return; }
    if(!cityField){ toast('Preencha sua cidade'); return; }
    if(!stateField){ toast('Selecione seu estado'); return; }
    const bday = (document.getElementById('s-birthdate')||{}).value || '';
    if(!bday){ toast('Preencha sua data de nascimento'); return; }
    const _bd = new Date(bday);
    if(isNaN(_bd.getTime())){ toast('Data de nascimento inválida'); return; }
    if(!pw || pw.length < 8){ toast('Senha deve ter no minimo 8 caracteres'); return; }
    // Check tag availability before proceeding
    const statusEl = document.getElementById('tag-status');
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--muted)';
    statusEl.textContent = 'Verificando tag...';
    try {
      const sb = getSupabase();
      if(sb){
        const { data } = await sb.from('profiles_public').select('id').eq('tag', tag.toLowerCase()).limit(1);
        if(data && data.length > 0){
          statusEl.style.color = 'var(--p4)';
          statusEl.textContent = '@' + tag + ' já está em uso. Escolha outra tag.';
          setTagAvailable(false);
          return;
        }
      }
    } catch(e){ console.warn('Tag check error:', e && e.message || e); }
    setTagAvailable(true);
    statusEl.style.display = 'none';
    signupNext(3);
  }

  async function checkTagAvailability(){
    const tag = document.getElementById('s-tag').value.trim().toLowerCase();
    const statusEl = document.getElementById('tag-status');
    if(!tag || tag.length < 3){
      statusEl.style.display = 'none';
      setTagAvailable(false);
      return;
    }
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--muted)';
    statusEl.textContent = 'Verificando disponibilidade...';
    try {
      const sb = getSupabase();
      if(!sb){ setTagAvailable(true); statusEl.style.display = 'none'; return; }
      const { data, error } = await sb.from('profiles_public')
        .select('id')
        .eq('tag', tag)
        .limit(1);
      if(error) throw error;
      if(data && data.length > 0){
        statusEl.style.color = 'var(--p4)';
        statusEl.textContent = '@' + tag + ' já está em uso. Escolha outra tag.';
        setTagAvailable(false);
      } else {
        statusEl.style.color = 'var(--p6)';
        statusEl.textContent = '@' + tag + ' está disponível!';
        setTagAvailable(true);
      }
    } catch(e){
      console.warn('Tag check error:', e && e.message || e);
      setTagAvailable(true);
      statusEl.style.display = 'none';
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.signupTag = { validateAndGoStep3, checkTagAvailability };
})();
