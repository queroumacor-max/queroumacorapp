// modules/notes.js — feature "Anotações" (notas do pintor) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, requireSession,
// handleSbError, appConfirm, toast, escapeHtml.
// Tabela `notes` já existe no Supabase (com RLS + realtime).
(function(){
  'use strict';

  // ══ ANOTAÇÕES (notas do pintor) ══
  let _editingNoteId = null;

  function startEditNote(id){ _editingNoteId = id; loadNotes(); }
  function cancelEditNote(){ _editingNoteId = null; loadNotes(); }

  async function saveEditNote(id){
    const ta = document.getElementById('edit-note-'+id);
    const body = ta ? ta.value.trim() : '';
    if(!body){ toast('Escreva algo na anotação'); return; }
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    const { error } = await sb.from('notes').update({ body }).eq('id', id).eq('user_id', currentUser.id);
    if(handleSbError(error)) return;
    _editingNoteId = null;
    toast('Anotação atualizada ✅');
    loadNotes();
  }

  async function loadNotes(){
    const sb = getSupabase();
    const list = document.getElementById('notes-list');
    if(!list) return;
    if(!sb || !currentUser){ list.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px;">Faça login para usar as anotações.</div>'; return; }
    // Skeleton enquanto carrega — feedback visual mais próximo do layout final
    // que o "Carregando..." textual anterior.
    list.innerHTML = skeletonRows(3, { height: '64px' });
    try {
      const { data, error } = await sb.from('notes').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false});
      if(error) throw error;
      const notes = data || [];
      if(!notes.length){
        list.innerHTML = emptyState({
          icon: '📝',
          title: 'Sem anotações',
          message: 'Crie sua primeira anotação. Lembretes, medidas e recados de obra ficam salvos no seu perfil.'
        });
        return;
      }
      const _notesHdr = '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:4px 0 10px;">Anotações salvas ('+notes.length+')</div>';
      list.innerHTML = _notesHdr + notes.map(n => {
        const date = n.created_at ? new Date(n.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
        if(n.id === _editingNoteId){
          return '<div style="background:var(--cream);border-radius:11px;padding:12px;margin-bottom:8px;">'
            + '<textarea id="edit-note-'+n.id+'" rows="3" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid var(--p1);border-radius:8px;font-size:13px;font-family:DM Sans,sans-serif;outline:none;resize:vertical;">'+escapeHtml(n.body||'')+'</textarea>'
            + '<div style="display:flex;gap:8px;margin-top:8px;">'
            +   '<button onclick="saveEditNote(\''+n.id+'\')" style="flex:1;padding:9px;background:var(--ink);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Salvar</button>'
            +   '<button onclick="cancelEditNote()" style="flex:1;padding:9px;background:var(--white);color:var(--ink);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Cancelar</button>'
            + '</div></div>';
        }
        return '<div style="background:var(--cream);border-radius:11px;padding:12px;margin-bottom:8px;">'
          + '<div style="font-size:13px;color:var(--ink);line-height:1.5;white-space:pre-wrap;">'+escapeHtml(n.body||'')+'</div>'
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">'
          + '<span style="font-size:10px;color:var(--muted);">'+date+'</span>'
          + '<span style="font-size:11px;">'
          +   '<span onclick="startEditNote(\''+n.id+'\')" style="color:var(--ink);cursor:pointer;font-weight:600;margin-right:14px;">Editar</span>'
          +   '<span onclick="deletarNota(\''+n.id+'\')" style="color:var(--p4);cursor:pointer;font-weight:600;">Excluir</span>'
          + '</span>'
          + '</div></div>';
      }).join('');
    } catch(e){
      console.warn('loadNotes:', e && e.message || e);
      list.innerHTML = errorState('Erro ao carregar anotações.', () => loadNotes());
    }
  }

  // Guard de double-submit: o botão "Salvar anotação" pode receber double-click
  // rápido — sem isso, a nota duplicava no DB. Marca o botão via dataset._loading
  // (compatível com setButtonLoading do Utils) e restaura no finally.
  async function salvarNota(){
    const btn = document.querySelector('button[onclick="salvarNota()"]');
    if(btn && btn.dataset._loading) return;
    const ctx = requireSession();
    if(!ctx) return;
    const sb = ctx.sb;
    const ta = document.getElementById('note-new');
    const body = ta ? ta.value.trim() : '';
    if(!body){ toast('Escreva algo na anotação'); return; }
    const restoreBtn = btn ? setButtonLoading(btn, 'Salvando...') : (()=>{});
    try {
      const { error } = await sb.from('notes').insert({ user_id: currentUser.id, body });
      if(handleSbError(error, 'Erro ao salvar')) return;
      if(ta) ta.value = '';
      toast('Anotação salva ✅');
      loadNotes();
    } finally { restoreBtn(); }
  }

  async function deletarNota(id){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    if(!(await appConfirm('Excluir esta anotação?', { okLabel:'Excluir' }))) return;
    const { error } = await sb.from('notes').delete().eq('id', id).eq('user_id', currentUser.id);
    if(handleSbError(error)) return;
    toast('Anotação excluída');
    loadNotes();
  }

  window.Modules = window.Modules || {};
  window.Modules.notes = {
    startEditNote, cancelEditNote, saveEditNote,
    loadNotes, salvarNota, deletarNota
  };
})();
