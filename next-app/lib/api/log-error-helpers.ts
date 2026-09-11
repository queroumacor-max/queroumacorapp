// lib/api/log-error-helpers.ts — sanitização do payload do /api/log-error.
// Extraído de app/api/log-error/route.ts porque Next.js 15 não aceita
// exports de helpers no nível do módulo em arquivos de rota (só HTTP
// method handlers + config). Mantemos a função pura e testável aqui.

import { redactSecrets, scrubUrl } from '@/lib/sentry-helpers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LogErrorBody {
  type?: unknown;
  msg?: unknown;
  stack?: unknown;
  url?: unknown;
  ua?: unknown;
  metric?: unknown;
  value?: unknown;
  ctx?: unknown;
  user_id?: unknown;
  // aliases que o front também manda (alguns endpoints novos usam camelCase)
  message?: unknown;
  userAgent?: unknown;
  context?: unknown;
}

export interface SafeErrorPayload {
  type: string | null;
  msg: string | null;
  stack: string | null;
  url: string | null;
  ua: string | null;
  metric: string | null;
  value: number | null;
  ctx: string | null;
  ts: number;
  user_id: string | null;
}

function trunc(v: unknown, n: number): string | null {
  if (typeof v !== 'string') return null;
  return v.slice(0, n);
}

// O payload vem do NAVEGADOR e é gravado em `errors` + `console.log` do edge.
// Auditoria 2026-09-11: `url` era `location.href` cru — depois do OAuth web
// a página pousa com `#access_token=…&refresh_token=…`, e uma falha nesse
// instante gravaria a sessão da pessoa numa tabela de log. Mensagem e stack
// também podem carregar `Bearer …` ou `?key=…` copiados de um erro de fetch.
// Regra: segredo reconhecível NUNCA entra no log — o valor vira [REDACTED].
function truncRedacted(v: unknown, n: number): string | null {
  const t = trunc(v, n);
  return t === null ? null : redactSecrets(t);
}

export function sanitizeErrorPayload(body: LogErrorBody): SafeErrorPayload {
  const uidRaw = typeof body.user_id === 'string' ? body.user_id : '';
  // Aceita tanto `msg` (vanilla) quanto `message` (clientes novos).
  const msg = (typeof body.msg === 'string' ? body.msg : null) ??
              (typeof body.message === 'string' ? body.message : null);
  const ua = (typeof body.ua === 'string' ? body.ua : null) ??
             (typeof body.userAgent === 'string' ? body.userAgent : null);
  const ctx = (typeof body.ctx === 'string' ? body.ctx : null) ??
              (typeof body.context === 'string' ? body.context : null);
  return {
    type: trunc(body.type, 32),
    msg: truncRedacted(msg, 500),
    stack: truncRedacted(body.stack, 1500),
    url: typeof body.url === 'string' ? scrubUrl(body.url).slice(0, 300) : null,
    ua: trunc(ua, 200),
    metric: trunc(body.metric, 32),
    value: typeof body.value === 'number' ? body.value : null,
    ctx: truncRedacted(ctx, 100),
    ts: Date.now(),
    user_id: UUID_RE.test(uidRaw) ? uidRaw : null,
  };
}
