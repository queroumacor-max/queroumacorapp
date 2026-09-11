/** Filtros PII shared entre client/server/edge configs do Sentry.
 *  Mascara email, phone BR, CPF, CNPJ, JWT tokens e SEGREDOS (query string,
 *  Authorization, api keys) em qualquer string. */

const EMAIL_RE = /\b([a-zA-Z0-9_.+-]{1,3})[a-zA-Z0-9_.+-]*@([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/g;
const PHONE_BR_RE = /\b(\d{2,3})\d{4,5}\d{4}\b/g;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

// ─── Segredos ────────────────────────────────────────────────────────────────
//
// Por que isso existe (auditoria 2026-09-11): o Sentry anexa ao evento a URL
// da request (`request.url`/`query_string`), os breadcrumbs de `fetch` de
// saída (com a URL completa) e o texto das exceções. Três caminhos por onde
// um segredo chega ao Sentry sem passar por nenhum `console.*`:
//   - webhooks autenticados por `?token=<segredo>` na URL (Meta/Dualhook não
//     assinam o evento; o segredo NA URL é o protocolo);
//   - APIs que aceitam a chave na query (`?key=`), se alguém voltar a usar;
//   - `Authorization: Bearer …` copiado numa mensagem de erro.
// A regra: parâmetro com nome de segredo tem o VALOR trocado, nunca a chave —
// a URL continua legível pra depurar, só não carrega a credencial.

/** Nomes de parâmetro cujo valor é sempre segredo (case-insensitive). */
const SECRET_PARAM_NAMES =
  'token|access_token|refresh_token|id_token|key|api_key|apikey|secret|client_secret|code|signature|sig|password|senha|auth|authorization|session|sessionid|session_id|x-internal-secret';

// Casa em URL (`?token=`, `&key=`), em fragment (`#access_token=`) e em texto
// solto (`token=abc` no começo da linha ou depois de espaço/ponto-e-vírgula).
const SECRET_QUERY_RE = new RegExp(
  `((?:^|[?&#\\s;,])(?:${SECRET_PARAM_NAMES})=)([^&#\\s'"]+)`,
  'gi',
);
const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
// Formatos de chave de provedores conhecidos, mesmo fora de uma URL.
const PROVIDER_KEY_RE =
  /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|APP_USR-[0-9A-Za-z-]{20,}|whsec_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g;
const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

/** Nomes de header que nunca devem sair no evento. */
const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'x-api-key',
  'x-internal-secret',
  'x-hub-signature-256',
  'x-signature',
  'x-goog-api-key',
]);

/**
 * Troca o VALOR de todo segredo reconhecível numa string por `[REDACTED]`:
 * parâmetro de query/fragment com nome sensível, `Bearer <token>`, chave de
 * provedor (`sk-…`, `AIza…`, …) e bloco PEM. Pura; string sem segredo volta
 * igual.
 */
export function redactSecrets(s: string): string {
  if (typeof s !== 'string' || !s) return s;
  return s
    .replace(PEM_RE, '[PRIVATE_KEY_REDACTED]')
    .replace(SECRET_QUERY_RE, '$1[REDACTED]')
    .replace(BEARER_RE, '$1[REDACTED]')
    .replace(PROVIDER_KEY_RE, '[KEY_REDACTED]');
}

/**
 * Versão pra URL: além de `redactSecrets`, DESCARTA o fragment inteiro. O
 * fragment é onde o fluxo web do Supabase entrega `access_token`/
 * `refresh_token` depois do OAuth, e o nome do parâmetro ali não é nosso pra
 * escolher — remover tudo é o único jeito seguro.
 */
export function scrubUrl(url: string): string {
  if (typeof url !== 'string' || !url) return url;
  const semFragment = url.replace(/#.*$/s, '');
  return redactSecrets(semFragment);
}

export function maskPii(s: string): string {
  if (typeof s !== 'string' || !s) return s;
  return redactSecrets(s)
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

/** Remove headers sensíveis e mascara o resto. */
function scrubHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (SECRET_HEADERS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = typeof v === 'string' ? maskPii(v) : v;
    }
  }
  return out;
}

interface SentryLikeRequest {
  url?: string;
  query_string?: unknown;
  headers?: unknown;
  cookies?: unknown;
  data?: unknown;
}

interface SentryLikeBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
}

interface SentryLikeException {
  values?: Array<{ value?: string }>;
}

/**
 * beforeSend Sentry compartilhado. Mascara user.email, request (url, query,
 * headers, cookies, body), extra, contexts, breadcrumbs, mensagem e texto das
 * exceções. Nunca lança: falha do filtro não pode custar o evento.
 */
export function sentryBeforeSend<
  E extends {
    user?: { email?: string | null };
    request?: SentryLikeRequest;
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
    breadcrumbs?: SentryLikeBreadcrumb[];
    message?: string;
    exception?: SentryLikeException;
  },
>(event: E): E {
  try {
    if (event.user?.email) {
      event.user.email = maskPii(event.user.email);
    }
    if (event.request) {
      const req = event.request;
      if (typeof req.url === 'string') req.url = scrubUrl(req.url);
      if (typeof req.query_string === 'string') {
        req.query_string = redactSecrets(`?${req.query_string}`).slice(1);
      } else if (req.query_string !== undefined) {
        req.query_string = maskPiiDeep(req.query_string);
      }
      if (req.headers !== undefined) req.headers = scrubHeaders(req.headers);
      // Cookie de sessão do admin (`sb-session-token`) mora aqui.
      if (req.cookies !== undefined) req.cookies = '[REDACTED]';
      if (req.data !== undefined) req.data = maskPiiDeep(req.data);
    }
    if (event.extra) event.extra = maskPiiDeep(event.extra);
    if (event.contexts) event.contexts = maskPiiDeep(event.contexts);
    if (typeof event.message === 'string') event.message = maskPii(event.message);
    if (event.exception?.values) {
      for (const v of event.exception.values) {
        if (typeof v.value === 'string') v.value = maskPii(v.value);
      }
    }
    if (Array.isArray(event.breadcrumbs)) {
      for (const b of event.breadcrumbs) {
        if (typeof b.message === 'string') b.message = maskPii(b.message);
        if (b.data && typeof b.data === 'object') {
          if (typeof b.data.url === 'string') b.data.url = scrubUrl(b.data.url);
          b.data = maskPiiDeep(b.data);
        }
      }
    }
  } catch {
    // Silent — não bloqueia evento se filtro falhar.
  }
  return event;
}
