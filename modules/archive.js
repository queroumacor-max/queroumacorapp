// modules/archive.js — feature "Arquivar conversas" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, DB, toast,
// chatData, openChat.
// Coluna `profiles.archived_conversations` já existe no Supabase.
(function(){
  'use strict';

  // ══ ARQUIVAR CONVERSAS ══
  let archivedConvs = [];
  let archivedExpanded = false;

  async function loadArchivedConvs(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    try {
      const data = await DB.profiles.getById(currentUser.id, 'archived_conversations');
      if(data && Array.isArray(data.archived_conversations)){
        archivedConvs = data.archived_conversations;
        applyArchivedState();
      }
    } catch(e){ console.warn('loadArchivedConvs:', e && e.message || e); }
  }

  function saveArchivedConvs(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    sb.from('profiles').update({ archived_conversations: archivedConvs }).eq('id', currentUser.id)
      .then(({ error }) => { if(error) console.warn('saveArchivedConvs:', error.message); });
  }

  function initArchiveButtons(){
    document.querySelectorAll('.conv-item[data-conv-id]').forEach(item => {
      const convId = item.dataset.convId;
      // Add archive button
      const btn = document.createElement('button');
      btn.className = 'conv-archive-btn';
      btn.title = 'Arquivar';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
      btn.onclick = function(e){
        e.stopPropagation();
        archiveConversation(convId);
      };
      item.style.position = 'relative';
      item.appendChild(btn);
    });
    applyArchivedState();
  }

  function archiveConversation(convId){
    if(!archivedConvs.includes(convId)){
      archivedConvs.push(convId);
      saveArchivedConvs();
      toast('Conversa arquivada');
      applyArchivedState();
    }
  }

  function unarchiveConversation(convId){
    archivedConvs = archivedConvs.filter(id => id !== convId);
    saveArchivedConvs();
    toast('Conversa desarquivada');
    applyArchivedState();
  }

  function applyArchivedState(){
    const archivedSection = document.getElementById('archived-section');
    const archivedList = document.getElementById('archived-list');
    const archivedCount = document.getElementById('archived-count');

    // Hide archived from main list, show non-archived
    document.querySelectorAll('.conv-item[data-conv-id]').forEach(item => {
      const convId = item.dataset.convId;
      item.style.display = archivedConvs.includes(convId) ? 'none' : 'flex';
    });

    if(archivedConvs.length > 0){
      archivedSection.style.display = 'block';
      archivedCount.textContent = '(' + archivedConvs.length + ')';

      // Build archived list
      let html = '';
      archivedConvs.forEach(convId => {
        const item = document.querySelector(`.conv-item[data-conv-id="${convId}"]`);
        if(item){
          html += `<div style="display:flex;align-items:center;padding:10px 16px;background:var(--cream);border-bottom:1px solid var(--border);gap:10px;cursor:pointer;" onclick="openChat('${convId}')">
            <div style="flex:1;font-size:13px;color:var(--ink);font-weight:600;">${chatData[convId]?.name || convId}</div>
            <button onclick="event.stopPropagation();unarchiveConversation('${convId}')" style="background:none;border:1px solid var(--border);border-radius:8px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--muted);cursor:pointer;font-family:'DM Sans',sans-serif;">Desarquivar</button>
          </div>`;
        }
      });
      archivedList.innerHTML = html;
    } else {
      archivedSection.style.display = 'none';
    }
  }

  function toggleArchivedSection(){
    archivedExpanded = !archivedExpanded;
    document.getElementById('archived-list').style.display = archivedExpanded ? 'block' : 'none';
    document.getElementById('archived-chevron').style.transform = archivedExpanded ? 'rotate(180deg)' : '';
  }

  window.Modules = window.Modules || {};
  window.Modules.archive = {
    loadArchivedConvs, saveArchivedConvs, initArchiveButtons,
    archiveConversation, unarchiveConversation,
    applyArchivedState, toggleArchivedSection
  };
})();
