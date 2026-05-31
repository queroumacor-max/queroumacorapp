// modules/avaliacao.js — feature "Avaliação" (reviews de pintores) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, requireSession,
// toast, escapeHtml, avatarOf, showScreen.
// Usa RPC submit_review (SECURITY DEFINER) no Supabase — valida quote
// ownership, rating 1-5 e bloqueia duplicatas.
(function(){
  'use strict';

  // ══ AVALIAÇÃO ══
  let starVal = 0;
  const starLabels = ['','Ruim 😞','Regular 😐','Bom 🙂','Muito bom 😄','Excelente! 🤩'];

  function setStar(n){
    starVal = n;
    document.querySelectorAll('.star-btn').forEach((s,i)=>s.classList.toggle('active',i<n));
    document.getElementById('star-label').textContent = starLabels[n];
    document.getElementById('star-label').style.color = n>=4?'var(--p6)':n>=3?'var(--p7)':'var(--p4)';
  }

  function toggleCriteria(el){ el.classList.toggle('sel'); }

  let avaliarQuoteId = null;
  let _avaliarQuotes = [];

  async function loadAvaliarScreen(){
    const sb = getSupabase();
    const container = document.getElementById('avaliar-service-container');
    const form = document.getElementById('avaliar-form');
    if(!sb || !currentUser || !container) return;
    try {
      // Load completed/accepted quotes for the user to review
      const { data: quotes, error } = await sb.from('quotes')
        .select('id, title, service_type, area_m2, created_at, status, painter:profiles!painter_id(id, name, avatar_url, city)')
        .eq('client_id', currentUser.id)
        .in('status', ['concluido','completed','accepted'])
        .order('created_at', { ascending: false })
        .limit(10);
      if(error) throw error;
      _avaliarQuotes = quotes || [];
      if(!quotes || quotes.length === 0){
        container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:40px;margin-bottom:12px;">⭐</div><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum serviço para avaliar</div><div style="font-size:13px;">Quando um orçamento for concluído, você poderá avaliar aqui</div></div>';
        if(form) form.style.display = 'none';
        return;
      }
      // Show the first/most recent service to evaluate
      const q = quotes[0];
      const painter = q.painter || {};
      avaliarQuoteId = q.id;
      const avatar = avatarOf({ avatar_url: painter.avatar_url, name: painter.name||'P' });
      document.getElementById('avaliar-av-img').src = avatar;
      document.getElementById('avaliar-title').textContent = painter.name || 'Pintor';
      document.getElementById('avaliar-sub').textContent = (q.service_type||q.title||'Servico') + (painter.city ? ' · '+painter.city : '') + (q.area_m2 ? ' · '+q.area_m2+'m²' : '');
      container.innerHTML = '';
      if(form) form.style.display = 'block';
      // Show other services as selectable list if > 1
      if(quotes.length > 1) renderAvaliarServiceList();
    } catch(e){
      console.error('loadAvaliarScreen error:', e && e.message || e);
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nenhum serviço para avaliar</div><div style="font-size:13px;">Solicite um orçamento primeiro</div></div>';
      if(form) form.style.display = 'none';
    }
  }

  function renderAvaliarServiceList(){
    const container = document.getElementById('avaliar-service-container');
    if(!container || _avaliarQuotes.length < 2) return;
    container.innerHTML = '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Selecione o serviço</div>' +
      _avaliarQuotes.map(qq => {
        const pp = qq.painter || {};
        const sel = qq.id === avaliarQuoteId;
        return '<div onclick="selectAvaliarService(\''+qq.id+'\')" style="padding:10px;background:'+(sel?'var(--cream)':'var(--white)')+';border-radius:10px;margin-bottom:6px;cursor:pointer;border:1px solid '+(sel?'var(--p1)':'var(--border)')+';font-size:13px;"><b>'+escapeHtml(pp.name||'Pintor')+'</b> — '+escapeHtml(qq.service_type||qq.title||'Serviço')+'</div>';
      }).join('');
  }

  function selectAvaliarService(quoteId){
    const q = _avaliarQuotes.find(x => x.id === quoteId);
    if(!q) return;
    avaliarQuoteId = q.id;
    const painter = q.painter || {};
    const avatar = avatarOf({ avatar_url: painter.avatar_url, name: painter.name||'P' });
    const av = document.getElementById('avaliar-av-img'); if(av) av.src = avatar;
    const tt = document.getElementById('avaliar-title'); if(tt) tt.textContent = painter.name || 'Pintor';
    const sb2 = document.getElementById('avaliar-sub');
    if(sb2) sb2.textContent = (q.service_type||q.title||'Serviço') + (painter.city ? ' · '+painter.city : '') + (q.area_m2 ? ' · '+q.area_m2+'m²' : '');
    renderAvaliarServiceList();
  }

  async function submitAvaliacao(){
    if(!starVal){ toast('Selecione uma nota primeiro!'); return; }
    const ctx = requireSession('Faça login primeiro');
    if(!ctx) return;
    const sb = ctx.sb;
    // Botão único na tela "Avaliar" — pego via querySelector.
    const btn = (typeof event !== 'undefined' && event && event.currentTarget) ||
                document.querySelector('.avaliar-submit');
    if(btn && btn.dataset._loading) return; // double-submit guard
    const criteria = [];
    document.querySelectorAll('.criteria-chip.sel').forEach(c => criteria.push(c.textContent.trim()));
    const comment = document.getElementById('avalia-ta')?.value.trim() || '';
    const restore = (typeof setButtonLoading === 'function') ? setButtonLoading(btn, 'Enviando...') : () => {};
    try {
      // Usa a RPC submit_review (SECURITY DEFINER) — valida no servidor:
      // quote pertence ao caller, rating 1-5, sem duplicata
      const { error } = await sb.rpc('submit_review', {
        p_quote_id: avaliarQuoteId || null,
        p_painter_id: null,
        p_rating: starVal,
        p_comment: comment || null,
        p_criteria: criteria
      });
      if(error) throw error;
      toast('Avaliacao enviada! '+starLabels[starVal]);
      starVal = 0;
      document.querySelectorAll('.star-btn').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.criteria-chip.sel').forEach(c => c.classList.remove('sel'));
      if(document.getElementById('avalia-ta')) document.getElementById('avalia-ta').value = '';
      setTimeout(()=>showScreen('myprofile'),1200);
    } catch(e){
      console.error('submitAvaliacao error:', e && e.message || e);
      toast('Erro ao enviar avaliação: ' + (e.message || e));
    } finally { restore(); }
  }

  window.Modules = window.Modules || {};
  window.Modules.avaliacao = {
    setStar, toggleCriteria,
    loadAvaliarScreen, renderAvaliarServiceList,
    selectAvaliarService, submitAvaliacao
  };
})();
