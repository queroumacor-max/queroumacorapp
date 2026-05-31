// modules/points-refs.js — features "Pontos / Cashback" + "Indicações"
// extraídas do app.js. Fase 4 da modularização (etapa 1: COPIA pra criar
// a camada; próximo PR migra call sites e remove duplicatas do app.js).
//
// Por que `points` e `referrals` ficam juntas neste módulo:
//  - O saldo exibido em loadReferrals (#ref-pontos) é calculado somando
//    rows da tabela `points` (earned − spent), ou seja, a tela de
//    indicações depende diretamente da tabela `points`.
//  - O trigger `award_referral_points` no Supabase credita pontos em
//    `points` quando uma indicação é concluída — o mesmo evento alimenta
//    as duas UIs (lista de indicações + histórico de pontos).
//  - loadPoints e loadReferrals leem ambos `points`, então mantê-las
//    no mesmo módulo evita duplicação de imports/dependências.
//
// Depende de globals do app.js: getSupabase, currentUser, requireSession,
// appConfirm, toast, escapeHtml, showError, invalidateMyProfile,
// refreshProStatus.
//
// Tabelas `points` e `referrals` já existem no Supabase (com RLS, FK,
// policy de INSERT em `referrals`, e triggers `award_referral_points` +
// `recalc_painter_rating`). UNIQUE em `points(source, reference_id)`
// impede double-credit (Wave 3 do hardening — ver CLAUDE.md).
// A troca de 100 pts por PRO usa a RPC `redeem_pro_with_points`
// (SECURITY DEFINER) — o cliente NÃO escreve direto em `profiles.is_pro`.
(function(){
  'use strict';

  // ══ INDICAÇÕES ══
  async function loadReferrals(){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    const { data: refs } = await sb.from('referrals').select('*').eq('referrer_id', currentUser.id).order('created_at',{ascending:false});
    const { data: pts } = await sb.from('points').select('amount,type').eq('user_id', currentUser.id);
    let total = 0; (pts||[]).forEach(p=>{ total += p.type==='earned'?(p.amount||0):-(p.amount||0); });
    document.getElementById('ref-pontos').textContent = total;
    const el = document.getElementById('ref-list');
    if(!refs||refs.length===0) return;
    el.innerHTML = refs.map(r=>`<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;display:flex;justify-content:space-between;"><span>${r.status}</span><span style="color:var(--p1);font-weight:700;">+${r.bonus_points} pts</span></div>`).join('');
  }

  // ══ PONTOS / CASHBACK ══
  async function loadPoints(){
    const sb = getSupabase(); if(!sb||!currentUser) return;
    const { data: pts } = await sb.from('points').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(20);
    let saldo = 0; (pts||[]).forEach(p=>{ saldo += p.type==='earned'?(p.amount||0):-(p.amount||0); });
    document.getElementById('pts-saldo').textContent = saldo+' pts';
    // Botão de troca: liga só com 100+ pts; senão mostra quantos faltam
    const redeemBtn = document.getElementById('pts-redeem-btn');
    if(redeemBtn){
      if(saldo >= 100){
        redeemBtn.disabled = false;
        redeemBtn.style.opacity = '1';
        redeemBtn.style.cursor = 'pointer';
        redeemBtn.textContent = '⚡ Trocar 100 pts por 1 mês PRO';
      } else {
        redeemBtn.disabled = true;
        redeemBtn.style.opacity = '0.5';
        redeemBtn.style.cursor = 'not-allowed';
        redeemBtn.textContent = '⚡ Faltam ' + (100 - saldo) + ' pts pra liberar 1 mês PRO';
      }
    }
    const el = document.getElementById('pts-historico');
    if(!pts||pts.length===0) return;
    el.innerHTML = pts.map(p=>{
      const sign = p.type==='earned'?'+':'-';
      const color = p.type==='earned'?'#2ec4b6':'var(--p1)';
      return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>${escapeHtml(p.source||'')}</span><span style="color:${color};font-weight:700;">${sign}${p.amount} pts</span></div>`;
    }).join('');
  }

  // ══ TROCAR 100 PTS POR 1 MÊS PRO EXTRA ══
  // Chama a RPC redeem_pro_with_points (SECURITY DEFINER) que valida o
  // saldo, debita os pontos e estende o PRO em transação atômica no
  // servidor — assim o cliente NÃO consegue mais bypassar fazendo
  // UPDATE direto em profiles.is_pro pelo devtools.
  async function trocarPontosPorPRO(){
    const ctx = requireSession('Faça login');
    if(!ctx) return;
    const sb = ctx.sb;
    const btn = document.getElementById('pts-redeem-btn');
    if(btn) btn.disabled = true;
    try {
      if(!(await appConfirm('Trocar 100 pts por 1 mês PRO extra?', { okLabel:'Trocar' }))){
        return;
      }
      const { data: newExp, error } = await sb.rpc('redeem_pro_with_points', { p_cost: 100 });
      if(error) throw error;
      if(typeof invalidateMyProfile === 'function') invalidateMyProfile();
      toast('1 mês PRO liberado! 🎉');
      loadPoints();
      if(typeof refreshProStatus === 'function') refreshProStatus();
    } catch(e){
      // Mensagens em português vêm direto do RAISE EXCEPTION da função
      showError('redeem-pro', e, (e && e.message) || 'Não foi possível trocar os pontos. Tente novamente.');
    } finally {
      if(btn) btn.disabled = false;
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.pointsRefs = {
    loadReferrals, loadPoints, trocarPontosPorPRO
  };
})();
