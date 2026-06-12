/** Filtros PII shared entre client/server/edge configs do Sentry.
 *  Mascara email, phone BR, CPF, CNPJ, JWT tokens em qualquer string. */

const EMAIL_RE = /\b([a-zA-Z0-9_.+-]{1,3})[a-zA-Z0-9_.+-]*@([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/g;
const PHONE_BR_RE = /\b(\d{2,3})\d{4,5}\d{4}\b/g;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

export function maskPii(s: string): string {
  if (typeof s !== 'string' || !s) return s;
  return s
    .replace(EMAIL_RE, '$1***@$2')
    .replace(PHONE_BR_RE, '***********')
    .replace(CPF_RE, '***.***.***-**')
    .replace(CNPJ_RE, '**.***.***/****-**')
    .replace(JWT_RE, '[JWT_REDACTED]');
}

/** Recursivamente mascara PII em objetos. Limita profundidade. */
export function maskPiiDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (typeof value === 'string') return maskPii(value) as T;
  if (Array.isArray(value)) {
    return value.map((v) => maskPiiDeep(v, depth + 1)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = maskPiiDeep(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** beforeSend Sentry compartilhado. Mascara user.email/data + tags + request body. */
export function sentryBeforeSend<
  E extends {
    user?: { email?: string | null };
    request?: { data?: unknown };
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
  },
>(event: E): E {
  try {
    if (event.user?.email) {
      event.user.email = maskPii(event.user.email);
    }
    if (event.request?.data !== undefined) {
      event.request.data = maskPiiDeep(event.request.data);
    }
    if (event.extra) event.extra = maskPiiDeep(event.extra);
    if (event.contexts) event.contexts = maskPiiDeep(event.contexts);
  } catch {
    // Silent — não bloqueia evento se filtro falhar.
  }
  return event;
}
