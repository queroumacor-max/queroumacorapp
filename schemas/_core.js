// @ts-check
// schemas/_core.js — helpers internos compartilhados pelos schemas.
// Expõe window.Schemas._core = { ok, err, wrap }. Não é pra ser usado direto
// pelos call sites — quem importa é primitives/documents/social. Carregar
// SEMPRE antes dos outros 3 no index.html.

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: { code: string, message: string } }} ParseResult
 */

/**
 * @typedef {{
 *   parse: (v: any, extra?: any) => ParseResult<any>,
 *   optional?: () => Schema,
 *   refine?: (fn: (v: any) => boolean, msg?: string) => Schema
 * }} Schema
 */

(function(){
  'use strict';
  /**
   * @param {string} code
   * @param {string} message
   * @returns {ParseResult<never>}
   */
  function err(code, message){ return { ok:false, error:{ code, message } }; }
  /**
   * @template T
   * @param {T} value
   * @returns {ParseResult<T>}
   */
  function ok(value){ return { ok:true, value }; }

  // wrap(base) anexa .optional() e .refine(fn,msg) chainable ao schema base.
  // Cada chamada devolve um NOVO schema também wrapped — encadear é seguro.
  /**
   * @param {Schema} base
   * @returns {Schema}
   */
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
