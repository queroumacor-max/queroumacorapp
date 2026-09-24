// Guarda de CONTEÚDO da migration
// 2026-09-17-security-observability-audit-trail.sql (auditoria de security
// logging/monitoring/audit trails).
//
// Mesma filosofia de businessLogicSecurityAudit.test.ts: a lógica de
// verdade vive em SQL (triggers), não em TypeScript exercitável num teste
// de unidade normal. Este teste lê o arquivo e trava os dois invariantes
// que motivaram a migration:
//   1. `protect_profile_columns` continua bloqueando exatamente as mesmas
//      colunas de antes (nenhuma regra de negócio muda) E agora grava a
//      TENTATIVA bloqueada em audit_events antes de revertê-la.
//   2. `audit_profile_changes` passa a cobrir `role` (old->new), igual já
//      cobre is_pro/portal_access.
// Não substitui rodar a migration de verdade (responsabilidade do
// usuário) — garante que o TEXTO continua dizendo o que promete.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(
  new URL(
    '../../migrations/2026-09-17-security-observability-audit-trail.sql',
    import.meta.url,
  ),
  'utf8',
);

function extractFunction(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  expect(start).toBeGreaterThanOrEqual(0);
  // Cada função termina em `END $$;` — pega o primeiro depois do início.
  const end = SQL.indexOf('END $$;', start);
  expect(end).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('protect_profile_columns — audita a tentativa bloqueada, sem mudar a regra de bloqueio', () => {
  const fnBody = extractFunction('protect_profile_columns');

  it('é SECURITY DEFINER com search_path fixo (mesma trava de hijacking já validada no projeto)', () => {
    const header = SQL.slice(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_profile_columns()'),
      SQL.indexOf('$$', SQL.indexOf('CREATE OR REPLACE FUNCTION public.protect_profile_columns()')),
    );
    expect(header).toMatch(/SECURITY DEFINER/);
    expect(header).toMatch(/SET search_path = public/);
  });

  it('continua revertendo TODAS as 6 colunas privilegiadas no UPDATE (nenhuma regra de negócio muda)', () => {
    for (const col of ['is_pro', 'portal_access', 'role', 'verified', 'pro_expires_at', 'pro_grace_until']) {
      expect(fnBody).toMatch(new RegExp(`OLD\\.${col}\\s+IS DISTINCT FROM NEW\\.${col}`));
    }
  });

  it('só audita/reverte quando NÃO confiável (v_trusted) — admin/service_role continuam livres', () => {
    expect(fnBody).toMatch(/v_trusted := public\.is_portal_admin\(\) OR current_user NOT IN \('anon', 'authenticated'\)/);
    expect(fnBody).toMatch(/IF NOT v_trusted THEN/);
  });

  it('grava em audit_events com event_type=security.privilege_escalation_blocked (INSERT e UPDATE)', () => {
    const occurrences = fnBody.split('security.privilege_escalation_blocked').length - 1;
    expect(occurrences).toBe(2); // um pro ramo INSERT, um pro ramo UPDATE
  });

  it('no ramo INSERT: audita ANTES de zerar os campos (senão gravaria o valor já revertido)', () => {
    const insertBranchStart = fnBody.indexOf("TG_OP = 'INSERT'");
    const insertBranchEnd = fnBody.indexOf("TG_OP = 'UPDATE'");
    const branch = fnBody.slice(insertBranchStart, insertBranchEnd);
    const auditIdx = branch.indexOf('security.privilege_escalation_blocked');
    const revertIdx = branch.indexOf('NEW.is_pro := false');
    expect(auditIdx).toBeGreaterThan(0);
    expect(revertIdx).toBeGreaterThan(auditIdx);
  });

  it('no ramo UPDATE: captura old+attempted ANTES de reverter a coluna (sem perder o valor tentado)', () => {
    // A linha que grava 'attempted', NEW.is_pro em v_attempted vem antes da
    // linha seguinte que sobrescreve NEW.is_pro := OLD.is_pro — se fosse ao
    // contrário, o valor tentado já teria sido perdido antes de ser lido.
    const captureIdx = fnBody.indexOf("'attempted', NEW.is_pro)");
    const revertIdx = fnBody.indexOf('NEW.is_pro := OLD.is_pro');
    expect(captureIdx).toBeGreaterThan(0);
    expect(revertIdx).toBeGreaterThan(captureIdx);
    // As duas linhas são vizinhas (nada entre a captura e o revert daquela
    // coluna) — confirma que não é coincidência de outra parte da função.
    expect(fnBody.slice(captureIdx, revertIdx).length).toBeLessThan(60);
  });

  it('não grava linha quando nada foi tentado (v_attempted vazio)', () => {
    expect(fnBody).toMatch(/IF v_attempted <> '\{\}'::jsonb THEN/);
  });

  it('captura old + attempted (não só o novo valor) — é o que diferencia de um log raso', () => {
    expect(fnBody).toMatch(/jsonb_build_object\('is_pro', jsonb_build_object\('old', OLD\.is_pro, 'attempted', NEW\.is_pro\)\)/);
  });
});

describe('audit_profile_changes — role ganha trilha old->new (gap fechado)', () => {
  const fnBody = extractFunction('audit_profile_changes');

  it('continua auditando is_pro/pro_expires_at e portal_access (comportamento preexistente preservado)', () => {
    expect(fnBody).toMatch(/'pro_change'/);
    expect(fnBody).toMatch(/'portal_access_change'/);
  });

  it('NOVO: audita role com old_role/new_role', () => {
    expect(fnBody).toMatch(/NEW\.role IS DISTINCT FROM OLD\.role/);
    expect(fnBody).toMatch(/'security\.role_change'/);
    expect(fnBody).toMatch(/'old_role', OLD\.role, 'new_role', NEW\.role/);
  });
});

describe('cron — os 3 cleanups que só existiam como função ganham agendamento', () => {
  it('agenda cleanup_old_audit_events, cleanup_old_notifications e cleanup_rate_limits', () => {
    expect(SQL).toMatch(/cron\.schedule\(\s*'cleanup-old-audit-events'/);
    expect(SQL).toMatch(/cleanup_old_audit_events\(\)/);
    expect(SQL).toMatch(/cron\.schedule\(\s*'cleanup-old-notifications'/);
    expect(SQL).toMatch(/cleanup_old_notifications\(\)/);
    expect(SQL).toMatch(/cron\.schedule\(\s*'cleanup-rate-limits'/);
    expect(SQL).toMatch(/cleanup_rate_limits\(\)/);
  });
});

describe('conferência final — idempotente e re-executável', () => {
  it('o arquivo termina com uma query de verificação (read-only)', () => {
    const tail = SQL.slice(SQL.indexOf('-- Conferência'));
    expect(tail).toMatch(/tentativa_bloqueada_e_auditada/);
    expect(tail).toMatch(/role_change_auditado/);
    expect(tail).toMatch(/crons_agendados_esperado_3/);
  });
});
