// scrubSecrets.ts — tira credenciais de strings que vão pra log/telemetria.
//
// Por que existe (auditoria de autenticação, 2026-09-11): o Supabase entrega
// a sessão do OAuth web e do link de recuperação de senha no FRAGMENT da URL
// (`/update-password#access_token=…&refresh_token=…`). O browser não manda o
// fragment pro servidor, mas `location.href` em JavaScript inclui ele — e
// era exatamente isso que o `reportFailure` (→ `/api/log-error` → tabela
// `errors` → tela /admin/errors) e o Sentry (`request.url`) gravavam. Um
// erro qualquer nessa página deixava o refresh token da pessoa num log
// legível por qualquer admin. Mesma coisa pro `?code=` do PKCE e pro
// `token_hash` dos links de e-mail.
//
// Puro e sem dependência: roda no browser, no edge e no Node dos testes.

/** Parâmetros de query/fragment que carregam credencial. */
const PARAMS_SECRETOS = new Set([
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'id_token',
  'token',
  'token_hash',
  'code',
  'apikey',
]);

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const PARAM_RE = new RegExp(
  `([?#&;\\s]|^)(${[...PARAMS_SECRETOS].join('|')})=([^&#\\s]*)`,
  'gi',
);

function limparParams(qs: string): string {
  const params = new URLSearchParams(qs);
  let mexeu = false;
  for (const k of [...params.keys()]) {
    if (PARAMS_SECRETOS.has(k.toLowerCase())) {
      params.set(k, '[redacted]');
      mexeu = true;
    }
  }
  return mexeu ? params.toString() : qs;
}

/**
 * Devolve a URL sem credenciais: fragment inteiro descartado (é onde o
 * Supabase põe os tokens) e parâmetros sensíveis da query mascarados.
 * Nunca lança — URL malformada volta só com a regex de segurança aplicada.
 */
export function scrubUrl(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const hashIdx = raw.indexOf('#');
    const semHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const sufixo = hashIdx >= 0 ? '#[redacted]' : '';
    const qIdx = semHash.indexOf('?');
    if (qIdx < 0) return semHash + sufixo;
    const base = semHash.slice(0, qIdx);
    const qs = limparParams(semHash.slice(qIdx + 1));
    return `${base}?${qs}${sufixo}`;
  } catch {
    return redactTokens(raw);
  }
}

/**
 * Mascara JWTs e pares `token=…` soltos dentro de um texto livre (mensagem
 * de erro, stack, contexto). Não mexe em e-mail/telefone — isso é PII de
 * outra natureza e tem filtro próprio no Sentry.
 */
export function redactTokens(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(JWT_RE, '[JWT_REDACTED]')
    .replace(PARAM_RE, (_m, sep: string, k: string) => `${sep}${k}=[redacted]`);
}
