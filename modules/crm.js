// modules/crm.js — feature "CRM" (lista de clientes / mini-CRM de follow-up)
// extraída do app.js. Fase 4 da modularização (etapa 1: COPIA pra criar a
// camada; próximo PR migra call sites e remove duplicatas do app.js).
//
// Depende de globals do app.js: getSupabase, currentUser, refreshProStatus,
// _isPro, DB, escapeHtml, toast, handleSbError, appConfirm, notify, apiPost,
// gateProClient, showModal.
// Também depende de helpers globais já em utils.js: crmNormName, crmMonthsSince.
//
// FEATURE 2 — MINI-CRM DE FOLLOW-UP (reativar clientes)
// O sistema RASCUNHA, o pintor DISPARA. Nunca disparo automático.
// Recurso PRO. Consentimento (LGPD) é cidadão de primeira classe.
(function(){
  'use strict';

  let _crmCache = [];
  let _crmIntervalMonths = 12;

  async function loadCrm(){
    const sb = getSupabase();
    const container = document.getElementById('crm-list');
    if(!container) return;
    if(!sb || !currentUser){ container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Faça login para usar o CRM.</div>'; return; }

    // a. Gating PRO.
    await refreshProStatus();
    if(!_isPro){
      container.innerHTML = '<div style="text-align:center;padding:50px 24px;color:var(--muted);">'
        + '<div style="font-size:44px;margin-bottom:12px;">🔁</div>'
        + '<div style="font-size:16px;font-weight:800;color:var(--ink);margin-bottom:8px;">Reativar clientes é PRO</div>'
        + '<div style="font-size:13px;line-height:1.5;margin-bottom:18px;">Recupere clientes antigos com lembretes de repintura e manutenção. O Seu Zé escreve a mensagem, você revisa e envia.</div>'
        + '<button onclick="showModal(\'pro-modal\')" style="padding:12px 26px;background:var(--p1);color:#fff;border:none;border-radius:11px;font-size:14px;font-weight:800;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ativar PRO</button>'
        + '</div>';
      return;
    }

    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Sincronizando seus clientes...</div>';

    try {
      // Intervalo de follow-up do perfil.
      const prof = await DB.profiles.getById(currentUser.id, 'followup_interval_months');
      _crmIntervalMonths = (prof && prof.followup_interval_months) ? prof.followup_interval_months : 12;

      // b. Sync — a lista se monta sozinha a partir de jobs + quotes.
      // SELECT enxuto: só campos usados em touch/keyFor/bumpDate.
      const [jobsRes, quotesRes] = await Promise.all([
        sb.from('jobs').select('id, client_name, service_type, scheduled_date, created_at, revenue').eq('painter_id', currentUser.id),
        sb.from('quotes').select('id, client_id, client_name, client_phone, client_followup_optin, service_type, title, status, created_at, approved_at, price').eq('painter_id', currentUser.id).in('status', ['aprovado','em_execucao','concluido'])
      ]);
      const jobs = jobsRes.data || [];
      const quotes = quotesRes.data || [];

      const map = {}; // key -> cliente derivado
      const keyFor = (clientUserId, name) => clientUserId ? ('u:'+clientUserId) : ('n:'+crmNormName(name));
      const touch = (key, name) => {
        if(!map[key]) map[key] = {
          client_user_id:null, client_name:name||'Cliente', client_phone:null,
          is_app_user:false, followup_optin:false, last_service_at:null,
          last_service_desc:null, total_value:0
        };
        return map[key];
      };
      const bumpDate = (c, dateStr, desc) => {
        if(!dateStr) return;
        const d = new Date(dateStr);
        if(isNaN(d.getTime())) return;
        const iso = d.toISOString().slice(0,10);
        if(!c.last_service_at || iso > c.last_service_at){ c.last_service_at = iso; c.last_service_desc = desc || c.last_service_desc; }
      };

      jobs.forEach(j => {
        const name = j.client_name || 'Cliente';
        const c = touch(keyFor(null, name), name);
        bumpDate(c, j.scheduled_date || j.created_at, j.service_type);
        c.total_value += (+j.revenue || 0);
      });

      quotes.forEach(q => {
        const cuid = q.client_id || null;
        const name = q.client_name || 'Cliente';
        const c = touch(keyFor(cuid, name), name);
        if(cuid){ c.client_user_id = cuid; c.is_app_user = true; }
        if(q.client_phone && !c.client_phone) c.client_phone = q.client_phone;
        if(q.client_followup_optin) c.followup_optin = true;
        bumpDate(c, q.approved_at || q.created_at, q.service_type || q.title);
        c.total_value += (+q.price || 0);
      });

      const derived = Object.values(map).filter(c => c.client_name);

      // Upsert idempotente: limpa os crm_clients do pintor e re-insere o derivado.
      await sb.from('crm_clients').delete().eq('painter_id', currentUser.id);
      if(derived.length){
        const rows = derived.map(c => ({
          painter_id: currentUser.id,
          client_user_id: c.client_user_id,
          client_name: c.client_name,
          client_phone: c.client_phone,
          is_app_user: c.is_app_user,
          followup_optin: c.followup_optin,
          optin_source: c.followup_optin ? 'quote_approval' : null,
          last_service_at: c.last_service_at,
          last_service_desc: c.last_service_desc,
          total_value: c.total_value
        }));
        const { data: ins } = await sb.from('crm_clients').insert(rows).select('*');
        _crmCache = ins || [];
      } else {
        _crmCache = [];
      }
      renderCrm();
    } catch(e){
      console.error('loadCrm:', e && e.message || e);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Erro ao carregar o CRM.</div>';
    }
  }

  function renderCrm(){
    const container = document.getElementById('crm-list');
    if(!container) return;
    const clients = _crmCache || [];

    // Config: intervalo de follow-up.
    let html = '<div style="background:var(--white);border-radius:14px;padding:13px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:14px;">'
      + '<div style="font-size:13px;font-weight:700;color:var(--ink);margin-bottom:8px;">Lembrar clientes após</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      +   '<input id="crm-interval" type="number" min="1" max="120" value="'+_crmIntervalMonths+'" style="width:80px;padding:9px;border:1px solid var(--border);border-radius:9px;font-size:14px;font-family:\'DM Sans\',sans-serif;">'
      +   '<span style="font-size:13px;color:var(--muted);">meses sem serviço</span>'
      +   '<button onclick="saveCrmInterval()" style="margin-left:auto;padding:9px 16px;background:var(--p1);color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Salvar</button>'
      + '</div></div>';

    if(clients.length === 0){
      html += '<div style="text-align:center;padding:40px 24px;color:var(--muted);">'
        + '<div style="font-size:40px;margin-bottom:10px;">🔁</div>'
        + '<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum cliente ainda</div>'
        + '<div style="font-size:13px;line-height:1.5;">Conforme você fecha orçamentos e cadastra trabalhos na agenda, seus clientes aparecem aqui automaticamente.</div>'
        + '</div>';
      container.innerHTML = html;
      return;
    }

    const dueList = [];
    const restList = [];
    clients.forEach(c => {
      const m = crmMonthsSince(c.last_service_at);
      if(m !== null && m >= _crmIntervalMonths) dueList.push(c); else restList.push(c);
    });

    if(dueList.length){
      html += '<div style="font-size:13px;font-weight:700;color:var(--p4);text-transform:uppercase;letter-spacing:.5px;margin:6px 0 10px;">Para contatar · '+dueList.length+'</div>';
      html += dueList.map(renderCrmCard).join('');
    }
    if(restList.length){
      html += '<div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 10px;">Todos os clientes · '+restList.length+'</div>';
      html += restList.map(renderCrmCard).join('');
    }
    container.innerHTML = html;
  }

  function renderCrmCard(c){
    const m = crmMonthsSince(c.last_service_at);
    const ago = m === null ? 'sem serviço registrado'
      : (m === 0 ? 'último serviço neste mês' : 'último serviço há '+m+(m===1?' mês':' meses'));
    const total = (+c.total_value||0) > 0 ? 'R$ ' + (+c.total_value).toLocaleString('pt-BR') : '—';
    const phoneDigits = String(c.client_phone||'').replace(/\D/g,'');
    const hasPhone = phoneDigits.length >= 10;

    // Badge de canal.
    let badge;
    let canSend = false;
    let reason = '';
    if(c.is_app_user && c.client_user_id){
      badge = '<span style="font-size:10px;font-weight:700;color:#3a86ff;background:rgba(58,134,255,.1);padding:2px 7px;border-radius:20px;">Cliente do app</span>';
      canSend = true;
    } else if(hasPhone && c.followup_optin){
      badge = '<span style="font-size:10px;font-weight:700;color:#16a34a;background:rgba(22,163,74,.12);padding:2px 7px;border-radius:20px;">WhatsApp</span>';
      canSend = true;
    } else {
      badge = '<span style="font-size:10px;font-weight:700;color:var(--muted);background:var(--cream);padding:2px 7px;border-radius:20px;">Sem contato</span>';
      reason = !hasPhone ? 'sem telefone' : 'cliente sem opt-in';
    }

    const btn = (label,fn,bg,color,disabled)=>'<button '+(disabled?'disabled ':'')+'onclick="'+(disabled?'':fn)+'" style="flex:1;padding:9px;background:'+bg+';color:'+(color||'#fff')+';border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:'+(disabled?'not-allowed':'pointer')+';opacity:'+(disabled?'.5':'1')+';font-family:\'DM Sans\',sans-serif;">'+label+'</button>';

    const sendBtn = canSend
      ? btn('Enviar', "crmSend('"+c.id+"')", 'var(--p1)')
      : btn('Enviar', '', 'var(--cream)', 'var(--muted)', true);

    let reasonLine = '';
    if(reason){
      reasonLine = '<div style="font-size:11px;color:var(--p4);margin-bottom:8px;">⚠️ Não dá para enviar — '+reason+'.</div>';
    }

    return '<div style="background:var(--white);border-radius:14px;padding:13px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:9px;">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">'
      +   '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--ink);">'+escapeHtml(c.client_name||'Cliente')+'</div>'
      +   '<div style="font-size:12px;color:var(--muted);">'+escapeHtml(ago)+'</div></div>'
      +   badge
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:var(--muted);">'
      +   '<span>Total histórico: <strong style="color:var(--ink);">'+total+'</strong></span>'
      + '</div>'
      + reasonLine
      + '<textarea id="crm-msg-'+c.id+'" placeholder="Mensagem de reativação — gere com o Seu Zé ou escreva aqui..." style="width:100%;min-height:64px;padding:9px;border:1px solid var(--border);border-radius:9px;font-size:13px;font-family:\'DM Sans\',sans-serif;resize:vertical;margin-bottom:9px;box-sizing:border-box;"></textarea>'
      + '<div style="display:flex;gap:7px;">'
      +   btn('Gerar mensagem (Seu Zé)', "crmDraft('"+c.id+"')", 'var(--cream)', 'var(--ink)')
      +   sendBtn
      + '</div>'
      + '</div>';
  }

  async function saveCrmInterval(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    const input = document.getElementById('crm-interval');
    if(!input) return;
    let v = parseInt(input.value, 10);
    if(isNaN(v) || v < 1) v = 1;
    if(v > 120) v = 120;
    const { error } = await sb.from('profiles').update({ followup_interval_months: v }).eq('id', currentUser.id);
    if(handleSbError(error, 'Erro ao salvar')) return;
    _crmIntervalMonths = v;
    toast('Intervalo salvo ✅');
    renderCrm();
  }

  async function crmDraft(id){
    if (!gateProClient('Mensagem de reativação com Seu Zé')) return;
    const c = (_crmCache||[]).find(x => x.id === id);
    if(!c) return;
    const ta = document.getElementById('crm-msg-'+id);
    if(!ta) return;
    const months = crmMonthsSince(c.last_service_at);
    const prevPlaceholder = ta.placeholder;
    ta.placeholder = 'Gerando mensagem...';
    try {
      let painterName = '';
      try {
        const prof = await DB.profiles.getById(currentUser.id, 'name');
        painterName = (prof && prof.name) || '';
      } catch(e){ console.warn('[crm-draft-painter-name]', e && e.message); }
      const { ok, data } = await apiPost('/api/crm-draft', {
        clientName: c.client_name || '',
        lastService: c.last_service_desc || '',
        monthsSince: months || 0,
        painterName: painterName
      });
      if(!ok || !data || !data.draft){ toast('Erro: '+((data && data.error) || 'não foi possível gerar')); ta.placeholder = prevPlaceholder; return; }
      ta.value = data.draft;
      ta.placeholder = prevPlaceholder;
      toast('Rascunho gerado — revise antes de enviar ✏️');
    } catch(e){
      console.error('crmDraft:', e && e.message || e);
      toast('Erro ao gerar mensagem');
      ta.placeholder = prevPlaceholder;
    }
  }

  // REGRA DE OURO: o sistema rascunha, o PINTOR dispara. Nunca automático.
  async function crmSend(id){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    const c = (_crmCache||[]).find(x => x.id === id);
    if(!c) return;
    const ta = document.getElementById('crm-msg-'+id);
    const msg = ta ? ta.value.trim() : '';
    if(!msg){ toast('Escreva ou gere a mensagem primeiro'); return; }

    const phoneDigits = String(c.client_phone||'').replace(/\D/g,'');
    const hasPhone = phoneDigits.length >= 10;

    try {
      if(c.is_app_user && c.client_user_id){
        // Cliente do app: notificação in-app.
        if(!(await appConfirm('Enviar este lembrete para '+(c.client_name||'o cliente')+' pelo app?', { okLabel:'Enviar' }))) return;
        await notify(c.client_user_id, 'followup', 'Lembrete do seu profissional', msg, null);
        await sb.from('follow_ups').insert({
          painter_id: currentUser.id, crm_client_id: c.id, message: msg,
          status:'sent', sent_at:new Date().toISOString(), channel:'app'
        });
        toast('Lembrete enviado pelo app ✅');
      } else if(hasPhone && c.followup_optin){
        // Externo com telefone E opt-in: abre WhatsApp, o pintor dispara.
        const phone = phoneDigits.length <= 11 ? '55'+phoneDigits : phoneDigits;
        window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg), '_blank', 'noopener,noreferrer');
        await sb.from('follow_ups').insert({
          painter_id: currentUser.id, crm_client_id: c.id, message: msg,
          status:'sent', sent_at:new Date().toISOString(), channel:'whatsapp'
        });
        toast('WhatsApp aberto — confirme o envio por lá 📲');
      } else {
        toast('Cliente sem opt-in ou sem telefone — não é possível enviar');
      }
    } catch(e){
      console.error('crmSend:', e && e.message || e);
      toast('Erro ao registrar o envio');
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.crm = {
    loadCrm, renderCrm, renderCrmCard,
    saveCrmInterval, crmDraft, crmSend
  };
})();
