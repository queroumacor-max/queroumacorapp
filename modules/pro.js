// modules/pro.js — feature "Plano PRO" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, getMyProfile,
// apiPost, appConfirm, toast, showModal, showScreen, dateBR,
// validatedInviteCode, signupNext, loadPedidos.
// Ranges originais no app.js: 439–605 (refreshProStatus, applyProUI,
// checkProAccess, handleProReturn, abrirParceriaMP, handleCompraReturn,
// handleReferralParam) + 1417–1441 (startProCheckout).
(function(){
  'use strict';

  // ══ AI FEATURES (PRO) ══
  let _isPro = false;
  let _proExpires = null;

  async function refreshProStatus(){
    try {
      const sb = getSupabase();
      if(!sb || !currentUser) { _isPro = false; _proExpires = null; applyProUI(); return false; }
      const data = await getMyProfile();
      const notExpired = !data?.pro_expires_at || new Date(data.pro_expires_at) > new Date();
      _isPro = !!(data && data.is_pro && notExpired);
      _proExpires = data?.pro_expires_at || null;
      applyProUI();
      return _isPro;
    } catch(e){ console.warn('refreshProStatus:', e && e.message || e); applyProUI(); return _isPro; }
  }

  // Quando o perfil ja e PRO, troca o banner de upsell por "PRO ativo"
  function applyProUI(){
    try {
      const badge = document.getElementById('pro-status-badge');
      if(badge){
        if(_isPro){
          badge.textContent = 'PRO';
          badge.style.background = '#16a34a';
          badge.style.color = '#fff';
        } else {
          badge.textContent = 'GRÁTIS';
          badge.style.background = 'rgba(255,255,255,.15)';
          badge.style.color = '#fff';
        }
      }
      const banner = document.querySelector('#view-pintor .pro-banner');
      if(!banner) return;
      if(_isPro){
        banner.onclick = null;
        banner.style.cursor = 'default';
        let until = '';
        if(_proExpires){ until = ' · até ' + dateBR(_proExpires); }
        banner.innerHTML =
          '<div class="pro-banner-icon">✅</div>' +
          '<div class="pro-banner-text"><div class="pro-banner-title">Plano PRO ativo</div>' +
          '<div class="pro-banner-sub">Recursos PRO liberados' + until + '</div></div>' +
          '<div class="pro-banner-arrow">★</div>';
      } else {
        banner.onclick = function(){ showModal('pro-modal'); };
        banner.style.cursor = 'pointer';
        banner.innerHTML =
          '<div class="pro-banner-icon">⚡</div>' +
          '<div class="pro-banner-text"><div class="pro-banner-title">Ative o Plano PRO</div>' +
          '<div class="pro-banner-sub">Destaque-se e receba mais clientes · R$39/mês</div></div>' +
          '<div class="pro-banner-arrow">›</div>';
      }
    } catch(e){ console.warn('applyProUI:', e && e.message || e); }
  }

  function checkProAccess(){
    return _isPro;
  }

  function handleProReturn(){
    try {
      const params = new URLSearchParams(window.location.search);
      if(params.get('pro') !== 'success') return;
      toast('Pagamento recebido! Ativando seu PRO...');
      // O webhook pode levar alguns segundos; tenta atualizar algumas vezes.
      let tries = 0;
      const iv = setInterval(async () => {
        tries++;
        const pro = await refreshProStatus();
        if(pro){ clearInterval(iv); toast('Plano PRO ativado! 🎉'); }
        else if(tries >= 6){ clearInterval(iv); toast('Pagamento em processamento. O PRO será liberado em instantes.'); }
      }, 4000);
      // Limpa o parâmetro da URL
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    } catch(e){ console.warn('handleProReturn:', e && e.message || e); }
  }

  // CTA — Parceria Mercado Pago pra pintores (receber dos próprios clientes
  // via PIX/cartão/maquininha). Abre o cadastro do MP em nova aba.
  async function abrirParceriaMP(){
    const goSignup = await appConfirm(
      'Receba pagamentos dos seus clientes via Mercado Pago: PIX instantâneo, cartão até 12x e maquininha. Sem mensalidade. Vamos te levar pro cadastro?',
      { okLabel: 'Quero me cadastrar', cancelLabel: 'Agora não' }
    );
    if(!goSignup) return;
    window.open('https://www.mercadopago.com.br/registration/landing', '_blank', 'noopener,noreferrer');
  }

  // Retorno do checkout Mercado Pago (Loja). URL: /?compra=<orderId>&status=success|failure|pending
  // Faz polling no status da order pra confirmar quando o webhook chegou.
  function handleCompraReturn(){
    try {
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get('compra');
      if(!orderId) return;
      const status = (params.get('status') || '').toLowerCase();
      // Limpa a URL
      window.history.replaceState({}, '', window.location.pathname);

      // Se MP devolveu falha explícita, mostra direto sem polling
      if(status === 'failure'){
        toast('Pagamento não concluído. Você pode tentar de novo em "Meus Pedidos".');
        return;
      }
      if(status === 'pending'){
        toast('Pagamento pendente (PIX/boleto). Acompanhe em "Meus Pedidos".');
        return;
      }

      toast('Confirmando pagamento...');
      const sb = getSupabase();
      if(!sb || !currentUser) return;
      let tries = 0;
      const iv = setInterval(async () => {
        tries++;
        try {
          const { data } = await sb.from('orders')
            .select('status, paid_at')
            .eq('id', orderId).single();
          if(data && data.status === 'paid'){
            clearInterval(iv);
            toast('Compra confirmada! 🎉 Você ganhou pontos.');
            // recarrega a tela de pedidos se estiver aberta
            if(typeof loadPedidos === 'function'){ try { loadPedidos(); } catch{} }
          } else if(data && data.status === 'amount_mismatch'){
            clearInterval(iv);
            toast('Atenção: valor pago diverge do pedido. Entre em contato com a loja.');
          } else if(data && (data.status === 'canceled' || data.status === 'refunded')){
            clearInterval(iv);
            toast('Pagamento ' + (data.status === 'refunded' ? 'estornado' : 'cancelado') + '.');
          } else if(tries >= 8){
            clearInterval(iv);
            toast('Pagamento em processamento. Acompanhe em "Meus Pedidos".');
          }
        } catch(e){ /* tenta de novo */ }
      }, 3000);
    } catch(e){ console.warn('handleCompraReturn:', e && e.message || e); }
  }

  // Link de perfil compartilhado (?ref=<userId>): funciona como convite —
  // pula o passo do código e registra quem indicou (invited_by).
  async function handleReferralParam(){
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if(!ref) return;
      // Limpa o parâmetro da URL
      window.history.replaceState({}, '', window.location.pathname);
      if(currentUser) return; // já logado/cadastrado — ignora
      const sb = getSupabase();
      let refName = '';
      try {
        if(sb){
          const { data } = await sb.from('profiles_public').select('name').eq('id', ref).single();
          refName = data ? (data.name || '') : '';
        }
      } catch(e){ /* ref inválido cai abaixo */ }
      if(!refName) return; // perfil inexistente — ignora o link
      // Marca como convite válido (substitui o código) e vai direto ao cadastro
      validatedInviteCode = { created_by: ref, referral: true };
      showScreen('signup');
      if(typeof signupNext === 'function') signupNext(1); // pula o passo do código
      toast('Você foi convidado por ' + refName.split(' ')[0] + '! Crie sua conta 🎨');
    } catch(e){ console.warn('handleReferralParam:', e && e.message || e); }
  }

  async function startProCheckout(){
    const btn = document.getElementById('pro-cta-btn');
    try {
      const sb = getSupabase();
      if(!sb){ toast('Erro: Supabase indisponível'); return; }
      const { data:{ session } } = await sb.auth.getSession();
      if(!session){ toast('Faça login para assinar'); return; }
      if(btn){ btn.textContent = 'Abrindo pagamento...'; btn.disabled = true; }
      const { ok, data } = await apiPost('/api/checkout', {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.user_metadata?.name || ''
      });
      if(!ok || !data || !data.init_point){
        toast('Erro ao iniciar pagamento: ' + ((data && data.error) || 'tente novamente'));
        if(btn){ btn.textContent = 'Assinar Agora'; btn.disabled = false; }
        return;
      }
      window.location.href = data.init_point;
    } catch(e){
      console.error('startProCheckout:', e && e.message || e);
      toast('Erro ao iniciar pagamento');
      if(btn){ btn.textContent = 'Assinar Agora'; btn.disabled = false; }
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.pro = {
    refreshProStatus, applyProUI, checkProAccess, handleProReturn,
    abrirParceriaMP, handleCompraReturn, handleReferralParam, startProCheckout
  };
})();
