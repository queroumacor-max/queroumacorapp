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

/** Remove query string de uma URL antes de mandar pro Sentry — query pode
 * carregar token/secret (ex.: `?token=` do webhook do WhatsApp,
 * `WHATSAPP_WEBHOOK_URL_SECRET`, que não é JWT-shaped e por isso não bate
 * em `JWT_RE`/`maskPii`). Mantém origin+path (útil pra agrupar por rota),
 * descarta tudo depois de `?`/`#`. */
function stripQueryAndFragment(url: string): string {
  if (typeof url !== 'string' || !url) return url;
  try {
    const idx = url.search(/[?#]/);
    return idx === -1 ? url : url.slice(0, idx);
  } catch {
    return url;
  }
}

const SECRET_HEADER_RE = /^(authorization|cookie|set-cookie|x-.*-secret|x-.*-token)$/i;

/** Mascara headers antes de mandar pro Sentry — Authorization/Cookie nunca
 * saem, o resto passa por `maskPiiDeep` (defesa em profundidade pra
 * qualquer header custom com PII). */
function maskHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object') return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    out[k] = SECRET_HEADER_RE.test(k) ? '[REDACTED]' : maskPiiDeep(v);
  }
  return out;
}

/** beforeSend Sentry compartilhado. Mascara user.email/data + tags +
 * request body + a mensagem da própria exceção + breadcrumbs (message
 * E data) + request.url/headers/query_string.
 *
 * Duas auditorias em paralelo fecharam gaps complementares na mesma
 * função, reconciliados aqui em 2026-09-19: a de release-gate
 * (2026-09-18) achou que `exception.values[].value`/`message` nunca
 * eram mascarados (a mensagem do Error lançado, ou uma violação de
 * constraint do Postgres ecoando um valor, ia pro Sentry sem máscara);
 * a de observabilidade de segurança (2026-09-17) achou que os
 * breadcrumbs automáticos de fetch/XHR/navegação (ligados por
 * `browserTracingIntegration`) capturam URL completa com query string
 * fora de `user.email`/`request.data`/`extra`/`contexts`, e que
 * `request.headers`/`query_string` também vazavam sem filtro. */
export function sentryBeforeSend<
  E extends {
    user?: { email?: string | null };
    request?: { data?: unknown; url?: string; headers?: unknown; query_string?: unknown };
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    message?: string;
    exception?: { values?: Array<{ value?: string | null }> };
    breadcrumbs?: Array<{ data?: unknown; message?: string | null }>;
    tags?: Record<string, unknown>;
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
      event.request.url = stripQueryAndFragment(event.request.url);
    }
    // Sentry já separa query string em `query_string` quando parseia a URL
    // — remove por completo em vez de mascarar (não sabemos os nomes dos
    // parâmetros de toda rota, e query string não é dado útil pro debug).
    if (event.request?.query_string !== undefined) {
      event.request.query_string = '[REMOVED]';
    }
    if (event.request?.headers) {
      event.request.headers = maskHeaders(event.request.headers);
    }
    if (event.extra) event.extra = maskPiiDeep(event.extra);
    if (event.contexts) event.contexts = maskPiiDeep(event.contexts);
    if (typeof event.message === 'string') {
      event.message = maskPii(event.message);
    }
    if (event.exception?.values) {
      for (const v of event.exception.values) {
        if (typeof v.value === 'string') v.value = maskPii(v.value);
      }
    }
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((b) => {
        if (!b || typeof b !== 'object') return b;
        const next = { ...b } as typeof b;
        if (next.data !== undefined) next.data = maskPiiDeep(next.data) as typeof next.data;
        if (typeof next.message === 'string') next.message = maskPii(next.message);
        return next;
      });
    }
  } catch {
    // Silent — não bloqueia evento se filtro falhar.
  }
  return event;
}
