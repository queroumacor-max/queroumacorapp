// modules/signup-flow.js — feature "signup-flow" (escolha de role + steps de
// signup) extraída do app.js. Fase 4 (etapa 1: COPIA pra criar a camada; o
// próximo PR migra call sites e remove duplicatas do app.js).
// NÃO inclui validateAndGoStep3 nem checkTagAvailability — já estão em
// modules/signup-tag.js.
// Depende de globals do app.js: getSupabase, toast, doRegisterSupabase, currentMode.
(function(){
  'use strict';

  // ── Estado top-level (copiado do app.js) ──
  let selectedRole = 'pintor';
  let validatedInviteCode = null;
  // Observação: não existe `signupStep` top-level no app.js; o passo atual
  // é derivado do DOM (#signup-step0..3). Mantido como referência aqui caso
  // alguém queira consumir do módulo.
  let signupStep = 0;

  // ── Constantes (copiadas do app.js) ──
  const _roleSpecs = {
    pintor: ['Residencial','Comercial','Textura','Grafiato','Piso Epóxi','Fachada','Degradê','Stencil','Industrial','Caiação'],
    grafiteiro: ['Grafite Artístico','Mural Decorativo','Painel Comercial','Arte Urbana','Lettering','Realismo','Abstrato','3D / Ilusão','Stencil Urbano','Lambe-lambe'],
    automotivo: ['Pintura Automotiva','Funilaria','Envelopamento','Polimento','Cristalização','Customização','Aerografia','Restauração','Martelinho de Ouro','PPF / Película']
  };
  const _proRoles = ['pintor','grafiteiro','automotivo'];

  // ── Funções ──
  function selectRole(r){
    selectedRole = r;
    ['pintor','grafiteiro','automotivo','cliente'].forEach(role=>{
      const el = document.getElementById('role-'+role);
      if(el) el.classList.toggle('active', r===role);
    });
  }

  async function validateInvite(){
    const code = document.getElementById('s-invite-code').value.trim().toUpperCase();
    const errEl = document.getElementById('invite-error');
    if(!code){ errEl.textContent='Insira o código de convite.'; errEl.style.display='block'; return; }
    errEl.style.display='none';

    try {
      const sb = getSupabase();
      const { data, error } = await sb.from('invites')
        .select('id, code, used, max_uses, uses, created_by')
        .eq('code', code)
        .single();

      if(error || !data){
        errEl.textContent='Código inválido. Verifique e tente novamente.';
        errEl.style.display='block';
        return;
      }
      if(data.used || (data.max_uses > 0 && data.uses >= data.max_uses)){
        errEl.textContent='Este convite já foi utilizado.';
        errEl.style.display='block';
        return;
      }
      validatedInviteCode = data;
      toast('Convite válido!');
      signupNext(1);
    } catch(e){
      // If table doesn't exist yet, allow signup anyway for development
      console.warn('Invite validation error:', e && e.message || e);
      validatedInviteCode = { code };
      toast('Convite aceito!');
      signupNext(1);
    }
  }

  function signupNext(step){
    signupStep = step;
    [0,1,2,3].forEach(s=>{
      const el = document.getElementById('signup-step'+s);
      if(el) el.style.display = s===step ? 'block' : 'none';
      const dot = document.getElementById('sdot'+s);
      if(dot) dot.classList.toggle('active', s===step);
    });
    if(step===3){
      document.getElementById('s3-pintor').style.display = isProfessionalRole(selectedRole) ? 'block' : 'none';
      document.getElementById('s3-cliente').style.display = selectedRole==='cliente' ? 'block' : 'none';
      if(isProfessionalRole(selectedRole)) loadSpecsForRole(selectedRole);
    }
    document.getElementById('screen-signup').querySelector('.auth-screen').scrollTop = 0;
  }

  async function doSignup(){
    // Dedupe-submit: desabilita o botão "Criar conta" enquanto a request roda
    const _btn = (typeof event !== 'undefined' && event && event.currentTarget) ||
                 (typeof event !== 'undefined' && event && event.submitter) ||
                 document.querySelector('#signup-step3 button.auth-btn:not(.secondary)');
    if(_btn) _btn.disabled = true;
    try {
      const name = document.getElementById('s-name').value.trim();
      const tag = document.getElementById('s-tag').value.trim();
      const email = document.getElementById('s-email').value.trim();
      const pw = document.getElementById('s-pw').value;
      const role = selectedRole || 'cliente';
      if(!name || name.includes('@') || !email || !pw){ toast('Preencha nome, email e senha corretamente'); return; }
      if(isProfessionalRole(role)){
        const selSpecs = document.querySelectorAll('#spec-grid .spec-chip.sel').length;
        if(selSpecs === 0){ toast('Selecione pelo menos uma especialidade'); return; }
      }

      // Mark invite as used
      if(validatedInviteCode && validatedInviteCode.id){
        try {
          const sb = getSupabase();
          await sb.from('invites').update({ uses: (validatedInviteCode.uses||0)+1 }).eq('id', validatedInviteCode.id);
        } catch(e){ console.warn('Could not update invite:', e && e.message || e); }
      }

      await doRegisterSupabase(name, email, pw, role, tag);
    } finally {
      if(_btn) _btn.disabled = false;
    }
  }

  function loadSpecsForRole(role){
    const grid = document.getElementById('spec-grid');
    if(!grid) return;
    const specs = _roleSpecs[role] || _roleSpecs['pintor'];
    grid.innerHTML = specs.map((s,i) => '<div class="spec-chip'+(i<2?' sel':'')+'" onclick="toggleSpec(this)">'+s+'</div>').join('');
  }

  function toggleSpec(el){ el.classList.toggle('sel'); }

  function isProfessionalRole(r){ return _proRoles.includes(r); }

  function selectProfession(el){
    document.querySelectorAll('.profession-card').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
  }

  function getSelectedProfession(){
    const active = document.querySelector('.profession-card.active');
    return active?.dataset.profession || 'pintor';
  }

  function setMode(mode){
    // currentMode é global do app.js — escreve via window pra evitar TDZ/escopo.
    window.currentMode = mode;
    const modePintor = document.getElementById('mode-pintor');
    const modeCliente = document.getElementById('mode-cliente');
    const isPro = isProfessionalRole(mode);
    if(modePintor) modePintor.classList.toggle('active', isPro);
    if(modeCliente) modeCliente.classList.toggle('active', mode==='cliente');
    // Visao unica e completa para todos os perfis: evita o swap por papel
    // (metadata -> DB) que fazia as caixinhas aparecerem e sumirem.
    const vp = document.getElementById('view-pintor');
    const vc = document.getElementById('view-cliente');
    if(vp) vp.style.display = 'block';
    if(vc) vc.style.display = 'none';
    const sa = document.getElementById('scroll-area');
    if(sa) sa.scrollTop = 0;
  }

  window.Modules = window.Modules || {};
  window.Modules.signupFlow = {
    selectRole, validateInvite, signupNext, doSignup,
    loadSpecsForRole, toggleSpec, isProfessionalRole,
    selectProfession, getSelectedProfession, setMode,
    get selectedRole(){ return selectedRole; },
    get validatedInviteCode(){ return validatedInviteCode; },
    get signupStep(){ return signupStep; }
  };
})();
