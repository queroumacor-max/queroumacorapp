// logger.ts — port de /logger.js para TS.
// Wrapper fino sobre console.* pra padronizar logs. Substitui o `window.Logger`
// vanilla — funciona tanto em RSC/route handlers (server) quanto no client
// (componentes 'use client'). Sem dep em window: detecção de ambiente
// usa NODE_ENV no servidor e hostname só quando `window` existe.
//
// Quando usar cada nível:
//   debug → ruído de desenvolvimento (só aparece em dev/preview/staging).
//   info  → eventos esperados (login ok, fetch concluído).
//   warn  → algo estranho mas recuperável (fallback acionado, cache miss).
//   error → falha real do usuário ou da feature.
//   exception → captura de Error em try/catch (preserva stack).

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'] as const;

// Detecta ambiente: produção (queroumacor.com.br) = info; resto = debug.
// No server, baseia em NODE_ENV — production sobe pra info, dev fica em debug.
function detectLevel(): LogLevel {
  try {
    if (typeof window !== 'undefined') {
      const h = (window.location?.hostname || '').toLowerCase();
      if (h === 'queroumacor.com.br' || h === 'www.queroumacor.com.br') return 'info';
      return 'debug';
    }
    return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
  } catch {
    return 'info';
  }
}

let currentLevel: LogLevel = detectLevel();

// Trunca pra não poluir DevTools. Limites fixos: msg=500, ctx=200.
function truncate(v: unknown, max: number): string {
  if (v == null) return '';
  const s = String(v);
  return s.length <= max ? s : s.slice(0, max) + '…';
}

// ctx pode chegar como string OU objeto. Stringifica objeto com try/catch
// pra blindar contra referências circulares.
function normCtx(ctx: unknown): string {
  if (ctx == null) return '';
  if (typeof ctx === 'string') return truncate(ctx, 200);
  try {
    return truncate(JSON.stringify(ctx), 200);
  } catch {
    return truncate(String(ctx), 200);
  }
}

function shouldLog(method: LogLevel): boolean {
  const cur = LEVELS.indexOf(currentLevel);
  const tgt = LEVELS.indexOf(method);
  if (cur < 0 || tgt < 0) return true;
  return tgt >= cur;
}

export interface Logger {
  level: LogLevel;
  debug(msg: string, ctx?: unknown): void;
  info(msg: string, ctx?: unknown): void;
  warn(msg: string, ctx?: unknown): void;
  error(msg: string, errOrCtx?: unknown): void;
  exception(err: unknown, ctx?: unknown): void;
  setLevel(lvl: LogLevel): void;
}

export const logger: Logger = {
  get level(): LogLevel {
    return currentLevel;
  },
  set level(lvl: LogLevel) {
    if (LEVELS.indexOf(lvl) >= 0) currentLevel = lvl;
  },
  debug(msg, ctx) {
    if (!shouldLog('debug')) return;
    // eslint-disable-next-line no-console
    console.debug('[debug]', truncate(msg, 500), normCtx(ctx));
  },
  info(msg, ctx) {
    if (!shouldLog('info')) return;
    // eslint-disable-next-line no-console
    console.info('[info]', truncate(msg, 500), normCtx(ctx));
  },
  warn(msg, ctx) {
    if (!shouldLog('warn')) return;
    // eslint-disable-next-line no-console
    console.warn('[warn]', truncate(msg, 500), normCtx(ctx));
  },
  error(msg, errOrCtx) {
    if (!shouldLog('error')) return;
    // eslint-disable-next-line no-console
    console.error('[error]', truncate(msg, 500), errOrCtx);
  },
  // exception() é a variante pra Error objects: extrai message+stack pra
  // que dashboards (Sentry, /admin/errors) agrupem por stack, não por string.
  exception(err, ctx) {
    const e = err as { message?: string; stack?: string } | null;
    const m = e?.message ? e.message : String(err ?? 'unknown');
    if (!shouldLog('error')) return;
    // eslint-disable-next-line no-console
    console.error('[exception]', truncate(m, 500), err, normCtx(ctx));
  },
  setLevel(lvl) {
    if (LEVELS.indexOf(lvl) >= 0) currentLevel = lvl;
  },
};
