// validators.js — funções PURAS de validação, sem DOM.
// Padrão de retorno UNIFORME: { ok: boolean, error?: string, value?: any }.
// Mensagens em PT-BR, voltadas pro usuário final.
// Exporta SÓ window.Validators.
(function(){
  'use strict';

  // ── Email ────────────────────────────────────────────────────────────────
  function validateEmail(s){
    if(typeof s !== 'string') return { ok:false, error:'Email inválido' };
    const v = s.trim();
    if(!v) return { ok:false, error:'Informe o email' };
    // Regex pragmática: pelo menos um @ e um . no domínio, sem espaços.
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok:false, error:'Email inválido' };
    return { ok:true };
  }

  // ── Senha ────────────────────────────────────────────────────────────────
  function validatePassword(s, opts){
    const min = (opts && typeof opts.min === 'number' && opts.min > 0) ? opts.min : 8;
    if(typeof s !== 'string') return { ok:false, error:'Senha inválida' };
    if(!s) return { ok:false, error:'Informe a senha' };
    if(s.length < min) return { ok:false, error:'A senha deve ter ao menos '+min+' caracteres' };
    return { ok:true };
  }

  function validatePasswordsMatch(a, b){
    if(typeof a !== 'string' || typeof b !== 'string') return { ok:false, error:'Senhas inválidas' };
    if(a !== b) return { ok:false, error:'As senhas não coincidem' };
    return { ok:true };
  }

  // ── Campo obrigatório genérico ───────────────────────────────────────────
  function validateRequired(s, fieldName){
    const label = fieldName || 'campo';
    if(typeof s !== 'string') return { ok:false, error:'Informe ' + label };
    if(!s.trim()) return { ok:false, error:'Informe ' + label };
    return { ok:true };
  }

  // ── Moeda BR (reusa parseBRL global se existir) ──────────────────────────
  function validateBRL(s){
    if(s == null || s === '') return { ok:false, error:'Informe o valor' };
    const raw = String(s).trim();
    if(!raw) return { ok:false, error:'Informe o valor' };
    let n;
    if(typeof globalThis !== 'undefined' && typeof globalThis.parseBRL === 'function'){
      n = globalThis.parseBRL(raw);
    } else {
      // Fallback: mesma lógica do parseBRL no app.js
      n = Number(raw.replace(/\./g, '').replace(',', '.'));
    }
    if(!Number.isFinite(n)) return { ok:false, error:'Valor inválido' };
    if(n < 0) return { ok:false, error:'O valor não pode ser negativo' };
    return { ok:true, value:n };
  }

  // ── Área em m² (aceita vírgula ou ponto) ─────────────────────────────────
  function validateArea(s){
    if(s == null || s === '') return { ok:false, error:'Informe a área em m²' };
    const raw = String(s).trim().replace(',', '.');
    if(!raw) return { ok:false, error:'Informe a área em m²' };
    const n = Number(raw);
    if(!Number.isFinite(n)) return { ok:false, error:'Área inválida' };
    if(n <= 0) return { ok:false, error:'A área deve ser maior que zero' };
    return { ok:true, value:n };
  }

  // ── Telefone BR ──────────────────────────────────────────────────────────
  // Normaliza pra E.164 sem '+': "5511959765031". Aceita formatos comuns:
  // "(11) 95976-5031", "11 95976-5031", "+5511959765031", "5511959765031".
  // Móvel BR tem 11 dígitos (DDD + 9 + 8 dígitos). Fixo, 10 dígitos.
  function validatePhoneBR(s){
    if(typeof s !== 'string' || !s.trim()) return { ok:false, error:'Informe o telefone' };
    let d = s.replace(/\D+/g, '');
    if(!d) return { ok:false, error:'Telefone inválido' };
    // Se já vier com DDI 55 e o tamanho compatível, mantém. Senão, prefixa 55.
    if(d.length === 12 || d.length === 13){
      if(d.slice(0,2) !== '55') return { ok:false, error:'Telefone inválido' };
    } else if(d.length === 10 || d.length === 11){
      d = '55' + d;
    } else {
      return { ok:false, error:'Telefone inválido' };
    }
    // DDD válido: 11..99 (sem 0 na frente).
    const ddd = d.slice(2, 4);
    if(ddd[0] === '0') return { ok:false, error:'DDD inválido' };
    return { ok:true, value:d };
  }

  // ── CEP (8 dígitos) ──────────────────────────────────────────────────────
  function validateCEP(s){
    if(typeof s !== 'string' || !s.trim()) return { ok:false, error:'Informe o CEP' };
    const d = s.replace(/\D+/g, '');
    if(d.length !== 8) return { ok:false, error:'CEP deve ter 8 dígitos' };
    return { ok:true, value:d };
  }

  // ── CPF (algoritmo completo dos dígitos verificadores) ───────────────────
  // Recebe com ou sem máscara. Calcula DV1 e DV2 via soma ponderada
  // (peso 10→2 e 11→2) e compara com os dois últimos dígitos.
  function validateCPF(s){
    if(typeof s !== 'string' || !s.trim()) return { ok:false, error:'Informe o CPF' };
    const d = s.replace(/\D+/g, '');
    if(d.length !== 11) return { ok:false, error:'CPF deve ter 11 dígitos' };
    // Rejeita sequências repetidas (000..., 111..., etc.) — passam no algoritmo mas são inválidas.
    if(/^(\d)\1{10}$/.test(d)) return { ok:false, error:'CPF inválido' };
    let sum = 0;
    for(let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
    let dv1 = (sum * 10) % 11;
    if(dv1 === 10) dv1 = 0;
    if(dv1 !== parseInt(d[9], 10)) return { ok:false, error:'CPF inválido' };
    sum = 0;
    for(let i = 0; i < 10; i++) sum += parseInt(d[i], 10) * (11 - i);
    let dv2 = (sum * 10) % 11;
    if(dv2 === 10) dv2 = 0;
    if(dv2 !== parseInt(d[10], 10)) return { ok:false, error:'CPF inválido' };
    return { ok:true, value:d };
  }

  // ── CNPJ (algoritmo completo) ────────────────────────────────────────────
  // Pesos do DV1: [5,4,3,2,9,8,7,6,5,4,3,2]; do DV2: [6,5,4,3,2,9,8,7,6,5,4,3,2].
  function validateCNPJ(s){
    if(typeof s !== 'string' || !s.trim()) return { ok:false, error:'Informe o CNPJ' };
    const d = s.replace(/\D+/g, '');
    if(d.length !== 14) return { ok:false, error:'CNPJ deve ter 14 dígitos' };
    if(/^(\d)\1{13}$/.test(d)) return { ok:false, error:'CNPJ inválido' };
    const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for(let i = 0; i < 12; i++) sum += parseInt(d[i], 10) * w1[i];
    let dv1 = sum % 11;
    dv1 = dv1 < 2 ? 0 : 11 - dv1;
    if(dv1 !== parseInt(d[12], 10)) return { ok:false, error:'CNPJ inválido' };
    sum = 0;
    for(let i = 0; i < 13; i++) sum += parseInt(d[i], 10) * w2[i];
    let dv2 = sum % 11;
    dv2 = dv2 < 2 ? 0 : 11 - dv2;
    if(dv2 !== parseInt(d[13], 10)) return { ok:false, error:'CNPJ inválido' };
    return { ok:true, value:d };
  }

  // ── URL (só http/https) ──────────────────────────────────────────────────
  function validateURL(s){
    if(typeof s !== 'string' || !s.trim()) return { ok:false, error:'Informe a URL' };
    const v = s.trim();
    let u;
    try { u = new URL(v); } catch(_){ return { ok:false, error:'URL inválida' }; }
    if(u.protocol !== 'http:' && u.protocol !== 'https:') return { ok:false, error:'A URL deve começar com http:// ou https://' };
    if(!u.hostname) return { ok:false, error:'URL inválida' };
    return { ok:true, value:u.toString() };
  }

  // ── Handle / @username ───────────────────────────────────────────────────
  // a-z, 0-9, underscore. 3-24 chars. Normaliza pra lowercase.
  function validateHandle(s){
    if(typeof s !== 'string' || !s.trim()) return { ok:false, error:'Informe o @' };
    const v = s.trim().toLowerCase();
    if(v.length < 3 || v.length > 24) return { ok:false, error:'O @ deve ter entre 3 e 24 caracteres' };
    if(!/^[a-z0-9_]+$/.test(v)) return { ok:false, error:'Use só letras minúsculas, números e _' };
    return { ok:true, value:v };
  }

  // ── Data BR (dd/mm/aaaa) ou ISO ──────────────────────────────────────────
  // Valida que os campos batem com o Date construído (rejeita 31/02 etc.).
  function validateDateBR(s){
    if(typeof s !== 'string' || !s.trim()) return { ok:false, error:'Informe a data' };
    const v = s.trim();
    const mBR = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
    if(mBR){
      const day = parseInt(mBR[1], 10);
      const mon = parseInt(mBR[2], 10);
      const yr = parseInt(mBR[3], 10);
      const dt = new Date(yr, mon - 1, day);
      if(dt.getFullYear() !== yr || dt.getMonth() !== mon - 1 || dt.getDate() !== day){
        return { ok:false, error:'Data inválida' };
      }
      return { ok:true, value:dt };
    }
    // ISO: 2024-05-31 ou 2024-05-31T... — Date parse confiável aqui.
    if(/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v)){
      const dt = new Date(v);
      if(isNaN(dt.getTime())) return { ok:false, error:'Data inválida' };
      return { ok:true, value:dt };
    }
    return { ok:false, error:'Use o formato dd/mm/aaaa' };
  }

  window.Validators = {
    validateEmail: validateEmail,
    validatePassword: validatePassword,
    validatePasswordsMatch: validatePasswordsMatch,
    validateRequired: validateRequired,
    validateBRL: validateBRL,
    validateArea: validateArea,
    validatePhoneBR: validatePhoneBR,
    validateCEP: validateCEP,
    validateCPF: validateCPF,
    validateCNPJ: validateCNPJ,
    validateURL: validateURL,
    validateHandle: validateHandle,
    validateDateBR: validateDateBR
  };
})();
