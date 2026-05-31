// schemas/primitives.js — Zod-shaped schemas for primitive inputs.
// parse(value) → { ok:true, value } | { ok:false, error:{ code, message } }. PT-BR. IIFE → window.Schemas.
// Cada schema expõe .optional() e .refine(fn,msg) chainable (vanilla, sem Zod).
(function(){
  'use strict';
  function err(c, m){ return { ok:false, error:{ code:c, message:m } }; }
  function ok(value){ return { ok:true, value }; }

  // Helpers reaproveitáveis pra montar variantes encadeáveis (optional/refine).
  function wrap(base){
    base.optional = function(){
      return wrap({ parse(v, extra){ return (v == null || v === '') ? ok(undefined) : base.parse(v, extra); } });
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

  const email = wrap({ parse(v){
    if(typeof v !== 'string') return err('invalid_type', 'Email inválido');
    const s = v.trim();
    if(!s) return err('required', 'Informe o email');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return err('invalid_format', 'Email inválido');
    return ok(s);
  }});

  const password = wrap({ parse(v, opts){
    const min = (opts && typeof opts.min === 'number' && opts.min > 0) ? opts.min : 8;
    if(typeof v !== 'string') return err('invalid_type', 'Senha inválida');
    if(!v) return err('required', 'Informe a senha');
    if(v.length < min) return err('too_short', 'A senha deve ter ao menos ' + min + ' caracteres');
    return ok(v);
  }});

  const passwordsMatch = wrap({ parse(pair){
    const a = pair && pair.a, b = pair && pair.b;
    if(typeof a !== 'string' || typeof b !== 'string') return err('invalid_type', 'Senhas inválidas');
    if(a !== b) return err('mismatch', 'As senhas não coincidem');
    return ok(a);
  }});

  const required = wrap({ parse(v, fieldName){
    const label = fieldName || 'campo';
    if(typeof v !== 'string' || !v.trim()) return err('required', 'Informe ' + label);
    return ok(v);
  }});

  const brl = wrap({ parse(v){
    if(v == null || v === '') return err('required', 'Informe o valor');
    const raw = String(v).trim();
    if(!raw) return err('required', 'Informe o valor');
    const parseFn = (typeof globalThis !== 'undefined' && typeof globalThis.parseBRL === 'function')
      ? globalThis.parseBRL : (s) => Number(s.replace(/\./g, '').replace(',', '.'));
    const n = parseFn(raw);
    if(!Number.isFinite(n)) return err('invalid_format', 'Valor inválido');
    if(n < 0) return err('out_of_range', 'O valor não pode ser negativo');
    return ok(n);
  }});

  const area = wrap({ parse(v){
    if(v == null || v === '') return err('required', 'Informe a área em m²');
    const raw = String(v).trim().replace(',', '.');
    if(!raw) return err('required', 'Informe a área em m²');
    const n = Number(raw);
    if(!Number.isFinite(n)) return err('invalid_format', 'Área inválida');
    if(n <= 0) return err('out_of_range', 'A área deve ser maior que zero');
    return ok(n);
  }});

  const phone = wrap({ parse(v){
    if(typeof v !== 'string' || !v.trim()) return err('required', 'Informe o telefone');
    let d = v.replace(/\D+/g, '');
    if(!d) return err('invalid_format', 'Telefone inválido');
    if(d.length === 12 || d.length === 13){
      if(d.slice(0,2) !== '55') return err('invalid_format', 'Telefone inválido');
    } else if(d.length === 10 || d.length === 11){ d = '55' + d; }
    else { return err('invalid_format', 'Telefone inválido'); }
    if(d.slice(2, 4)[0] === '0') return err('invalid_format', 'DDD inválido');
    return ok(d);
  }});

  const cep = wrap({ parse(v){
    if(typeof v !== 'string' || !v.trim()) return err('required', 'Informe o CEP');
    const d = v.replace(/\D+/g, '');
    if(d.length !== 8) return err('invalid_format', 'CEP deve ter 8 dígitos');
    return ok(d);
  }});

  window.Schemas = window.Schemas || {};
  Object.assign(window.Schemas, { email, password, passwordsMatch, required, brl, area, phone, cep });
})();
