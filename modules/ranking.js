// modules/ranking.js — feature "ranking" (top pintores por cidade).
// Fase 4: cópia fiel da função top-level do app.js. App.js continua
// tendo o original (sem regressão). Migração de call sites e remoção
// do duplicado vem em PR futuro.
(function(){
  'use strict';

  async function loadRanking(){
    const city = document.getElementById('ranking-city').value.trim().toLowerCase();
    if(!city || city.length < 2) return;
    const sb = getSupabase(); if(!sb) return;
    const { data: painters } = await sb.from('profiles_public').select('id, name, tag, avatar_url, city, state, rating_avg, role').in('role',['pintor','grafiteiro','automotivo']).ilike('city','%'+city+'%').order('rating_avg',{ascending:false,nullsFirst:false}).limit(20);
    const el = document.getElementById('ranking-list');
    if(!painters||painters.length===0){ el.innerHTML='<div style="text-align:center;color:var(--muted);padding:20px;font-size:13px;">Nenhum pintor encontrado nesta cidade</div>'; return; }
    el.innerHTML = painters.map((p,i)=>{
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'<span style="font-size:12px;font-weight:700;color:var(--muted);">#'+(i+1)+'</span>';
      const avatar = avatarOf({ avatar_url: p.avatar_url, name: p.name||'P' });
      const stars = p.rating_avg ? '⭐ '+(+p.rating_avg).toFixed(1) : 'Sem avaliação';
      return `<div onclick="openUserProfile('${escapeJsArg(p.id)}')" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--white);border-radius:12px;margin-bottom:6px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.04);">
        <div style="width:28px;text-align:center;">${medal}</div>
        <img src="${escapeHtml(avatar)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
        <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${escapeHtml(p.name||'')}</div><div style="font-size:11px;color:var(--muted);">${p.tag?'@'+escapeHtml(p.tag):''} · ${escapeHtml((p.city||'')+', '+(p.state||''))}</div></div>
        <div style="font-size:12px;font-weight:600;color:var(--p1);">${stars}</div>
      </div>`;
    }).join('');
  }

  window.Modules = window.Modules || {};
  window.Modules.ranking = { loadRanking };
})();
