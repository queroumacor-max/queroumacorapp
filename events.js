// events.js — barramento pub/sub in-memory, in-process, expondo window.Events.
// Padrão IIFE, sem dependências externas. Substitui a necessidade de uma fila
// real (Cloudflare Queues / BullMQ / SQS) enquanto não houver job background no
// produto. Itens #38 (filas) + #39 (eventos assíncronos) do audit arquitetural.
//
// Convenção de nomes: "entity.action" (ex.: post.liked, chat.message_received,
// auth.logged_out, feed.refreshed, notif.created).
//
// Limitações conscientes (ver EVENTS.md):
//  - in-memory (perde no refresh / em outra aba)
//  - sem persistência / retry / dead-letter
//  - emit() não devolve resultado dos handlers (fire-and-forget pra async)
// Pra side-effects críticos (cobrança, e-mail), use call direto ou wire numa
// fila persistente trocando este adapter.
/** @typedef {(payload?: any) => any} EventHandler */
(function(){
  'use strict';

  // event_name -> Set<handler>. Set garante de-dup e remoção O(1).
  /** @type {Map<string, Set<EventHandler>>} */
  const handlers = new Map();

  /**
   * @param {string} name
   * @returns {Set<EventHandler>}
   */
  function _getSet(name){
    let s = handlers.get(name);
    if(!s){ s = new Set(); handlers.set(name, s); }
    return s;
  }

  // Registra um handler. Devolve uma função "unsubscribe" — chame pra remover
  // sem precisar guardar a referência original.
  /**
   * @param {string} name
   * @param {EventHandler} handler
   * @returns {() => void}
   */
  function on(name, handler){
    if(typeof name !== 'string' || !name){ return function(){}; }
    if(typeof handler !== 'function'){ return function(){}; }
    _getSet(name).add(handler);
    return function unsubscribe(){ off(name, handler); };
  }

  // Remove um handler específico. No-op se não estiver registrado.
  /**
   * @param {string} name
   * @param {EventHandler} handler
   * @returns {void}
   */
  function off(name, handler){
    const s = handlers.get(name);
    if(!s) return;
    s.delete(handler);
    if(s.size === 0){ handlers.delete(name); }
  }

  // Dispara o evento. Itera os handlers em ordem de registro (Set preserva
  // insertion order). Cada handler roda dentro de try/catch — se um throwa
  // (sync) ou rejeita (async), o resto da chain segue. Handlers async são
  // fire-and-forget: agendados via Promise.resolve().then(...) pra não bloquear
  // o publisher. Não há await; emit() devolve void.
  /**
   * @param {string} name
   * @param {any} [payload]
   * @returns {void}
   */
  function emit(name, payload){
    const s = handlers.get(name);
    if(!s || s.size === 0) return;
    // Snapshot dos handlers ANTES de iterar: se um handler chamar off() ou on()
    // pro mesmo evento durante o emit, não queremos mutar o iterador em uso.
    const snapshot = Array.from(s);
    for(let i = 0; i < snapshot.length; i++){
      const h = snapshot[i];
      try {
        const ret = h(payload);
        // Se devolveu Promise (handler async), agenda o catch sem bloquear o
        // resto. .catch é encadeado direto na promise devolvida.
        if(ret && typeof ret.then === 'function'){
          ret.then(undefined, function(err){
            try { console.warn('[events]', name, err); } catch(_){}
          });
        }
      } catch(err){
        // Handler sync que throwou: log + continua o loop (não interrompe).
        try { console.warn('[events]', name, err); } catch(_){}
      }
    }
  }

  // Açúcar pra registrar handler de uso único. Remove a si mesmo no primeiro
  // disparo, ANTES de executar a callback original (evita re-entry infinito se
  // a callback emitir o mesmo evento).
  /**
   * @param {string} name
   * @param {EventHandler} handler
   * @returns {() => void}
   */
  function once(name, handler){
    if(typeof handler !== 'function') return function(){};
    /** @type {EventHandler} */
    function wrapper(payload){
      off(name, wrapper);
      return handler(payload);
    }
    return on(name, wrapper);
  }

  // Introspect (debug + tests). Subscript com `_` pra sinalizar "não-API
  // pública estável" — call sites de produção não devem depender.
  /** @returns {string[]} */
  function _list(){ return Array.from(handlers.keys()); }
  /** @param {string} name @returns {number} */
  function _count(name){
    const s = handlers.get(name);
    return s ? s.size : 0;
  }
  /** @returns {void} */
  function _clear(){ handlers.clear(); } // reset entre testes

  window.Events = { on: on, off: off, emit: emit, once: once,
    _list: _list, _count: _count, _clear: _clear };
})();
