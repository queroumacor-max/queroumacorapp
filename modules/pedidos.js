// modules/pedidos.js — feature "Pedidos" (lista de orçamentos + compras da loja)
// extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, escapeHtml,
// avatarOf, aprovarQuoteCliente, verSnapshot.
// Tabelas `quotes` e `orders` já existem no Supabase.
(function(){
  'use strict';

  // ══ PEDIDOS (orçamentos + compras da loja) ══
  async function loadPedidos(){
    const sb = getSupabase();
    const container = document.getElementById('pedidos-list');
    if(!sb || !currentUser || !container) return;
    try {
      const myId = currentUser.id;
      // Load quotes (orcamentos)
      const { data: quotes, error } = await sb.from('quotes')
        .select('*, painter:profiles!painter_id(name, avatar_url), client:profiles!client_id(name, avatar_url)')
        .or('client_id.eq.'+myId+',painter_id.eq.'+myId)
        .order('created_at', { ascending: false });
      if(error) throw error;

      // Load store orders (compras da loja)
      let orders = [];
      try {
        const { data: ordersData } = await sb.from('orders')
          .select('*')
          .eq('user_id', myId)
          .order('created_at', { ascending: false });
        orders = ordersData || [];
      } catch(e){ /* orders table might not exist yet */ }

      if((!quotes || quotes.length === 0) && orders.length === 0){
        container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);"><div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px;">Sem pedidos</div><div style="font-size:13px;">Seus orçamentos e compras aparecerão aqui</div></div>';
        return;
      }
      const statusLabels = { pending:'Aguardando', rascunho:'Rascunho', enviado:'Enviado', aprovado:'Aprovado', em_execucao:'Em execução', concluido:'Concluído', recusado:'Recusado', accepted:'Aceito', completed:'Concluido', rejected:'Rejeitado', processing:'Em andamento', shipped:'Enviado' };
      const statusClasses = { pending:'status-aguardando', rascunho:'status-aguardando', enviado:'status-respondido', aprovado:'status-concluido', em_execucao:'status-respondido', concluido:'status-concluido', recusado:'status-rejeitado', accepted:'status-respondido', completed:'status-concluido', rejected:'status-rejeitado', processing:'status-respondido', shipped:'status-concluido' };

      let html = '';
      // Render store orders
      orders.forEach(o => {
        const itemNames = (o.items || []).map(i => i.name).slice(0,3).join(', ');
        const st = statusLabels[o.status] || 'Aguardando';
        const stClass = statusClasses[o.status] || 'status-aguardando';
        const date = o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '';
        const total = o.total ? 'R$ '+Number(o.total).toFixed(2).replace('.',',') : '';
        html += '<div data-status="'+(o.status||'pending')+'" class="pedido-card">'
          + '<div class="pedido-head">'
          + '<div class="pedido-pav" style="background:var(--ink);display:flex;align-items:center;justify-content:center;border-radius:10px;width:40px;height:40px;"><span style="font-size:10px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">CC</span></div>'
          + '<div><div class="pedido-painter">Cali Colors - Loja</div><div class="pedido-tipo">'+escapeHtml(itemNames || 'Compra')+'</div></div>'
          + '<div class="pedido-status '+stClass+'">'+st+'</div>'
          + '</div>'
          + '<div class="pedido-meta">'+(total?'<span>'+total+'</span>':'')+'<span>'+date+'</span></div>'
          + '</div>';
      });

      // Render quotes
      (quotes || []).forEach(q => {
        const isClient = q.client_id === myId;
        const other = isClient ? (q.painter || {}) : (q.client || {});
        const name = other.name || 'Usuário';
        const avatar = avatarOf({ avatar_url: other.avatar_url, name: name });
        const st = statusLabels[q.status] || q.status || 'Pendente';
        const stClass = statusClasses[q.status] || 'status-aguardando';
        const date = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '';
        const price = q.price ? 'R$ '+Number(q.price).toLocaleString('pt-BR') : '';
        let qActions = '';
        if(isClient && q.status==='enviado'){
          qActions = '<div style="display:flex;gap:7px;margin-top:9px;">'
            + '<button onclick="aprovarQuoteCliente(\''+q.id+'\')" style="flex:1;padding:9px;background:#2ec4b6;color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Aprovar orçamento</button>'
            + '<button onclick="verSnapshot(\''+q.id+'\')" style="padding:9px 14px;background:var(--cream);color:var(--ink);border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ver</button>'
            + '</div>';
        } else if(['aprovado','em_execucao','concluido'].includes(q.status)){
          qActions = '<div style="margin-top:9px;"><button onclick="verSnapshot(\''+q.id+'\')" style="width:100%;padding:9px;background:var(--cream);color:var(--ink);border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Ver escopo aprovado</button></div>';
        }
        html += '<div data-status="'+escapeHtml(q.status||'pending')+'" class="pedido-card">'
          + '<div class="pedido-head">'
          + '<div class="pedido-pav"><img src="'+escapeHtml(avatar)+'" alt=""></div>'
          + '<div><div class="pedido-painter">'+escapeHtml(name)+'</div><div class="pedido-tipo">'+escapeHtml(q.service_type||q.title||'Orcamento')+'</div></div>'
          + '<div class="pedido-status '+stClass+'">'+st+'</div>'
          + '</div>'
          + '<div class="pedido-meta">'+(price?'<span>'+price+'</span>':'')+'<span>'+date+'</span></div>'
          + qActions
          + '</div>';
      });
      container.innerHTML = html;
    } catch(e){
      console.error('loadPedidos error:', e && e.message || e);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Erro ao carregar pedidos</div>';
    }
  }

  // ══ PEDIDOS FILTER ══
  function filterPedidos(el,status){
    el.closest('.pedidos-filter-row').querySelectorAll('.pfchip').forEach(c=>c.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('#screen-pedidos .pedido-card').forEach(card=>{
      if(status==='todos'||card.dataset.status===status)card.style.display='block';
      else card.style.display='none';
    });
  }

  window.Modules = window.Modules || {};
  window.Modules.pedidos = { loadPedidos, filterPedidos };
})();
