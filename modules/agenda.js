// modules/agenda.js — feature "Agenda de Projetos" (calendário) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, syncQuotesToJobs,
// escapeHtml, toast, closeModals, handleSbError, parseBRL, loadFinanceiro,
// gateProClient, apiPost.
(function(){
  'use strict';

  // ══ AGENDA DE PROJETOS (calendário) ══
  // Estado interno do módulo (antes top-level no app.js).
  let _agCur = null;   // Date: primeiro dia do mês exibido
  let _agSel = null;   // 'yyyy-mm-dd' selecionado
  let _agJobs = [];    // cache dos projetos do usuário

  function _agYmd(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }

  async function loadAgenda(){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    // Skeleton no day-list enquanto carrega (3 rows de ~50px pra simular dia).
    // Calendário tem layout fixo, então não recebe skeleton — só o dia abaixo.
    const dayEl = document.getElementById('agenda-day-list');
    if(dayEl) dayEl.innerHTML = skeletonRows(3, { height: '50px' });
    try {
      await syncQuotesToJobs();
      // SELECT enxuto: só os campos que a agenda renderiza/usa.
      const { data, error } = await sb.from('jobs').select('id, status, scheduled_date, scheduled_time, client_name, service_type, address, created_at').eq('painter_id', currentUser.id).order('scheduled_date',{ascending:true}).limit(500);
      if(error) throw error;
      _agJobs = data || [];
      const now = new Date();
      if(!_agCur) _agCur = new Date(now.getFullYear(), now.getMonth(), 1);
      if(!_agSel) _agSel = _agYmd(now);
      renderAgendaCal();
    } catch(e){
      console.error('loadAgenda:', e && e.message || e);
      if(dayEl) dayEl.innerHTML = errorState(
        'Não foi possível carregar a agenda. Tente de novo.',
        () => loadAgenda()
      );
    }
  }

  function agMonth(delta){
    if(!_agCur) _agCur = new Date();
    _agCur = new Date(_agCur.getFullYear(), _agCur.getMonth()+delta, 1);
    renderAgendaCal();
  }

  function agSelect(day){ _agSel = day; renderAgendaCal(); }

  function renderAgendaCal(){
    const cal = document.getElementById('agenda-cal'); if(!cal) return;
    const y = _agCur.getFullYear(), m = _agCur.getMonth();
    const startDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m+1, 0).getDate();
    const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const counts = {};
    _agJobs.forEach(j=>{ if(j.scheduled_date){ const k=String(j.scheduled_date).slice(0,10); counts[k]=(counts[k]||0)+1; } });
    const todayK = _agYmd(new Date());
    const dow = ['D','S','T','Q','Q','S','S'];
    let head = dow.map(d=>`<div style="text-align:center;font-size:10px;color:var(--muted);font-weight:700;padding:4px 0;">${d}</div>`).join('');
    let cells = '';
    for(let i=0;i<startDow;i++) cells += '<div></div>';
    for(let d=1; d<=daysInMonth; d++){
      const k = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const has = counts[k]||0;
      const sel = k===_agSel;
      const isToday = k===todayK;
      const style = sel ? 'background:var(--p1);color:#fff;' : isToday ? 'background:var(--cream);color:var(--ink);border:1.5px solid var(--p1);' : 'color:var(--ink);';
      cells += `<div onclick="agSelect('${k}')" style="aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;${style}">${d}${has?`<span style="width:5px;height:5px;border-radius:50%;margin-top:3px;background:${sel?'#fff':'var(--p1)'};display:block;"></span>`:''}</div>`;
    }
    cal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <button onclick="agMonth(-1)" style="background:var(--cream);border:1px solid var(--border);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;">‹</button>
        <div style="font-weight:800;font-family:'Syne',sans-serif;font-size:15px;">${months[m]} ${y}</div>
        <button onclick="agMonth(1)" style="background:var(--cream);border:1px solid var(--border);border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px;">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${head}${cells}</div>`;
    renderAgendaDay();
  }

  function renderAgendaDay(){
    const el = document.getElementById('agenda-day-list'); if(!el) return;
    const items = _agJobs
      .filter(j=> j.scheduled_date && String(j.scheduled_date).slice(0,10)===_agSel)
      .sort((a,b)=> String(a.scheduled_time||'').localeCompare(String(b.scheduled_time||'')));
    const [yy,mm,dd] = _agSel.split('-');
    const label = `${dd}/${mm}/${yy}`;
    if(items.length===0){
      el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-weight:700;margin:6px 0;">${label}</div>` + emptyState({
        icon: '📅',
        title: 'Sem projetos agendados',
        message: 'Nenhum projeto neste dia. Crie um projeto pelo Pipeline e ele aparece no calendário.'
      });
      return;
    }
    const optimizeBtn = items.length>=2
      ? `<button onclick="otimizarDiaAgenda()" style="width:100%;padding:10px 12px;margin-bottom:10px;background:linear-gradient(135deg,#8338ec,var(--p1));color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:800;cursor:pointer;font-family:'DM Sans',sans-serif;">🗺️ Otimizar dia (PRO)</button><div id="agenda-day-suggest"></div>`
      : '';
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-weight:700;margin:6px 0;">${label} · ${items.length} projeto(s)</div>${optimizeBtn}` + items.map(j=>{
      const st = j.status==='concluido'?'#2ec4b6':j.status==='cancelado'?'#e74c3c':'var(--p1)';
      return `<div style="background:var(--white);border-radius:12px;padding:14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.04);border-left:4px solid ${st};">
        <div style="display:flex;justify-content:space-between;"><b style="font-size:13px;">${escapeHtml(j.client_name||'')}</b><span style="font-size:11px;color:var(--muted);">${j.scheduled_time||''}</span></div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;">${escapeHtml(j.service_type||'')} · ${escapeHtml(j.address||'')}</div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <span style="font-size:11px;color:var(--ink);font-weight:600;">R$ ${(j.revenue||0).toLocaleString('pt-BR')}</span>
          <span style="font-size:11px;color:var(--muted);">custo: R$ ${(j.material_cost||0).toLocaleString('pt-BR')}</span>
          <span style="margin-left:auto;font-size:10px;font-weight:700;color:${st};text-transform:uppercase;">${j.status}</span>
        </div>
        ${j.status==='agendado'?`<div style="display:flex;gap:6px;margin-top:8px;"><button onclick="updateJobStatus('${j.id}','concluido')" style="flex:1;padding:6px;background:#2ec4b6;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">✓ Concluir</button><button onclick="updateJobStatus('${j.id}','cancelado')" style="flex:1;padding:6px;background:var(--cream);color:var(--muted);border:1px solid var(--border);border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">Cancelar</button></div>`:''}
      </div>`;
    }).join('');
  }

  async function salvarJob(){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    const job = {
      painter_id: currentUser.id,
      client_name: document.getElementById('job-cliente').value.trim(),
      service_type: document.getElementById('job-servico').value,
      scheduled_date: document.getElementById('job-data').value||null,
      scheduled_time: document.getElementById('job-hora').value||null,
      address: document.getElementById('job-endereco').value.trim(),
      revenue: parseBRL(document.getElementById('job-receita').value),
      material_cost: parseBRL(document.getElementById('job-custo').value),
      notes: document.getElementById('job-notas').value.trim()
    };
    if(!job.client_name){ toast('Informe o cliente'); return; }
    const { error } = await sb.from('jobs').insert(job);
    if(handleSbError(error)) return;
    if(job.scheduled_date) _agSel = String(job.scheduled_date).slice(0,10);
    toast('Projeto salvo!'); closeModals(); loadAgenda();
  }

  async function updateJobStatus(jobId, status){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    await sb.from('jobs').update({status}).eq('id',jobId).eq('painter_id',currentUser.id);
    toast(status==='concluido'?'Projeto concluído!':'Projeto cancelado'); loadAgenda(); loadFinanceiro();
  }

  function prefillNovoProjeto(){
    const di = document.getElementById('job-data');
    if(di && !di.value && _agSel) di.value = _agSel;
  }

  async function otimizarDiaAgenda(){
    if (!gateProClient('Otimizar dia com Seu Zé')) return;
    if(!_agSel){ toast('Selecione um dia'); return; }
    const dayJobs = (_agJobs||[]).filter(j=> j.scheduled_date && String(j.scheduled_date).slice(0,10)===_agSel);
    if(dayJobs.length<2){ toast('Precisa de 2+ obras no mesmo dia'); return; }
    const box = document.getElementById('agenda-day-suggest');
    if(box) box.innerHTML = `<div style="background:var(--cream);border:1px dashed var(--border);border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;color:var(--muted);">🤖 Otimizando rota com Seu Zé...</div>`;
    toast('Otimizando rota com Seu Zé...');
    try{
      const payload = {
        date: _agSel,
        jobs: dayJobs.map(j=>({
          id: String(j.id),
          client_name: j.client_name||'',
          address: j.address||'',
          scheduled_time: j.scheduled_time||''
        }))
      };
      const { ok, data } = await apiPost('/api/agenda-order', payload);
      if(!ok || !Array.isArray(data?.ordered_ids)){
        const msg = data?.error || 'Erro ao otimizar';
        if(box) box.innerHTML = `<div style="background:#fdecea;border:1px solid #e74c3c;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;color:#e74c3c;">${escapeHtml(msg)}</div>`;
        toast(msg);
        return;
      }
      const byId = {}; dayJobs.forEach(j=>{ byId[String(j.id)] = j; });
      const rows = data.ordered_ids.map((id,i)=>{
        const j = byId[String(id)]; if(!j) return '';
        return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.05);">
          <div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#8338ec,var(--p1));color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--ink);">${escapeHtml(j.client_name||'')}${j.scheduled_time?` <span style="font-weight:500;color:var(--muted);">· ${escapeHtml(j.scheduled_time)}</span>`:''}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(j.address||'(sem endereço)')}</div>
          </div>
        </div>`;
      }).join('');
      const notes = typeof data.notes==='string' && data.notes.trim() ? data.notes.trim() : '';
      if(box){
        box.innerHTML = `<div style="background:var(--white);border:1.5px solid #8338ec;border-radius:12px;padding:12px;margin-bottom:10px;box-shadow:0 2px 8px rgba(131,56,236,.12);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <div style="font-size:12px;font-weight:800;color:#8338ec;">🗺️ Ordem sugerida pelo Seu Zé</div>
            <button onclick="document.getElementById('agenda-day-suggest').innerHTML='';" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;line-height:1;padding:0 4px;">×</button>
          </div>
          ${rows}
          ${notes?`<div style="font-size:11px;color:var(--muted);margin-top:8px;font-style:italic;">${escapeHtml(notes)}</div>`:''}
          <div style="font-size:10px;color:var(--muted);margin-top:8px;background:var(--cream);padding:6px 8px;border-radius:8px;">⚠️ Sugestão baseada só no texto do endereço (não usa GPS). Confirme a rota no seu app de mapas.</div>
        </div>`;
      }
    }catch(e){
      console.warn('otimizarDiaAgenda:', e && e.message || e);
      if(box) box.innerHTML = `<div style="background:#fdecea;border:1px solid #e74c3c;border-radius:10px;padding:10px;margin-bottom:10px;font-size:12px;color:#e74c3c;">Erro ao otimizar: ${escapeHtml(String(e?.message||e))}</div>`;
      toast('Erro ao otimizar');
    }
  }

  // ══ EVENTS WIRING — pro.upgraded ══
  // Quando o pro ativa, recarrega a agenda se aberta pra refletir features
  // PRO desbloqueadas (otimizar dia com IA). Chamada direta continua
  // funcionando como fallback durante rollout — eventos são aditivos.
  if(window.Events){
    window.Events.on('pro.upgraded', function(){
      const scr = document.getElementById('screen-agenda');
      if(scr && scr.classList.contains('active')){
        try { loadAgenda(); } catch(e){ console.warn('[events] pro.upgraded agenda:', e && e.message); }
      }
    });
  }

  window.Modules = window.Modules || {};
  window.Modules.agenda = {
    loadAgenda, agMonth, agSelect, renderAgendaCal, renderAgendaDay,
    salvarJob, updateJobStatus, prefillNovoProjeto, otimizarDiaAgenda
  };
})();
