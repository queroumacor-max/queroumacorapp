// schemas/index.js — meta-aggregator. Os arquivos _core/primitives/documents/social
// já populam window.Schemas via IIFE; este arquivo só finaliza o objeto
// (helper parse + lista de nomes) por conveniência. Carregar SEMPRE depois dos outros.
(function(){
  'use strict';
  const S = window.Schemas = window.Schemas || {};

  // Helper opcional: Schemas.parse('email', 'a@b.co') === Schemas.email.parse('a@b.co').
  if(typeof S.parse !== 'function'){
    S.parse = function(name, value, extra){
      const schema = S[name];
      if(!schema || typeof schema.parse !== 'function'){
        return { ok:false, error:{ code:'unknown_schema', message:'Schema "' + name + '" não existe' } };
      }
      return schema.parse(value, extra);
    };
  }

  // Lista de schemas conhecidos (só pra introspecção/testes).
  // Exclui helpers internos (_core, parse, _names).
  S._names = Object.keys(S).filter(k => k !== 'parse' && k !== '_names' && k[0] !== '_');
})();
