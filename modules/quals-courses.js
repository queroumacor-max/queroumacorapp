// modules/quals-courses.js — feature "Qualificações + Cursos" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, requireSession,
// showModal, toast, escapeHtml, showError, parseBRL.
// Tabelas `qualifications` e `courses` já existem no Supabase.
(function(){
  'use strict';

  // ══ QUALIFICAÇÕES (formações) ══
  function openManageQuals(){
    if(!currentUser){ toast('Faça login'); return; }
    showModal('manage-quals-modal');
    loadQualsList();
  }

  async function loadQualsList(){
    const box = document.getElementById('quals-list');
    const sb = getSupabase();
    if(!box || !sb || !currentUser) return;
    try {
      const { data } = await sb.from('qualifications').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
      if(!data || !data.length){ box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Nenhuma formação cadastrada.</div>'; return; }
      box.innerHTML = data.map(q => `<div style="display:flex;align-items:center;gap:10px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;">
        <span style="font-size:20px;">${escapeHtml(q.icon||'🎓')}</span>
        <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${escapeHtml(q.title)}</div><div style="font-size:11px;color:var(--muted);">${escapeHtml(q.org||'')}${q.year?' · '+escapeHtml(q.year):''}</div></div>
        <button onclick="deleteQualification('${q.id}',this)" style="background:none;border:none;color:#e63946;font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>
      </div>`).join('');
    } catch(e){ console.warn('loadQualsList:', e && e.message || e); box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Erro ao carregar.</div>'; }
  }

  async function addQualification(btn){
    // Double-submit guard: ignora clique repetido enquanto request roda
    if(btn && btn.dataset._loading) return;
    const title = document.getElementById('q-title').value.trim();
    if(!title){ toast('Informe o título'); return; }
    const ctx = requireSession('Faça login');
    if(!ctx) return;
    const sb = ctx.sb;
    const restore = (typeof setButtonLoading === 'function')
      ? setButtonLoading(btn, 'Salvando...')
      : (() => { if(btn){ btn.disabled = false; btn.textContent = 'Adicionar'; } });
    if(typeof setButtonLoading !== 'function' && btn){ btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      const { error } = await sb.from('qualifications').insert({
        user_id: currentUser.id,
        title,
        org: document.getElementById('q-org').value.trim() || null,
        year: document.getElementById('q-year').value.trim() || null,
        icon: document.getElementById('q-icon').value.trim() || '🎓'
      });
      if(error) throw error;
      document.getElementById('q-title').value = '';
      document.getElementById('q-org').value = '';
      document.getElementById('q-year').value = '';
      document.getElementById('q-icon').value = '🎓';
      toast('Formação adicionada');
      loadQualsList();
    } catch(e){ showError('add-qualification', e, 'Não foi possível adicionar a formação.'); }
    finally { restore(); }
  }

  async function deleteQualification(id, el){
    const sb = getSupabase();
    if(!sb) return;
    try {
      const { error } = await sb.from('qualifications').delete().eq('id', id);
      if(error) throw error;
      const card = el.closest('div'); if(card) card.remove();
      toast('Removido');
    } catch(e){ console.error('deleteQualification:', e && e.message || e); toast('Erro ao remover'); }
  }

  // ══ CURSOS (courses) ══
  function openManageCourses(){
    if(!currentUser){ toast('Faça login'); return; }
    showModal('manage-courses-modal');
    loadCoursesList();
  }

  async function loadCoursesList(){
    const box = document.getElementById('courses-list');
    const sb = getSupabase();
    if(!box || !sb || !currentUser) return;
    try {
      const { data } = await sb.from('courses').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
      if(!data || !data.length){ box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Nenhum curso cadastrado.</div>'; return; }
      box.innerHTML = data.map(c => `<div style="display:flex;align-items:center;gap:10px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;">
        ${c.cover_url?`<img src="${escapeHtml(c.cover_url)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">`:'<span style="font-size:24px;">📚</span>'}
        <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${escapeHtml(c.title)}</div><div style="font-size:11px;color:var(--muted);">${c.is_free?'Grátis':('R$'+Number(c.price||0).toFixed(2).replace('.',','))}${c.duration?' · '+escapeHtml(c.duration):''}</div></div>
        <button onclick="deleteCourse('${c.id}',this)" style="background:none;border:none;color:#e63946;font-size:18px;cursor:pointer;padding:4px 8px;">✕</button>
      </div>`).join('');
    } catch(e){ console.warn('loadCoursesList:', e && e.message || e); box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Erro ao carregar.</div>'; }
  }

  async function addCourse(btn){
    // Double-submit guard: ignora clique repetido enquanto request roda
    if(btn && btn.dataset._loading) return;
    const title = document.getElementById('c-title').value.trim();
    if(!title){ toast('Informe o título'); return; }
    const ctx = requireSession('Faça login');
    if(!ctx) return;
    const sb = ctx.sb;
    const restore = (typeof setButtonLoading === 'function')
      ? setButtonLoading(btn, 'Salvando...')
      : (() => { if(btn){ btn.disabled = false; btn.textContent = 'Adicionar curso'; } });
    if(typeof setButtonLoading !== 'function' && btn){ btn.disabled = true; btn.textContent = 'Salvando...'; }
    try {
      const isFree = document.getElementById('c-free').checked;
      const { error } = await sb.from('courses').insert({
        user_id: currentUser.id,
        title,
        subtitle: document.getElementById('c-sub').value.trim() || null,
        cover_url: document.getElementById('c-cover').value.trim() || null,
        link: document.getElementById('c-link').value.trim() || null,
        duration: document.getElementById('c-duration').value.trim() || null,
        is_free: isFree,
        price: isFree ? null : (parseBRL(document.getElementById('c-price').value) || null)
      });
      if(error) throw error;
      ['c-title','c-sub','c-cover','c-link','c-duration','c-price'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('c-free').checked = false;
      toast('Curso adicionado');
      loadCoursesList();
    } catch(e){ showError('add-course', e, 'Não foi possível adicionar o curso.'); }
    finally { restore(); }
  }

  async function deleteCourse(id, el){
    const sb = getSupabase();
    if(!sb) return;
    try {
      const { error } = await sb.from('courses').delete().eq('id', id);
      if(error) throw error;
      const card = el.closest('div'); if(card) card.remove();
      toast('Removido');
    } catch(e){ console.error('deleteCourse:', e && e.message || e); toast('Erro ao remover'); }
  }

  window.Modules = window.Modules || {};
  window.Modules.qualsCourses = {
    openManageQuals, loadQualsList, addQualification, deleteQualification,
    openManageCourses, loadCoursesList, addCourse, deleteCourse
  };
})();
