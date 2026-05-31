// modules/admin-mod.js — feature "Painel de moderação admin" (fila de revisão
// de posts + dashboard de erros) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, apiPost, showModal, toast,
// escapeHtml, escapeJsArg, cfImg, loadFeed, POST_COLS, getAccessToken,
// _isAdmin (lido como global — usado em outras features além de admin,
// então a fonte de verdade fica no app.js).
// `_errsState` é estado encapsulado neste módulo (só admin-mod usa).
(function(){
  'use strict';

  async function checkAdminEntry(){
    try {
      const token = await getAccessToken();
      if(!token) return;
      // Passa accessToken no body também porque admin-moderate.js lê só do
      // body (não header). Sem isso, o endpoint retorna 401 e _isAdmin nunca
      // vira true mesmo pra quem está em ADMIN_EMAILS.
      const { ok, data } = await apiPost('/api/admin-moderate', { action: 'check', accessToken: token });
      if(!ok || !data) return;
      _isAdmin = !!data.admin;
      const link = document.getElementById('mod-queue-link');
      if(link) link.style.display = _isAdmin ? '' : 'none';
      // Tile do dashboard de erros (Fase: substituto caseiro de Sentry).
      const errLink = document.getElementById('errors-admin-link');
      if(errLink) errLink.style.display = _isAdmin ? '' : 'none';
    } catch(e){ console.warn('checkAdminEntry:', e && e.message || e); }
  }

  // ── Dashboard de erros (admin) ───────────────────────────────────────────
  // Substitui Sentry: lê a tabela `errors` via /api/admin-errors-list (que
  // usa service_role e gate por ADMIN_EMAILS). Sem novo SaaS externo.
  let _errsState = { offset: 0, limit: 50, total: 0 };

  function openErrorsAdmin(){
    if(!_isAdmin){ toast('Apenas admins'); return; }
    showModal('errors-admin-modal');
    _errsState.offset = 0;
    loadErrorsAdmin(0);
  }

  async function loadErrorsAdmin(offset){
    const list = document.getElementById('errs-list');
    const meta = document.getElementById('errs-meta');
    const pager = document.getElementById('errs-pager');
    if(!list) return;
    list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Carregando...</div>';
    if(meta) meta.textContent = '';
    if(pager) pager.style.display = 'none';

    const token = await getAccessToken();
    if(!token){ list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Sessão expirada.</div>'; return; }

    const type = (document.getElementById('errs-type')||{}).value || '';
    const since = parseInt((document.getElementById('errs-since')||{}).value) || 24;
    const search = ((document.getElementById('errs-search')||{}).value || '').trim();
    _errsState.offset = offset || 0;

    const { ok, data, error } = await apiPost('/api/admin-errors-list', {
      accessToken: token,
      type, since_hours: since, search,
      limit: _errsState.limit, offset: _errsState.offset
    });

    if(!ok || !data || !Array.isArray(data.rows)){
      list.innerHTML = '<div style="text-align:center;color:var(--p4);padding:30px;">Erro: '+escapeHtml(error || 'desconhecido')+'</div>';
      return;
    }
    _errsState.total = data.total || 0;
    renderErrorsAdmin(data.rows);
    if(meta){
      const from = data.rows.length ? (_errsState.offset + 1) : 0;
      const to = _errsState.offset + data.rows.length;
      meta.textContent = from + '–' + to + ' de ' + _errsState.total + ' nas últimas ' + data.since_hours + 'h';
    }
    if(pager){
      pager.style.display = _errsState.total > _errsState.limit ? 'flex' : 'none';
      const prev = document.getElementById('errs-prev');
      const next = document.getElementById('errs-next');
      const info = document.getElementById('errs-page-info');
      const totalPages = Math.max(Math.ceil(_errsState.total / _errsState.limit), 1);
      const curPage = Math.floor(_errsState.offset / _errsState.limit) + 1;
      if(prev) prev.disabled = _errsState.offset <= 0;
      if(next) next.disabled = _errsState.offset + _errsState.limit >= _errsState.total;
      if(info) info.textContent = 'Página ' + curPage + ' de ' + totalPages;
    }
  }

  function errsPager(delta){
    const next = _errsState.offset + delta * _errsState.limit;
    if(next < 0 || next >= _errsState.total) return;
    loadErrorsAdmin(next);
  }

  function renderErrorsAdmin(rows){
    const list = document.getElementById('errs-list');
    if(!list) return;
    // R24: rows pode vir undefined/null se o caller passou direto da resposta
    const safeRows = Array.isArray(rows) ? rows : [];
    if(!safeRows.length){
      list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Nenhum erro no período. 🎉</div>';
      return;
    }
    // Cor por tipo pra escanear visual rápido.
    const typeColor = {
      'error': 'var(--p4)', 'unhandledrejection': 'var(--p4)',
      'feed-fail': 'var(--p4)', 'follow-not-persisted': 'var(--p4)',
      'web-vital': 'var(--p3)', 'pageview': 'var(--muted)',
      'feed-slow': '#f59e0b', 'feed-step-timeout': '#f59e0b',
      'story-img-fail': '#f59e0b', 'story-video-fail': '#f59e0b'
    };
    list.innerHTML = safeRows.map(r => {
      const tColor = typeColor[r.type] || 'var(--ink)';
      const when = r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '';
      const uidShort = r.user_id ? String(r.user_id).slice(0, 8) : '';
      const msgShown = escapeHtml((r.msg || '').slice(0, 200));
      const ctxShown = r.ctx ? '<span style="color:var(--muted);"> · '+escapeHtml(r.ctx)+'</span>' : '';
      const metricShown = r.metric ? ' · ' + escapeHtml(r.metric) + (r.value!=null?'='+r.value:'') : '';
      return '<div style="padding:10px 0;border-bottom:1px solid var(--border);font-family:monospace;font-size:11.5px;line-height:1.5;">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:3px;flex-wrap:wrap;">'
        + '<span style="font-weight:700;color:'+tColor+';">'+escapeHtml(r.type||'?')+metricShown+'</span>'
        + '<span style="color:var(--muted);font-size:10.5px;">'+escapeHtml(when)+'</span>'
        + '</div>'
        + '<div style="color:var(--ink);word-break:break-word;">'+msgShown+ctxShown+'</div>'
        + (uidShort ? '<div style="color:var(--muted);font-size:10.5px;margin-top:2px;">user '+uidShort+'…</div>' : '')
        + '</div>';
    }).join('');
  }

  async function openModQueue(){
    showModal('mod-queue-modal');
    const list = document.getElementById('mod-queue-list');
    if(list) list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Carregando...</div>';
    try {
      const sb = getSupabase();
      const { data: posts, error } = await sb.from('posts').select(POST_COLS)
        .eq('status','pending').order('created_at',{ascending:true}).limit(50);
      if(error){ list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Erro ao carregar.</div>'; return; }
      if(!posts || posts.length === 0){
        list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Nada pendente. 🎉</div>';
        const cnt = document.getElementById('mod-queue-count'); if(cnt) cnt.textContent = 'Fila vazia';
        return;
      }
      const cnt = document.getElementById('mod-queue-count'); if(cnt) cnt.textContent = posts.length + ' pendente(s)';
      list.innerHTML = posts.map(p => {
        const cap = escapeHtml(p.caption || '');
        const mediaUrl = escapeHtml(p.media_url || '');
        const mediaImg = p.media_url && p.media_type !== 'video' ? escapeHtml(cfImg(p.media_url, { w: 600, q: 75 })) : mediaUrl;
        const media = p.media_url
          ? (p.media_type === 'video'
              ? `<video src="${mediaUrl}" controls style="width:100%;border-radius:12px;max-height:260px;background:#000;"></video>`
              : `<img src="${mediaImg}" style="width:100%;border-radius:12px;max-height:260px;object-fit:cover;">`)
          : '';
        // R23: p.created_at pode ser null em row corrompida — evita "Invalid Date"
        const when = p.created_at ? new Date(p.created_at).toLocaleString('pt-BR') : '';
        return `<div style="background:var(--white);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:12px;">
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">${escapeHtml(p.media_type||'post')} · ${when}</div>
          ${media}
          ${cap ? `<div style="font-size:13px;color:var(--ink);margin:8px 0;">${cap}</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button onclick="modAction('${escapeJsArg(p.id||'')}','approve',this)" style="flex:1;padding:10px;border:none;border-radius:10px;background:#2ec4b6;color:#fff;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">Aprovar</button>
            <button onclick="modAction('${escapeJsArg(p.id||'')}','reject',this)" style="flex:1;padding:10px;border:none;border-radius:10px;background:#e63946;color:#fff;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">Rejeitar</button>
          </div>
        </div>`;
      }).join('');
    } catch(e){
      console.error('openModQueue:', e && e.message || e);
      if(list) list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;">Erro ao carregar.</div>';
    }
  }

  async function modAction(postId, action, btn){
    try {
      const card = btn?.closest('div[style*="background:var(--white)"]');
      if(btn){ btn.disabled = true; btn.textContent = '...'; }
      const { ok, data } = await apiPost('/api/admin-moderate', { action, postId });
      if(!ok || !data || !data.ok){ toast('Erro: ' + ((data && data.error) || 'falha')); if(btn){ btn.disabled=false; btn.textContent = action==='approve'?'Aprovar':'Rejeitar'; } return; }
      toast(action === 'approve' ? 'Post aprovado' : 'Post rejeitado');
      if(card) card.remove();
      if(typeof loadFeed === 'function') loadFeed();
    } catch(e){
      console.error('modAction:', e && e.message || e);
      toast('Erro ao processar');
      if(btn){ btn.disabled=false; btn.textContent = action==='approve'?'Aprovar':'Rejeitar'; }
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.adminMod = {
    checkAdminEntry,
    openModQueue, modAction,
    openErrorsAdmin, loadErrorsAdmin, errsPager, renderErrorsAdmin
  };
})();
