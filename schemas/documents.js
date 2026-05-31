// @ts-check
// schemas/documents.js — Zod-shaped schemas for BR fiscal documents (CPF, CNPJ).
// Algoritmos completos de DV. parse(value) → { ok, value? (dígitos limpos), error? }.
// .optional() e .refine(fn,msg) chainable via wrap() compartilhado em _core.js.
(function(){
  'use strict';
  /** @type {{ ok: any, err: any, wrap: any }} */
  const { ok, err, wrap } = window.Schemas._core;

  const cpf = wrap({ parse(v){
    if(typeof v !== 'string' || !v.trim()) return err('required', 'Informe o CPF');
    const d = v.replace(/\D+/g, '');
    if(d.length !== 11) return err('invalid_format', 'CPF deve ter 11 dígitos');
    if(/^(\d)\1{10}$/.test(d)) return err('invalid_checksum', 'CPF inválido');
    let sum = 0;
    for(let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
    let dv1 = (sum * 10) % 11;
    if(dv1 === 10) dv1 = 0;
    if(dv1 !== parseInt(d[9], 10)) return err('invalid_checksum', 'CPF inválido');
    sum = 0;
    for(let i = 0; i < 10; i++) sum += parseInt(d[i], 10) * (11 - i);
    let dv2 = (sum * 10) % 11;
    if(dv2 === 10) dv2 = 0;
    if(dv2 !== parseInt(d[10], 10)) return err('invalid_checksum', 'CPF inválido');
    return ok(d);
  }});

  const cnpj = wrap({ parse(v){
    if(typeof v !== 'string' || !v.trim()) return err('required', 'Informe o CNPJ');
    const d = v.replace(/\D+/g, '');
    if(d.length !== 14) return err('invalid_format', 'CNPJ deve ter 14 dígitos');
    if(/^(\d)\1{13}$/.test(d)) return err('invalid_checksum', 'CNPJ inválido');
    const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for(let i = 0; i < 12; i++) sum += parseInt(d[i], 10) * w1[i];
    let dv1 = sum % 11;
    dv1 = dv1 < 2 ? 0 : 11 - dv1;
    if(dv1 !== parseInt(d[12], 10)) return err('invalid_checksum', 'CNPJ inválido');
    sum = 0;
    for(let i = 0; i < 13; i++) sum += parseInt(d[i], 10) * w2[i];
    let dv2 = sum % 11;
    dv2 = dv2 < 2 ? 0 : 11 - dv2;
    if(dv2 !== parseInt(d[13], 10)) return err('invalid_checksum', 'CNPJ inválido');
    return ok(d);
  }});

  Object.assign(window.Schemas, { cpf, cnpj });
})();
