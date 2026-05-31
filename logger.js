// logger.js — wrapper fino sobre console.* pra padronizar logs no app.
// Quando usar cada nível:
//   debug → ruído de desenvolvimento (só aparece em preview/staging/local).
//   info  → eventos esperados (login ok, fetch concluído).
//   warn  → algo estranho mas recuperável (fallback acionado, cache miss).
//   error → falha real do usuário ou da feature; vai pro /admin/errors.
//   exception → captura de Error em try/catch (preserva stack).
// Exporta só window.Logger. Nada de ES modules.
(function(){
  'use strict';

  // Níveis ordenados por verbosidade. Comparar índices pra filtrar.
  const LEVELS = ['debug', 'info', 'warn', 'error'];

  // Detecta ambiente pelo hostname. Produção é queroumacor.com.br (com ou
  // sem www). Qualquer outro host (pages.dev, localhost, IP, etc.) entra
  // como 'debug' pra facilitar troubleshooting em preview/staging/local.
  function _detectLevel(){
    try {
      const h = (location && location.hostname || '').toLowerCase();
      if(h === 'queroumacor.com.br' || h === 'www.queroumacor.com.br') return 'info';
      return 'debug';
    } catch(e){ return 'info'; }
  }

  // Trunca pra não poluir DevTools. Limites fixos: msg=500, ctx=200.
  function _truncate(v, max){
    if(v == null) return v;
    const s = String(v);
    if(s.length <= max) return s;
    return s.slice(0, max) + '…';
  }

  // ctx pode chegar como string OU objeto. Stringifica objeto com try/catch
  // pra blindar contra referências circulares.
  function _normCtx(ctx){
    if(ctx == null) return '';
    if(typeof ctx === 'string') return _truncate(ctx, 200);
    try { return _truncate(JSON.stringify(ctx), 200); }
    catch(e){ return _truncate(String(ctx), 200); }
  }

  function _shouldLog(method){
    const cur = LEVELS.indexOf(window.Logger && window.Logger.level || 'info');
    const tgt = LEVELS.indexOf(method);
    if(cur < 0 || tgt < 0) return true;
    return tgt >= cur;
  }

  function _safeReport(payload){
    // reportError vive em head.js. Carregamento é defer + ordem garantida,
    // mas guarda mesmo assim — preview pode carregar logger antes em testes.
    if(typeof reportError !== 'function') return;
    try { reportError(payload); } catch(e){ /* silencia: log não pode quebrar app */ }
  }

  function debug(msg, ctx){
    if(!_shouldLog('debug')) return;
    console.debug('[debug]', _truncate(msg, 500), _normCtx(ctx));
  }

  function info(msg, ctx){
    if(!_shouldLog('info')) return;
    console.info('[info]', _truncate(msg, 500), _normCtx(ctx));
  }

  function warn(msg, ctx){
    if(!_shouldLog('warn')) return;
    console.warn('[warn]', _truncate(msg, 500), _normCtx(ctx));
  }

  function error(msg, errOrCtx){
    if(_shouldLog('error')){
      console.error('[error]', _truncate(msg, 500), errOrCtx);
    }
    _safeReport({
      type: 'logger-error',
      msg: _truncate(msg, 500),
      ctx: _normCtx(errOrCtx)
    });
  }

  // exception() é a variante pra Error objects: extrai message+stack pra
  // que o dashboard /admin/errors agrupe por stack trace, não por string.
  function exception(err, ctx){
    const m = (err && err.message) ? err.message : String(err || 'unknown');
    const s = (err && err.stack) ? err.stack : '';
    if(_shouldLog('error')){
      console.error('[exception]', _truncate(m, 500), err, _normCtx(ctx));
    }
    _safeReport({
      type: 'exception',
      msg: _truncate(m, 500),
      stack: s,
      ctx: _normCtx(ctx)
    });
  }

  function setLevel(lvl){
    if(LEVELS.indexOf(lvl) < 0) return;
    window.Logger.level = lvl;
  }

  window.Logger = {
    level: _detectLevel(),
    debug: debug,
    info: info,
    warn: warn,
    error: error,
    exception: exception,
    setLevel: setLevel
  };
})();
