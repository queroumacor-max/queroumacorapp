// lib/api/securityEvents.ts — logging estruturado de eventos de SEGURANÇA
// (não confundir com `lib/logger.ts`, que é log de produto/UI, nem com
// `lib/api/audit.ts`, que grava ações administrativas em `audit_log`).
//
// Auditoria de observabilidade de segurança (2026-09-17): rate-limit hits,
// falhas de auth, upload rejeitado, quota de IA excedida, assinatura de
// webhook inválida — nenhum desses tinha UMA linha de log em lugar nenhum
// antes desta auditoria (confirmado lendo `security.ts`/webhooks inteiros).
// Um atacante martelando esses caminhos hoje não deixa rastro algum.
//
// Este helper resolve a PARTE que cabe em código: log estruturado (JSON de
// uma linha, não string livre), convenção de nome de evento
// (`dominio.assunto.verbo`), redaction de secret/PII antes de qualquer
// `console.*`, e proteção contra log injection (CRLF/control chars). NÃO
// cria um vendor novo, NÃO manda nada pra fora além do que já sai por
// `console.*` (capturado pelos logs da plataforma — Cloudflare Pages
// Functions/Workers) e, só pra severidade `critical`, reaproveita o Sentry
// JÁ integrado no projeto (mesmo padrão de `lib/api/errors.ts` e
// `lib/api/_services/brand-logos.ts` — não é um alerta novo, é a mesma
// captureMessage que essas duas rotas já fazem hoje; sem alerting
// configurado no Sentry, isso só cria uma Issue, nunca dispara e-mail/SMS).
//
// REGRA: nunca lança. Falha de logging não pode derrubar/alterar a request
// (mesmo racional de `lib/api/audit.ts` fail-open).

const SECRET_KEY_RE =
  /(authoriz|cookie|token|secret|senha|password|api[-_]?key|apikey|service[-_]?role|otp|refresh|assinatura|signature|webhook[-_]?secret)/i;

const CONTROL_CHARS_RE = /[\r\n\t\x00-\x1f\x7f]/g;

// Mesmas regras de máscara já validadas em `lib/sentry-helpers.ts`
// (email, telefone BR, CPF, CNPJ, JWT) — reaproveitadas aqui pra não ter
// duas definições de "o que é PII" divergindo no mesmo repo.
const EMAIL_RE = /\b([a-zA-Z0-9_.+-]{1,3})[a-zA-Z0-9_.+-]*@([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/g;
const PHONE_BR_RE = /\b(\d{2,3})\d{4,5}\d{4}\b/g;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+/gi;

/** Remove CR/LF/tab/control chars — impede que um valor controlado pelo
 * atacante forje uma linha de log falsa (log injection) ou quebre um
 * terminal (escape sequence) quando o log é visualizado. */
function stripControlChars(s: string): string {
  return s.replace(CONTROL_CHARS_RE, ' ');
}

/** Mascara PII conhecida (email/telefone/CPF/CNPJ/JWT/Bearer) numa string.
 * Não é allowlist — é defesa em profundidade: o CHAMADOR ainda deve evitar
 * passar campo inteiro de PII/secret; isto pega o que passar batido. */
export function maskSensitiveString(s: string): string {
  if (typeof s !== 'string' || !s) return s;
  return stripControlChars(s)
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(JWT_RE, '[JWT_REDACTED]')
    .replace(EMAIL_RE, '$1***@$2')
    .replace(PHONE_BR_RE, '***********')
    .replace(CPF_RE, '***.***.***-**')
    .replace(CNPJ_RE, '**.***.***/****-**');
}

/** Redação recursiva: chave que bate no padrão de secret vira
 * `'[REDACTED]'` INTEIRA (nunca parcial — Authorization/Cookie/token não
 * têm "meio seguro pra mostrar"); qualquer outra string passa por
 * `maskSensitiveString`. Limita profundidade/tamanho pra nunca travar em
 * objeto gigante/circular vindo de um caller descuidado. */
export function redactFields(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 6) return '[depth_limit]';
  if (value == null) return value;
  if (typeof value === 'string') return maskSensitiveString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactFields(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (++count > 50) {
        out._truncated = true;
        break;
      }
      out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : redactFields(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export type SecuritySeverity = 'info' | 'warning' | 'high' | 'critical';

/**
 * Convenção de nome de evento: `dominio.assunto.verbo`
 * (ex.: `auth.login.failed`, `security.rate_limit.hit`,
 * `security.webhook.invalid_signature`, `security.ai.quota_exceeded`).
 * Não é um enum fechado (novos eventos nascem em código, não aqui) — a
 * convenção é o contrato, não uma lista estática que desatualiza.
 */
export interface SecurityEventFields {
  [key: string]: unknown;
  /** Correlaciona com `x-request-id` (ver middleware.ts) quando disponível. */
  requestId?: string | null;
  /** IP de borda — já é dado tratado como não-secreto no resto do repo
   * (audit_log.ip_address grava igual). Nunca confiar em header arbitrário:
   * usar `getClientIp()`/`pickIp()`, nunca um header custom do cliente. */
  ip?: string | null;
  route?: string | null;
}

function requestIdFrom(headers?: Headers | null): string | null {
  if (!headers) return null;
  try {
    return headers.get('x-request-id') || null;
  } catch {
    return null;
  }
}

/**
 * Loga um evento de segurança em JSON estruturado de uma linha só —
 * grep-ável, parse-ável por qualquer log aggregator, sem string livre.
 *
 * NUNCA lança. `severity: 'critical'` também manda `Sentry.captureMessage`
 * (import dinâmico, mesmo padrão fail-safe de `lib/services/feed.ts` —
 * nunca THROW se o Sentry SDK não carregou em edge/test). Uso comedido de
 * propósito: SÓ pra classe genuinamente crítica (escalada de privilégio,
 * falha de config de segurança em produção) — o resto fica em log
 * estruturado simples, pra não inflar custo/volume do Sentry num flood
 * (ex.: rate-limit hit em massa nunca deve virar Issue no Sentry).
 */
export function logSecurityEvent(
  event: string,
  fields: SecurityEventFields = {},
  opts: { severity?: SecuritySeverity; request?: Request | { headers: Headers } | null } = {},
): void {
  try {
    const severity = opts.severity ?? 'info';
    const requestId = fields.requestId ?? requestIdFrom(opts.request?.headers ?? null);
    const record = {
      event: stripControlChars(String(event)).slice(0, 120),
      severity,
      ts: new Date().toISOString(),
      request_id: requestId,
      ...(redactFields(fields) as Record<string, unknown>),
    };
    const line = JSON.stringify(record);
    // eslint-disable-next-line no-console
    if (severity === 'critical' || severity === 'high') console.error('[security]', line);
    // eslint-disable-next-line no-console
    else console.warn('[security]', line);

    if (severity === 'critical') {
      // Fire-and-forget, nunca bloqueia — mesma blindagem de feed.ts
      // (`addFeedBreadcrumb`) e errors.ts (`errorResponse`).
      import('@sentry/nextjs')
        .then((Sentry) => {
          Sentry.captureMessage(`security:${event}`, {
            level: 'warning',
            tags: { security_event: event },
            extra: record,
          });
        })
        .catch(() => {
          /* Sentry indisponível (edge/test/DSN ausente) — silent. */
        });
    }
  } catch {
    // Logging de segurança NUNCA pode derrubar a request que o disparou.
  }
}
