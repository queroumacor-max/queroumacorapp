// modules/pipeline.js — feature "Pipeline" (kanban de orçamentos) extraída
// do app.js. Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, notify, dateBR,
// escapeHtml, safeUrl, toast, showModal, closeModals, showScreen, parseBRL,
// appConfirm, appPrompt, requireSession, handleSbError, apiPost,
// gateProClient, isProfessionalRole, getMyProfile, loadPedidos, _lastOrcData.
// Estado `_pipelineCache`, `_quotePriceTarget` e `_pipelineSub` é encapsulado
// no módulo — `_pipelineSub` continua exposto via window pelo app.js (head.js
// usa `typeof _pipelineSub !== 'undefined'` pra cleanup no logout).
(function(){
  'use strict';

  // ══════════════════════════════════════════
  // FEATURE 1 — APROVAÇÃO DE ORÇAMENTO (pipeline)
  // Ciclo: rascunho/pending → enviado → aprovado → em_execucao → concluido (+ recusado)
  // ══════════════════════════════════════════

  const QUOTE_STATUS = {
    pending:    { label:'A orçar',     color:'#8a8a99' },
    rascunho:   { label:'Rascunho',    color:'#8a8a99' },
    enviado:    { label:'Enviado',     color:'#f4a300' },
    aprovado:   { label:'Aprovado',    color:'#2ec4b6' },
    em_execucao:{ label:'Em execução', color:'#3a86ff' },
    concluido:  { label:'Concluído',   color:'#16a34a' },
    recusado:   { label:'Recusado',    color:'#e63946' }
  };
  let _pipelineCache = [];
  let _quotePriceTarget = null;
  let _pipelineSub = null;

  // Congela o escopo+valor do orçamento como referência imutável.
  function buildQuoteSnapshot(q){
    return {
      frozen_at: new Date().toISOString(),
      service_type: q.service_type || null,
      title: q.title || null,
      area_m2: q.area_m2 || null,
      address: q.address || null,
      description: q.description || null,
      price: +q.price || 0,
      proposed_date: q.proposed_date || null,
      quote_data: q.quote_data || null
    };
  }

  // Integra o Pipeline com a Agenda/Financeiro: orçamento aprovado / em
  // execução / concluído vira um projeto (job). Idempotente — só cria o
  // que falta e nunca rebaixa o status de um job já existente.
  async function syncQuotesToJobs(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    try {
      const { data: quotes } = await sb.from('quotes')
        .select('id, client_name, service_type, address, price, proposed_date, status, client:profiles!client_id(name)')
        .eq('painter_id', currentUser.id)
        .in('status', ['aprovado','em_execucao','concluido']);
      if(!quotes || !quotes.length) return;
      const { data: jobs } = await sb.from('jobs')
        .select('id, quote_id, status').eq('painter_id', currentUser.id).not('quote_id','is',null);
      const byQuote = {};
      (jobs||[]).forEach(j => { if(j.quote_id) byQuote[j.quote_id] = j; });
      const t = new Date();
      const ymd = new Date(t.getTime() - t.getTimezoneOffset()*60000).toISOString().slice(0,10);
      for(const q of quotes){
        const existing = byQuote[q.id];
        if(!existing){
          await sb.from('jobs').insert({
            painter_id: currentUser.id,
            quote_id: q.id,
            client_name: q.client_name || (q.client && q.client.name) || 'Cliente',
            service_type: q.service_type || 'Serviço',
            address: q.address || null,
            scheduled_date: q.proposed_date || ymd,
            status: q.status === 'concluido' ? 'concluido' : 'agendado',
            revenue: +q.price || 0,
            material_cost: 0,
            notes: 'Gerado automaticamente do orçamento aprovado'
          });
        } else if(q.status === 'concluido' && existing.status !== 'concluido' && existing.status !== 'cancelado'){
          await sb.from('jobs').update({ status:'concluido' }).eq('id', existing.id).eq('painter_id', currentUser.id);
        }
      }
    } catch(e){ console.warn('syncQuotesToJobs:', e && e.message || e); }
  }

  async function loadPipeline(){
    const sb = getSupabase();
    const container = document.getElementById('pipeline-list');
    if(!container) return;
    if(!sb || !currentUser){ container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Faça login para ver seus orçamentos.</div>'; return; }
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Carregando...</div>';
    await syncQuotesToJobs();
    try {
      const { data: quotes, error } = await sb.from('quotes')
        .select('*, client:profiles!client_id(name)')
        .eq('painter_id', currentUser.id)
        .order('created_at', { ascending:false });
      if(error) throw error;
      _pipelineCache = quotes || [];
      renderPipeline();
    } catch(e){
      console.error('loadPipeline:', e && e.message || e);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Erro ao carregar o pipeline.</div>';
    }
  }

  function renderPipeline(){
    const container = document.getElementById('pipeline-list');
    if(!container) return;
    const quotes = _pipelineCache || [];
    if(quotes.length === 0){
      container.innerHTML = '<div style="text-align:center;padding:50px 24px;color:var(--muted);">'
        + '<div style="font-size:40px;margin-bottom:10px;">📋</div>'
        + '<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum orçamento ainda</div>'
        + '<div style="font-size:13px;line-height:1.5;">Monte um orçamento na Calculadora e toque em "Salvar no Pipeline". Pedidos de clientes do app também aparecem aqui.</div>'
        + '</div>';
      return;
    }
    const groups = [
      { title:'A enviar',    statuses:['pending','rascunho'] },
      { title:'Enviados',    statuses:['enviado'] },
      { title:'Aprovados',   statuses:['aprovado'] },
      { title:'Em execução', statuses:['em_execucao'] },
      { title:'Concluídos',  statuses:['concluido'] },
      { title:'Recusados',   statuses:['recusado'] }
    ];
    let html = '';
    groups.forEach(g => {
      const list = quotes.filter(q => g.statuses.includes(q.status || 'rascunho'));
      if(list.length === 0) return;
      html += '<div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 10px;">'
        + g.title + ' · ' + list.length + '</div>';
      html += list.map(renderPipelineCard).join('');
    });
    container.innerHTML = html;
  }

  function renderPipelineCard(q){
    const s = q.status || 'rascunho';
    const st = QUOTE_STATUS[s] || QUOTE_STATUS.rascunho;
    const cli = q.client_name || (q.client && q.client.name) || 'Cliente';
    const price = (+q.price||0) > 0 ? 'R$ ' + (+q.price).toLocaleString('pt-BR') : 'Sem valor';
    const date = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
    const appBadge = q.client_id
      ? '<span style="font-size:10px;font-weight:700;color:#3a86ff;background:rgba(58,134,255,.1);padding:2px 7px;border-radius:20px;">Cliente do app</span>'
      : '<span style="font-size:10px;font-weight:700;color:var(--muted);background:var(--cream);padding:2px 7px;border-radius:20px;">Cliente externo</span>';
    const btn = (label,fn,bg,color)=>'<button onclick="'+fn+'" style="flex:1;padding:9px;background:'+bg+';color:'+(color||'#fff')+';border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">'+label+'</button>';
    let actions = '';
    if(s==='pending' || s==='rascunho'){
      actions = btn('Enviar', "enviarQuote('"+q.id+"')", 'var(--p1)')
              + btn('🤖 Sugerir preço', "sugerirPrecoQuote('"+q.id+"')", 'linear-gradient(135deg,#8338ec,var(--p1))');
    } else if(s==='enviado'){
      actions = btn('Marcar aceito', "aprovarQuoteManual('"+q.id+"')", '#2ec4b6')
              + btn('Recusado', "recusarQuote('"+q.id+"')", 'var(--cream)', 'var(--muted)');
    } else if(s==='aprovado'){
      actions = btn('Iniciar execução', "setQuoteStage('"+q.id+"','em_execucao')", '#3a86ff')
              + btn('Escopo', "verSnapshot('"+q.id+"')", 'var(--cream)', 'var(--ink)');
    } else if(s==='em_execucao'){
      actions = btn('Concluir', "setQuoteStage('"+q.id+"','concluido')", '#16a34a')
              + btn('Escopo', "verSnapshot('"+q.id+"')", 'var(--cream)', 'var(--ink)');
    } else {
      actions = btn('Ver escopo', "verSnapshot('"+q.id+"')", 'var(--cream)', 'var(--ink)');
    }
    const frozen = ['aprovado','em_execucao','concluido'].includes(s);
    let frozenLine = '';
    if(frozen){
      const when = q.approved_at ? ' em '+dateBR(q.approved_at) : '';
      const how = q.approval_method==='manual' ? ' · registro manual' : (q.approval_method==='app' ? ' · aprovado pelo cliente' : '');
      frozenLine = '<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">🔒 Escopo congelado'+when+how+'</div>';
    }
    const descBlock = q.description
      ? '<div style="background:var(--cream);border-radius:10px;padding:9px 11px;margin-bottom:10px;font-size:12px;color:var(--ink);line-height:1.5;white-space:pre-wrap;">'+escapeHtml(q.description)+'</div>'
      : '';
    const imgs = (q.images && Array.isArray(q.images)) ? q.images : [];
    const photosBlock = imgs.length > 0
      ? '<div style="display:flex;gap:6px;margin-bottom:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;">'
        + imgs.slice(0, 8).map(url =>
            '<a href="'+safeUrl(url)+'" target="_blank" rel="noopener" style="flex-shrink:0;width:64px;height:64px;border-radius:8px;overflow:hidden;background:#000;display:block;"><img src="'+escapeHtml(url)+'" style="width:100%;height:100%;object-fit:cover;"></a>'
          ).join('')
        + '</div>'
      : '';
    return '<div style="background:var(--white);border-radius:14px;padding:13px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:9px;">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">'
      +   '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--ink);">'+escapeHtml(cli)+'</div>'
      +   '<div style="font-size:12px;color:var(--muted);">'+escapeHtml(q.service_type||q.title||'Orçamento')+'</div></div>'
      +   '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:'+st.color+';white-space:nowrap;">'+st.label+'</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
      +   '<span style="font-size:13px;font-weight:800;color:var(--ink);">'+price+'</span>'+appBadge
      +   '<span style="margin-left:auto;font-size:11px;color:var(--muted);">'+date+'</span>'
      + '</div>'
      + descBlock
      + photosBlock
      + frozenLine
      + '<div style="display:flex;gap:7px;">'+actions+'</div>'
      + '</div>';
  }

  async function salvarOrcamento(){
    const ctx = requireSession('Faça login para salvar');
    if(!ctx) return;
    const sb = ctx.sb;
    const d = _lastOrcData;
    if(!d || !d.total){ toast('Gere o orçamento primeiro'); return; }
    // Usa RPC create_painter_draft (SECURITY DEFINER) — força painter_id =
    // auth.uid() no servidor, impedindo gravar rascunho em pipeline alheio.
    const { error } = await sb.rpc('create_painter_draft', {
      p_client_name:  d.cliente || 'Cliente',
      p_service_type: d.servico || 'Orçamento',
      p_title:        d.servico || 'Orçamento',
      p_area_m2:      d.area || null,
      p_price:        d.total || 0,
      p_quote_data:   d
    });
    if(handleSbError(error, 'Erro ao salvar')) return;
    toast('Orçamento salvo no Pipeline ✅');
    closeModals();
    showScreen('pipeline');
  }

  function enviarQuote(id){
    const q = _pipelineCache.find(x => x.id === id);
    if(!q) return;
    _quotePriceTarget = id;
    const note = document.getElementById('qp-ia-note');
    if(note){ note.style.display = 'none'; note.innerHTML = ''; }
    const input = document.getElementById('qp-price-input');
    if(input){
      input.value = (+q.price || 0) > 0
        ? (+q.price).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '';
    }
    showModal('quote-price-modal');
    setTimeout(() => { if(input) input.focus(); }, 150);
  }

  async function enviarQuoteConfirmar(){
    const id = _quotePriceTarget;
    if(!id) return;
    const sb = getSupabase(); if(!sb || !currentUser) return;
    const input = document.getElementById('qp-price-input');
    const price = parseBRL(input ? input.value : '');
    if(price <= 0){ toast('Informe um valor válido'); return; }
    const q = _pipelineCache.find(x => x.id === id);
    if(!q) return;
    closeModals();
    const { error } = await sb.from('quotes')
      .update({ status: 'enviado', sent_at: new Date().toISOString(), price })
      .eq('id', id).eq('painter_id', currentUser.id);
    if(handleSbError(error)) return;
    if(q.client_id){
      notify(q.client_id, 'quote_sent', 'Você recebeu um orçamento',
        'Um profissional enviou um orçamento. Toque para ver e aprovar.', id);
    }
    toast('Orçamento enviado!');
    loadPipeline();
  }

  // IA sugere o preço para um orçamento pendente/rascunho (feature PRO).
  // Em caso de aceite, injeta o valor no cache e delega para enviarQuote.
  async function sugerirPrecoQuote(id){
    if (!gateProClient('Sugerir preço com Seu Zé')) return;
    const q = (_pipelineCache||[]).find(x=>x.id===id);
    if(!q){ toast('Orçamento não encontrado'); return; }
    toast('Calculando preço com Seu Zé...');
    try {
      const { ok, data } = await apiPost('/api/pricing-suggest', {
        service_type: q.service_type || q.title || '',
        description: q.description || '',
        area_m2: q.area_m2 || null
      });
      if(!ok || !data || typeof data.price !== 'number'){
        toast('Erro ao sugerir preço: ' + ((data && data.error) || 'Seu Zé indisponível'));
        return;
      }
      const price = +data.price || 0;
      const justification = String(data.justification || '').trim();
      // Abre o modal de preço pré-preenchido com a sugestão da IA e a
      // justificativa logo acima. Usuário pode editar antes de enviar.
      _quotePriceTarget = id;
      const note = document.getElementById('qp-ia-note');
      if(note){
        note.style.display = 'block';
        note.innerHTML = '<b>💡 Seu Zé sugere R$ ' + price.toLocaleString('pt-BR') + '</b>' + (justification ? '<br><span style="opacity:.85;">' + escapeHtml(justification) + '</span>' : '');
      }
      const input = document.getElementById('qp-price-input');
      if(input) input.value = price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      showModal('quote-price-modal');
      setTimeout(() => { if(input){ input.focus(); input.select(); } }, 150);
    } catch(e){
      console.warn('sugerirPrecoQuote:', e && e.message || e);
      toast('Erro ao falar com o Seu Zé');
    }
  }

  async function aprovarQuoteManual(id){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    const q = _pipelineCache.find(x=>x.id===id); if(!q) return;
    if(!(await appConfirm('Marcar este orçamento como aceito pelo cliente?\n\nO escopo e o valor ficam congelados como referência acordada.', { okLabel:'Marcar como aceito' }))) return;
    const note = await appPrompt('Observação da aprovação (opcional) — ex.: aceito por WhatsApp em DD/MM:', { placeholder:'Ex.: aceito por WhatsApp em 12/05' });
    if(note===null) return;
    const { error } = await sb.from('quotes').update({
      status:'aprovado', approved_at:new Date().toISOString(),
      approved_by: currentUser.id, approval_method:'manual',
      approval_note: note.trim() || null, scope_snapshot: buildQuoteSnapshot(q)
    }).eq('id', id).eq('painter_id', currentUser.id);
    if(handleSbError(error)) return;
    toast('Orçamento aprovado (registro manual)');
    loadPipeline();
  }

  async function recusarQuote(id){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    if(!(await appConfirm('Marcar este orçamento como recusado?', { okLabel:'Marcar como recusado' }))) return;
    const { error } = await sb.from('quotes').update({ status:'recusado' })
      .eq('id', id).eq('painter_id', currentUser.id);
    if(handleSbError(error)) return;
    toast('Orçamento recusado'); loadPipeline();
  }

  async function setQuoteStage(id, status){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    const patch = { status };
    if(status==='concluido') patch.completed_at = new Date().toISOString();
    const { error } = await sb.from('quotes').update(patch)
      .eq('id', id).eq('painter_id', currentUser.id);
    if(handleSbError(error)) return;
    // Pontos por conclusão são creditados automaticamente pelo trigger
    // trg_award_quote_completed_points (Bateria 3.2). Não chamar earnPoints aqui.
    toast(status==='concluido'?'Orçamento concluído!':'Execução iniciada'); loadPipeline();
  }

  // Aprovação nativa: o cliente (usuário do app) aprova o orçamento recebido.
  async function aprovarQuoteCliente(id){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    if(!(await appConfirm('Aprovar este orçamento?\n\nVocê confirma o escopo e o valor apresentados — eles ficam congelados como referência.', { okLabel:'Aprovar' }))) return;
    const { data: q, error: e1 } = await sb.from('quotes').select('*').eq('id', id).single();
    if(e1 || !q){ toast('Erro ao carregar o orçamento'); return; }
    const followupOptin = await appConfirm('Quer receber lembretes deste profissional sobre repintura e manutenção? (opcional)', { okLabel:'Quero receber', cancelLabel:'Não, obrigado' });
    const { error } = await sb.from('quotes').update({
      status:'aprovado', approved_at:new Date().toISOString(),
      approved_by: currentUser.id, approval_method:'app',
      scope_snapshot: buildQuoteSnapshot(q),
      client_followup_optin: followupOptin
    }).eq('id', id).eq('client_id', currentUser.id);
    if(handleSbError(error)) return;
    if(q.painter_id){
      notify(q.painter_id, 'quote_approved', 'Orçamento aprovado! 🎉',
        'O cliente aprovou o orçamento. Toque para ver os detalhes.', id);
    }
    toast('Orçamento aprovado!');
    loadPedidos();
  }

  async function verSnapshot(id){
    const sb = getSupabase(); if(!sb) return;
    let q = (_pipelineCache||[]).find(x=>x.id===id);
    if(!q){ const r = await sb.from('quotes').select('*').eq('id', id).single(); q = r.data; }
    if(!q){ toast('Orçamento não encontrado'); return; }
    const body = document.getElementById('quote-snapshot-body');
    if(!body) return;
    const snap = q.scope_snapshot;
    const data = snap || buildQuoteSnapshot(q);
    const qd = data.quote_data || q.quote_data;
    let h = '';
    if(snap){
      h += '<div style="background:rgba(46,196,182,.1);border:1px solid rgba(46,196,182,.3);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--ink);line-height:1.5;">'
        + '🔒 Escopo congelado na aprovação'+(q.approved_at?' — '+new Date(q.approved_at).toLocaleString('pt-BR'):'')+'. Esta é a referência acordada com o cliente.'
        + '</div>';
    } else {
      h += '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Orçamento ainda não aprovado — o escopo pode mudar até a aprovação.</div>';
    }
    const row = (k,v)=> v ? '<div style="display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;"><span style="color:var(--muted);">'+k+'</span><span style="font-weight:600;text-align:right;">'+escapeHtml(String(v))+'</span></div>' : '';
    h += row('Serviço', data.service_type || data.title);
    h += row('Área', data.area_m2 ? data.area_m2+' m²' : '');
    h += row('Endereço', data.address);
    h += row('Descrição', data.description);
    h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0 4px;"><span style="font-size:14px;font-weight:700;">TOTAL</span><span style="font-size:20px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">R$ '+(+data.price||0).toLocaleString('pt-BR')+'</span></div>';
    if(qd && Array.isArray(qd.itens) && qd.itens.length){
      h += '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:14px 0 6px;">Itens</div>';
      h += qd.itens.map(it=>'<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>'+escapeHtml(it.desc||'')+'</span><span style="color:var(--muted);white-space:nowrap;">'+escapeHtml(it.valor||'')+'</span></div>').join('');
    }
    if(qd && Array.isArray(qd.pagamento) && qd.pagamento.length){
      h += '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:14px 0 6px;">Pagamento</div>';
      h += qd.pagamento.map(p=>'<div style="font-size:12px;color:var(--ink);margin-bottom:3px;">• '+escapeHtml(p)+'</div>').join('');
    }
    if(q.approval_note){
      h += '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:14px 0 6px;">Observação da aprovação</div>';
      h += '<div style="font-size:12px;color:var(--ink);">'+escapeHtml(q.approval_note)+'</div>';
    }
    body.innerHTML = h;
    showModal('quote-snapshot-modal');
  }

  // ══ PIPELINE AO VIVO — novo pedido aparece sem reabrir a tela ══
  // SÓ pra profissional (pintor/grafiteiro/automotivo). Cliente não tem quotes
  // onde é o painter_id, então o WebSocket nunca dispara — desperdício.
  async function setupPipelineSubscription(){
    if(_pipelineSub || !currentUser) return;
    const sb = getSupabase();
    if(!sb) return;
    // Checa role antes de abrir o canal. getMyProfile usa cache + dedup,
    // então não custa round-trip extra (já é chamado no boot).
    try {
      const prof = (typeof getMyProfile === 'function') ? await getMyProfile() : null;
      const role = (prof && (prof.role || prof.user_type)) || (currentUser.user_metadata && (currentUser.user_metadata.user_type || currentUser.user_metadata.role)) || 'cliente';
      if(!isProfessionalRole(role)) return;
    } catch(_){ /* em caso de falha, segue e abre o sub (comportamento antigo) */ }
    _pipelineSub = sb.channel('pipeline-'+currentUser.id)
      .on('postgres_changes', { event:'*', schema:'public', table:'quotes', filter:'painter_id=eq.'+currentUser.id }, () => {
        const scr = document.getElementById('screen-pipeline');
        if(scr && scr.classList.contains('active')) loadPipeline();
      })
      .subscribe();
  }

  // ══ EVENTS WIRING — pro.upgraded ══
  // Quando o pro ativa, recarrega o pipeline se aberto pra refletir features
  // PRO desbloqueadas (sugerir preço com IA, snapshots avançados). Chamada
  // direta continua funcionando como fallback durante rollout.
  if(window.Events){
    window.Events.on('pro.upgraded', function(){
      const scr = document.getElementById('screen-pipeline');
      if(scr && scr.classList.contains('active')){
        try { loadPipeline(); } catch(e){ console.warn('[events] pro.upgraded pipeline:', e && e.message); }
      }
    });
  }

  window.Modules = window.Modules || {};
  window.Modules.pipeline = {
    QUOTE_STATUS,
    buildQuoteSnapshot, syncQuotesToJobs,
    loadPipeline, renderPipeline, renderPipelineCard,
    salvarOrcamento,
    enviarQuote, enviarQuoteConfirmar, sugerirPrecoQuote,
    aprovarQuoteManual, recusarQuote, setQuoteStage,
    aprovarQuoteCliente, verSnapshot,
    setupPipelineSubscription
  };
})();
