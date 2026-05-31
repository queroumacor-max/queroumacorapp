// modules/checklist.js — feature "Checklist de Obra" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Tudo pendurado em window.Modules.checklist.
//
// Persiste no Supabase (tabela `checklists`). Os saves são enfileirados
// para evitar criar linhas duplicadas em cliques rápidos (o primeiro
// INSERT termina e fixa _checklistRowId antes do próximo).
//
// Dependências globais (ainda no app.js): escapeHtml, getSupabase,
// currentUser. Também referencia window._checklistItems via inline
// handlers em renderChecklist (onchange/onclick chamam funções globais),
// então as funções aqui mantêm o estado em variáveis de módulo e a
// migração final dos call sites acontece no próximo PR.
(function(){
  'use strict';

  // ══ CHECKLIST DE OBRA ══
  let _checklistItems = [];
  let _checklistRowId = null;
  let _checklistSaveQueue = Promise.resolve();
  const _checklistTemplates = {
    pintura: ['Proteger pisos com lona','Fita crepe em rodapés e batentes','Lixar paredes (lixa 150)','Aplicar massa corrida','Lixar massa (lixa 220)','Aplicar selador','1ª demão de tinta','2ª demão de tinta','Retoques finais','Limpeza do local'],
    textura: ['Proteger pisos e móveis','Preparar massa texturizada','Aplicar base/selador','Aplicar textura com desempenadeira','Aguardar secagem (4h)','Pintar sobre textura','Retoques','Limpeza'],
    epoxi: ['Lixar piso','Limpar com desengraxante','Aplicar primer epóxi','Aguardar 12h secagem','1ª demão epóxi','2ª demão epóxi','Aguardar 7 dias cura total','Entrega']
  };

  function renderChecklist(){
    const el = document.getElementById('checklist-items');
    if(!el) return;
    if(_checklistItems.length===0){
      // Empty state padronizado — usa Utils.emptyState via shim. Sem actionLabel
      // porque os botões de template já vivem fora do container (logo acima).
      el.innerHTML = emptyState({
        icon: '📋',
        title: 'Checklist vazio',
        message: 'Adicione itens manualmente ou escolha um template acima (Pintura, Textura, Epóxi) pra começar.'
      });
      return;
    }
    el.innerHTML = _checklistItems.map((item,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <input type="checkbox" ${item.done?'checked':''} onchange="_checklistItems[${i}].done=this.checked;saveChecklist()" style="width:18px;height:18px;accent-color:var(--p1);">
      <span style="flex:1;font-size:13px;${item.done?'text-decoration:line-through;color:var(--muted);':''}">${escapeHtml(item.text)}</span>
      <span onclick="_checklistItems.splice(${i},1);saveChecklist();renderChecklist()" style="cursor:pointer;color:var(--muted);font-size:16px;">&times;</span>
    </div>`).join('');
  }

  function addChecklistItem(){
    const input = document.getElementById('checklist-new');
    const text = input.value.trim(); if(!text) return;
    _checklistItems.push({text, done:false}); input.value='';
    saveChecklist(); renderChecklist();
  }

  function loadChecklistTemplate(type){
    _checklistItems = (_checklistTemplates[type]||[]).map(t=>({text:t,done:false}));
    saveChecklist(); renderChecklist();
  }

  async function loadChecklist(){
    const sb = getSupabase();
    if(!sb || !currentUser){ _checklistItems = []; _checklistRowId = null; renderChecklist(); return; }
    // Skeleton enquanto o Supabase responde — evita o "flash" de empty state
    // antes de saber se o usuário tem itens salvos.
    const el = document.getElementById('checklist-items');
    if(el) el.innerHTML = skeletonRows(4, { height: '40px', margin: '6px' });
    try {
      const { data } = await sb.from('checklists').select('id, items')
        .eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(1);
      if(data && data.length){
        _checklistRowId = data[0].id;
        _checklistItems = Array.isArray(data[0].items) ? data[0].items : [];
      } else { _checklistRowId = null; _checklistItems = []; }
    } catch(e){ console.warn('loadChecklist:', e && e.message || e); _checklistItems = []; _checklistRowId = null; }
    renderChecklist();
  }

  // Salva no Supabase. Os saves são enfileirados para que o primeiro
  // INSERT termine (e fixe _checklistRowId) antes do próximo, evitando
  // criar linhas duplicadas em cliques rápidos.
  function saveChecklist(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    const snapshot = JSON.parse(JSON.stringify(_checklistItems));
    _checklistSaveQueue = _checklistSaveQueue.then(async () => {
      try {
        if(_checklistRowId){
          await sb.from('checklists').update({ items: snapshot })
            .eq('id', _checklistRowId).eq('user_id', currentUser.id);
        } else {
          const { data } = await sb.from('checklists')
            .insert({ user_id: currentUser.id, title: 'Checklist de Obra', items: snapshot })
            .select('id').single();
          if(data && data.id) _checklistRowId = data.id;
        }
      } catch(e){ console.warn('saveChecklist:', e && e.message || e); }
    }).catch(e => { console.warn('checklist save:', e && e.message || e); _checklistSaveQueue = Promise.resolve(); });
  }

  window.Modules = window.Modules || {};
  window.Modules.checklist = {
    renderChecklist, addChecklistItem, loadChecklistTemplate, loadChecklist, saveChecklist
  };
})();
