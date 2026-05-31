// modules/content-mod.js — feature "Moderação de conteúdo" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, apiPost.
// Inclui regexes locais (_blockedRe, _scamLinkRe) pra ser self-contained;
// quando app.js for migrado, podemos deduplicar — por ora, a cópia evita
// quebrar o app se alguém esquecer de carregar este módulo.
(function(){
  'use strict';

  // Hard-list: palavras que disparam bloqueio total (não vão pro portal).
  // Mantida em sync com app.js — qualquer alteração lá precisa replicar aqui
  // até a etapa 2 da modularização remover a duplicata do app.js.
  const _blockedWords = [
    'pedofilia','pedofilo',
    'estupro','estuprar','estuprador',
    'cocaina','crackeira',
    'fuzil',
    'assassinar',
    'suicidio',
    'terrorismo','terrorista',
    'pornografia',
    'xxx',
    'nazismo'
  ];

  const _blockedRe = (() => {
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'');
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alts = _blockedWords.map(w => esc(norm(w))).join('|');
    return new RegExp('\\b(' + alts + ')\\b', 'i');
  })();

  // Padrões fortes de scam: encurtadores e domínios típicos de golpe.
  // URL normal (https://meusite.com.br, www.instagram.com/foo) NÃO bloqueia
  // mais — autopromoção legítima de pintor passa, Gemini avalia contexto.
  const _scamLinkRe = /(?:^|\W)(?:bit\.ly|tinyurl\.com|cutt\.ly|t\.me\/|goo\.gl\/|tiny\.cc|encurtador\.com\.br|is\.gd|shorturl\.at)/i;

  function moderateContent(text){
    if(!text) return { approved: true, reason: null };
    const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const m = _blockedRe.exec(lower);
    if(m) return { approved: false, reason: 'blocked:' + m[1] };
    if(_scamLinkRe.test(lower)) return { approved: false, reason: 'link_suspicious' };
    return { approved: true, reason: null };
  }

  async function moderateContentAsync(text, imageUrl, hasMedia){
    const local = moderateContent(text || '');
    if (!local.approved) {
      // Palavra do hard-list → bloqueio total (não vai pro portal).
      // Encurtador suspeito → revisão humana (pode ser falso positivo).
      const sev = String(local.reason || '').startsWith('blocked:') ? 'hard' : 'soft';
      return { approved: false, reason: local.reason, severity: sev };
    }
    // Fail-safe: se há mídia (imagem/vídeo) e a moderação cair, vai pra revisão
    // humana em vez de publicar direto. Texto puro que passou no filtro local publica.
    const failSafe = hasMedia
      ? { approved: false, reason: 'mod_unavailable', severity: 'soft' }
      : { approved: true, reason: null };
    try {
      const sb = getSupabase();
      const { data:{ session } } = sb ? await sb.auth.getSession() : { data:{ session:null } };
      const { ok, data } = await apiPost('/api/moderate', {
        text: text || '',
        imageUrl: imageUrl || ''
      });
      if (!ok || !data) return failSafe;
      if (data.error || data.engine === 'failed') return failSafe;
      if (data.flagged) {
        return { approved: false, reason: 'ai:' + (data.reasons || []).join(','), severity: data.severity || 'soft' };
      }
      return { approved: true, reason: null };
    } catch(e){
      console.warn('moderateContentAsync fail-safe:', e && e.message || e);
      return failSafe;
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.contentMod = { moderateContent, moderateContentAsync };
})();
