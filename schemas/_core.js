// schemas/_core.js — helpers internos compartilhados pelos schemas.
// Expõe window.Schemas._core = { ok, err, wrap }. Não é pra ser usado direto
// pelos call sites — quem importa é primitives/documents/social. Carregar
// SEMPRE antes dos outros 3 no index.html.
(function(){
  'use strict';
  function err(code, message){ return { ok:false, error:{ code, message } }; }
  function ok(value){ return { ok:true, value }; }

  // wrap(base) anexa .optional() e .refine(fn,msg) chainable ao schema base.
  // Cada chamada devolve um NOVO schema também wrapped — encadear é seguro.
  function wrap(base){
    base.optional = function(){
      return wrap({ parse(v, extra){
        return (v == null || v === '') ? ok(undefined) : base.parse(v, extra);
      }});
    };
    base.refine = function(fn, msg){
      return wrap({ parse(v, extra){
        const r = base.parse(v, extra);
        if(!r.ok) return r;
        return fn(r.value) ? r : err('refine_failed', msg || 'Valor inválido');
      }});
    };
    return base;
  }

  window.Schemas = window.Schemas || {};
  window.Schemas._core = { ok, err, wrap };
})();
