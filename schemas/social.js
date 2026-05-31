// schemas/social.js — Zod-shaped schemas for social/text inputs:
// tag (handle/@username), url, dateBR. Backward-compat com validateHandle/URL/DateBR.
(function(){
  'use strict';
  function err(c, m){ return { ok:false, error:{ code:c, message:m } }; }
  function ok(value){ return { ok:true, value }; }

  // tag === handle. a-z 0-9 _, 3..24 chars. Normaliza pra lowercase.
  // No CLAUDE.md: profiles.tag e profiles.username são sinônimos sincronizados.
  const tag = { parse(v){
    if(typeof v !== 'string' || !v.trim()) return err('required', 'Informe o @');
    const s = v.trim().toLowerCase();
    if(s.length < 3 || s.length > 24) return err('out_of_range', 'O @ deve ter entre 3 e 24 caracteres');
    if(!/^[a-z0-9_]+$/.test(s)) return err('invalid_format', 'Use só letras minúsculas, números e _');
    return ok(s);
  }};

  const url = { parse(v){
    if(typeof v !== 'string' || !v.trim()) return err('required', 'Informe a URL');
    const s = v.trim();
    let u;
    try { u = new URL(s); } catch(_){ return err('invalid_format', 'URL inválida'); }
    if(u.protocol !== 'http:' && u.protocol !== 'https:')
      return err('invalid_protocol', 'A URL deve começar com http:// ou https://');
    if(!u.hostname) return err('invalid_format', 'URL inválida');
    return ok(u.toString());
  }};

  const dateBR = { parse(v){
    if(typeof v !== 'string' || !v.trim()) return err('required', 'Informe a data');
    const s = v.trim();
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if(m){
      const day = parseInt(m[1], 10), mon = parseInt(m[2], 10), yr = parseInt(m[3], 10);
      const dt = new Date(yr, mon - 1, day);
      if(dt.getFullYear() !== yr || dt.getMonth() !== mon - 1 || dt.getDate() !== day)
        return err('invalid_date', 'Data inválida');
      return ok(dt);
    }
    if(/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s)){
      const dt = new Date(s);
      if(isNaN(dt.getTime())) return err('invalid_date', 'Data inválida');
      return ok(dt);
    }
    return err('invalid_format', 'Use o formato dd/mm/aaaa');
  }};

  window.Schemas = window.Schemas || {};
  Object.assign(window.Schemas, { tag, url, dateBR });
})();
