// lib/drAuditTrail.ts — DR audit 2026-09-17 (achados CRITICAL-1/HIGH-1):
// espelho EXTERNO ao Postgres de exclusão de conta e bloqueio de hash CSAM.
//
// Por quê: um restore PITR do Supabase rola `audit_log`/`deletion_
// tombstones`/`media_hash_blocklist` pra trás JUNTO com o resto do banco —
// nenhum registro que more só no Postgres sobrevive a "voltar o relógio do
// banco inteiro". Sentry é um sistema separado (outro provedor, timeline
// própria) já integrado neste projeto (ver `sentry.client.config.ts`,
// `sentry.server.config.ts`, `lib/api/errors.ts`) — capturar aqui dá à
// reconciliação pós-restore uma segunda fonte, independente do snapshot
// restaurado: "quais contas foram excluídas / quais hashes foram
// bloqueados entre T0 (o backup) e o disaster?" (ver `docs/DR_RUNBOOK.md`
// §Restore de 24h atrás).
//
// NUNCA carrega conteúdo de mídia nem PII além do que já é operacional
// (user id, hash, categoria, timestamp) — o hash de um arquivo bloqueado
// NÃO é o arquivo; replicar hash de blocklist pra um segundo sistema de
// auditoria é a prática padrão de blocklists CSAM (mesmo princípio das
// listas de hash do NCMEC). `sentryBeforeSend` (lib/sentry-helpers.ts)
// ainda mascara qualquer PII residual em `extra` antes de sair daqui.
//
// Fail-safe: NUNCA lança. Falha do Sentry (DSN ausente, init não rodou no
// edge, rede fora) não pode derrubar a ação que está sendo auditada — a
// mesma regra de `lib/api/errors.ts`/`lib/api/audit.ts`.
//
// Limite honesto: isto é um SINAL pra reconciliação manual, não uma
// blindagem automática. Depois de um restore, o operador precisa
// CONSULTAR o Sentry (buscar por `dr_audit:account_deletion` ou
// `dr_audit:media_hash_blocked` no período entre o backup e o disaster) e
// reaplicar manualmente — não há (ainda) um job que faça essa comparação
// sozinho.

import * as Sentry from '@sentry/nextjs';

export type DrAuditAction = 'account_deletion' | 'media_hash_blocked';

export function captureDrAuditEvent(
  action: DrAuditAction,
  data: Record<string, string | boolean | null | undefined>,
): void {
  try {
    Sentry.captureMessage(`dr_audit:${action}`, {
      level: 'info',
      tags: { dr_audit: action },
      extra: data,
    });
  } catch {
    /* fail-safe — nunca bloqueia a ação auditada, mesma regra do audit.ts */
  }
}
