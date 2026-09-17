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

/** beforeSend Sentry compartilhado. Mascara user.email/data + tags + request body.
 *
 * Privacidade 2026-09-17: a máscara cobria `user.email`/`request.data`/
 * `extra`/`contexts` mas deixava passar CRU o `message` do evento, o
 * `exception.value` (a mensagem de erro em si — pode ecoar um valor de
 * linha/coluna vindo de um erro do Postgres, ex. "duplicate key value
 * violates ... (phone)=(11999998888)"), `request.url` (querystring pode
 * carregar telefone/email em algum endpoint legado) e `breadcrumbs`
 * (mensagens e dados de passos anteriores, mesmo formato de `extra`). */
export function sentryBeforeSend<
  E extends {
    message?: string;
    user?: { email?: string | null };
    request?: { data?: unknown; url?: string };
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    exception?: { values?: Array<{ value?: string | null }> };
    breadcrumbs?: Array<{ message?: string | null; data?: unknown }>;
  },
>(event: E): E {
  try {
    if (event.user?.email) {
      event.user.email = maskPii(event.user.email);
    }
    if (event.request?.data !== undefined) {
      event.request.data = maskPiiDeep(event.request.data);
    }
    if (event.request?.url) {
      event.request.url = maskPii(event.request.url);
    }
    if (event.extra) event.extra = maskPiiDeep(event.extra);
    if (event.contexts) event.contexts = maskPiiDeep(event.contexts);
    if (typeof event.message === 'string') {
      event.message = maskPii(event.message);
    }
    if (Array.isArray(event.exception?.values)) {
      for (const v of event.exception.values) {
        if (typeof v.value === 'string') v.value = maskPii(v.value);
      }
    }
    if (Array.isArray(event.breadcrumbs)) {
      for (const b of event.breadcrumbs) {
        if (typeof b.message === 'string') b.message = maskPii(b.message);
        if (b.data !== undefined) b.data = maskPiiDeep(b.data);
      }
    }
  } catch {
    // Silent — não bloqueia evento se filtro falhar.
  }
  return event;
}
