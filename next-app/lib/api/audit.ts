// lib/api/audit.ts — middleware fininho pra gravar ações críticas em
// `public.audit_log`. Convive com `audit_events` (trigger-driven granular);
// este é o catálogo manual de ações administrativas (admin views, role
// changes, refunds, deletions, exports LGPD).
//
// Schema (migrations/2026-05-31-consent-audit-invites-cleanup.sql):
//   id bigserial, actor_id uuid, action text, target_table text,
//   target_id text, changes jsonb, ip_address text, user_agent text,
//   created_at timestamptz default now()
//
// Decisões:
//   - FAIL-OPEN: audit log nunca quebra request. Erro vira `console.warn`
//     pra Sentry/log forwarding capturar, mas o controller segue.
//   - Service role: insert direto via REST API com `SUPABASE_SERVICE_ROLE`
//     (RLS bloqueia insert anônimo; audit log não tem policy de INSERT
//     porque queremos forçar passar por esse helper, que valida shape).
//   - `cf-connecting-ip` no Cloudflare Pages, `x-forwarded-for` como
//     fallback (host genérico). User-Agent normal do header.
//   - `changes` é JSONB livre — caller decide o shape (antes/depois,
//     diff, valores brutos). Cap 64KB pra evitar abuso (defensive).

import { getServiceKey, getSupabaseUrl } from './security';

const TIMEOUT_MS = 5000;
const MAX_CHANGES_BYTES = 64 * 1024;

export interface AuditEventOpts {
  /** UUID do actor (usuário que fez a ação). `null` quando anônimo/sistema. */
  actorId?: string | null;
  /** Verbo curto da ação. Ex: 'admin.user.set_pro', 'me.export', 'mp.subscription_paid'. */
  action: string;
  /** Tabela alvo (se a ação tocou em uma row específica). */
  targetTable?: string | null;
  /** PK da row alvo (UUID/text), se aplicável. */
  targetId?: string | null;
  /** Diff/payload da ação. Cap em 64KB serializado. */
  changes?: Record<string, unknown> | null;
  /** Request original — usado pra extrair IP/UA. Opcional pra calls server-only. */
  request?: Request | { headers: Headers } | null;
}

function pickIp(headers: Headers): string | null {
  // Prioridade: cf-connecting-ip (CF Pages canonical) → x-real-ip → x-forwarded-for
  // (primeira entrada).
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? null;
  return null;
}

function pickUserAgent(headers: Headers): string | null {
  const ua = headers.get('user-agent');
  if (!ua) return null;
  // Cap defensivo: UA pathológico não vai estourar nossa coluna text mas
  // não há razão pra armazenar mais que 500 chars.
  return ua.slice(0, 500);
}

function truncateChanges(changes: Record<string, unknown> | null | undefined): unknown {
  if (!changes) return null;
  try {
    const serialized = JSON.stringify(changes);
    if (serialized.length <= MAX_CHANGES_BYTES) return changes;
    // Overflow: substitui por marker + tamanho original (perde fidelidade
    // mas log nunca é fonte de verdade — só rastreio).
    return {
      _truncated: true,
      _original_bytes: serialized.length,
      _preview: serialized.slice(0, 1024),
    };
  } catch {
    return { _serialization_failed: true };
  }
}

/**
 * Grava um evento de auditoria. NUNCA throws — falha vira `console.warn`.
 *
 * Chamada típica:
 *   await logAuditEvent({
 *     actorId: callerId,
 *     action: 'admin.user.set_pro',
 *     targetTable: 'profiles',
 *     targetId: userId,
 *     changes: { is_pro: { from: false, to: true } },
 *     request,
 *   });
 */
export async function logAuditEvent(opts: AuditEventOpts): Promise<void> {
  try {
    if (!opts.action) {
      console.warn('audit: action vazia, skip');
      return;
    }
    const serviceKey = getServiceKey();
    if (!serviceKey) {
      console.warn('audit: SUPABASE_SERVICE_ROLE ausente, skip');
      return;
    }

    let supaUrl: string;
    try {
      supaUrl = getSupabaseUrl();
    } catch {
      console.warn('audit: SUPABASE_URL ausente, skip');
      return;
    }

    const headers = opts.request?.headers;
    const ip = headers ? pickIp(headers) : null;
    const ua = headers ? pickUserAgent(headers) : null;

    const payload = {
      actor_id: opts.actorId ?? null,
      action: opts.action,
      target_table: opts.targetTable ?? null,
      target_id: opts.targetId ?? null,
      changes: truncateChanges(opts.changes),
      ip_address: ip,
      user_agent: ua,
    };

    const r = await fetch(`${supaUrl}/rest/v1/audit_log`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!r.ok) {
      const txt = (await r.text().catch(() => '')).slice(0, 200);
      console.warn('audit: insert falhou', r.status, txt);
    }
  } catch (e) {
    // FAIL-OPEN absoluto — qualquer exception aqui vira warn, nunca propaga.
    console.warn('audit: exception', e instanceof Error ? e.message : e);
  }
}
