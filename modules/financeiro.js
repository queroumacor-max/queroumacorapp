// modules/financeiro.js — feature "Financeiro" (dashboard, lançamentos e
// análise IA do mês) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, syncQuotesToJobs,
// escapeHtml, parseBRL, handleSbError, toast, appConfirm, gateProClient,
// apiPost.
(function(){
  'use strict';

  async function loadFinanceiro(){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    await syncQuotesToJobs();
    // SELECT enxuto: só os campos do dashboard financeiro.
    const { data: jobs } = await sb.from('jobs').select('id, service_type, client_name, revenue, material_cost, created_at').eq('painter_id', currentUser.id).eq('status','concluido').order('created_at',{ascending:false});
    let receita=0, custos=0;
    (jobs||[]).forEach(j=>{ receita+=(+j.revenue||0); custos+=(+j.material_cost||0); });
    const lucro = receita - custos;
    document.getElementById('fin-receita').textContent='R$ '+receita.toLocaleString('pt-BR');
    document.getElementById('fin-custos').textContent='R$ '+custos.toLocaleString('pt-BR');
    document.getElementById('fin-lucro').textContent='R$ '+lucro.toLocaleString('pt-BR');

    // Gráfico resumo (barras)
    const chartEl = document.getElementById('fin-chart');
    if(chartEl){
      const max = Math.max(receita, custos, Math.abs(lucro), 1);
      const bar = (label,val,color)=>{
        const pct = Math.max(2, Math.round(Math.abs(val)/max*100));
        return '<div style="margin-bottom:8px;">'
          + '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:3px;"><span>'+label+'</span><span style="font-weight:700;color:var(--ink);">R$ '+val.toLocaleString('pt-BR')+'</span></div>'
          + '<div style="background:var(--border);border-radius:6px;height:10px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:6px;"></div></div></div>';
      };
      chartEl.innerHTML = '<div style="background:var(--white);border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);">'
        + '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Resumo</div>'
        + bar('Receita', receita, '#2ec4b6')
        + bar('Gasto', custos, '#e63946')
        + bar('Lucro', lucro, 'var(--p1)')
        + '<div style="font-size:11px;color:var(--muted);margin-top:6px;">'+(jobs?jobs.length:0)+' lançamento(s)</div>'
        + '</div>';
    }

    const listEl = document.getElementById('fin-jobs-list');
    if(jobs && jobs.length>0){
      listEl.style.textAlign='left'; listEl.style.padding='0';
      listEl.innerHTML = jobs.map(j=>{
        const lc = (+j.revenue||0)-(+j.material_cost||0);
        return '<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);">'
          + '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:var(--ink);">'+escapeHtml(j.service_type||'Projeto')+'</div>'
          + '<div style="font-size:11px;color:var(--muted);">'+escapeHtml(j.client_name||'-')+' · Receb. R$ '+(+j.revenue||0).toLocaleString('pt-BR')+' · Gasto R$ '+(+j.material_cost||0).toLocaleString('pt-BR')+'</div></div>'
          + '<div style="font-weight:800;font-size:13px;color:'+(lc>=0?'#2ec4b6':'#e63946')+';white-space:nowrap;">R$ '+lc.toLocaleString('pt-BR')+'</div>'
          + '<button onclick="deleteFinEntry(\''+j.id+'\')" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:2px 6px;">×</button>'
          + '</div>';
      }).join('');
    } else {
      listEl.style.textAlign='center'; listEl.style.padding='12px';
      listEl.innerHTML = 'Nenhum lançamento';
    }
  }

  async function salvarFinEntry(){
    const sb = getSupabase(); if(!sb||!currentUser){ toast('Faça login'); return; }
    const nome = (document.getElementById('fin-nome').value||'').trim();
    const cliente = (document.getElementById('fin-cliente').value||'').trim();
    const recebido = parseBRL(document.getElementById('fin-recebido').value);
    const gasto = parseBRL(document.getElementById('fin-gasto').value);
    if(!nome && !cliente){ toast('Informe o nome do projeto ou cliente'); return; }
    if(recebido<=0 && gasto<=0){ toast('Informe um valor recebido ou gasto'); return; }
    const today = new Date(); const ymd = new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);
    const { error } = await sb.from('jobs').insert({
      painter_id: currentUser.id,
      client_name: cliente || '-',
      service_type: nome || 'Projeto',
      revenue: recebido,
      material_cost: gasto,
      status: 'concluido',
      scheduled_date: ymd,
      notes: 'Lançamento financeiro'
    });
    if(handleSbError(error)) return;
    document.getElementById('fin-nome').value='';
    document.getElementById('fin-cliente').value='';
    document.getElementById('fin-recebido').value='';
    document.getElementById('fin-gasto').value='';
    toast('Lançamento adicionado!');
    loadFinanceiro();
  }

  async function deleteFinEntry(id){
    if(!(await appConfirm('Excluir este lançamento?', { okLabel:'Excluir' }))) return;
    const sb = getSupabase(); if(!sb||!currentUser) return;
    await sb.from('jobs').delete().eq('id',id).eq('painter_id',currentUser.id);
    loadFinanceiro();
  }

  // Análise IA do mês — PRO. Agrega últimos 30 dias vs 30 dias anteriores e
  // pede ao backend (gpt-4o-mini) um parecer curto e acionável.
  async function analisarFinanceiroIA(){
    if (!gateProClient('Análise do mês com Seu Zé')) return;
    const sb = getSupabase(); if(!sb||!currentUser){ toast('Faça login'); return; }
    const resultEl = document.getElementById('fin-ai-result');
    try {
      toast('Analisando com Seu Zé...');
      const now = Date.now();
      const d30 = new Date(now - 30*24*60*60*1000).toISOString();
      const d60 = new Date(now - 60*24*60*60*1000).toISOString();
      const { data: jobs, error } = await sb.from('jobs')
        .select('service_type,revenue,material_cost,created_at')
        .eq('painter_id', currentUser.id)
        .eq('status','concluido')
        .gte('created_at', d60)
        .order('created_at',{ascending:false});
      if(error) throw error;

      const inThis = [], inLast = [];
      (jobs||[]).forEach(j=>{
        const t = new Date(j.created_at).getTime();
        if(t >= now - 30*24*60*60*1000) inThis.push(j);
        else if(t >= now - 60*24*60*60*1000) inLast.push(j);
      });
      const agg = arr => {
        let receita=0, custos=0;
        arr.forEach(j=>{ receita+=(+j.revenue||0); custos+=(+j.material_cost||0); });
        return { receita, custos, lucro: receita - custos, jobsCount: arr.length };
      };
      const thisMonth = agg(inThis);
      const lastMonth = agg(inLast);
      const recentJobs = inThis.slice(0,8).map(j=>({
        service_type: j.service_type || 'Projeto',
        revenue: +j.revenue || 0,
        material_cost: +j.material_cost || 0
      }));

      const { ok, data } = await apiPost('/api/fin-analysis', { thisMonth, lastMonth, recentJobs });
      if(!ok || !data || !data.analysis){
        toast('Erro: '+(data && data.error ? data.error : 'Seu Zé indisponível'));
        return;
      }

      if(resultEl){
        resultEl.style.display = 'block';
        resultEl.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
          + '<span style="font-size:18px;">🤖</span>'
          + '<span style="font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;background:linear-gradient(135deg,#8338ec,var(--p1));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#8338ec;">Análise do mês com Seu Zé · PRO</span>'
          + '</div>'
          + '<div style="font-size:13px;line-height:1.55;color:var(--ink);">'+escapeHtml(String(data.analysis))+'</div>';
      }
    } catch(e){
      console.warn('analisarFinanceiroIA:', e && e.message || e);
      toast('Erro ao analisar: '+(e && e.message ? e.message : 'tente novamente'));
    }
  }

  // ══ EVENTS WIRING — pro.upgraded ══
  // Re-renderiza o financeiro se a tela estiver aberta pra refletir features
  // PRO desbloqueadas (análise IA do mês). Call sites diretos continuam
  // funcionando como fallback durante rollout — eventos são aditivos.
  if(window.Events){
    window.Events.on('pro.upgraded', function(){
      const scr = document.getElementById('screen-financeiro');
      if(scr && scr.classList.contains('active')){
        try { loadFinanceiro(); } catch(e){ console.warn('[events] pro.upgraded financeiro:', e && e.message); }
      }
    });
  }

  window.Modules = window.Modules || {};
  window.Modules.financeiro = {
    loadFinanceiro, salvarFinEntry, deleteFinEntry, analisarFinanceiroIA
  };
})();
