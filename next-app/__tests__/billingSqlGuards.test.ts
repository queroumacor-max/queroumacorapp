// Travas estáticas dos SQLs de compras in-app (2026-10-25).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (f: string) => readFileSync(join(__dirname, '../../migrations', f), 'utf8');
const TRIAL = ler('2026-10-25-billing-pro-and-ai-trial.sql');
const FIX = ler('2026-10-25-fix-protect-triggers-invoker.sql');
const SALDO = ler('2026-10-25-billing-balance.sql');

describe('teste grátis das IAs (SQL)', () => {
  it('só service_role reserva', () => {
    expect(TRIAL).toMatch(/REVOKE ALL ON FUNCTION public\.claim_ai_trial\(uuid, text, int, boolean\) FROM PUBLIC, anon, authenticated/);
    expect(TRIAL).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_ai_trial\(uuid, text, int, boolean\) TO service_role/);
  });
  it('reserva atômica: só soma enquanto abaixo do teto', () => {
    expect(TRIAL).toContain('WHERE public.ai_trial_usage.used < p_limit');
  });
});

describe('assinatura liga o PRO (SQL)', () => {
  it('vive no arquivo 1, pra a ordem de rodar não importar', () => {
    expect(SALDO).toMatch(/set_pro_subscription[\s\S]*is_pro = true/);
    expect(TRIAL).not.toContain('set_pro_subscription');
  });
  it('PRO manual sem data nunca é tocado', () => {
    expect(SALDO).toContain('WHEN is_pro = true AND pro_expires_at IS NULL THEN NULL');
  });
});

describe('travas de perfil/pedido (correção 2026-10-25)', () => {
  it('protect_profile_columns é SECURITY INVOKER (current_user só vale assim)', () => {
    expect(FIX).toMatch(/FUNCTION public\.protect_profile_columns\(\)\s*RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER/);
    expect(FIX).toContain('ALTER FUNCTION public.protect_order_columns() SECURITY INVOKER;');
  });
  it('o registro do bloqueio não grava direto em audit_events (o usuário não pode)', () => {
    const corpo = FIX.slice(FIX.indexOf('FUNCTION public.protect_profile_columns()'));
    expect(corpo).not.toContain('INSERT INTO public.audit_events');
    expect(corpo).toContain('public._audit_privilege_blocked(');
  });
  it('a função de registro não aceita o ator por parâmetro', () => {
    expect(FIX).toMatch(/_audit_privilege_blocked\(p_target uuid, p_table text, p_meta jsonb\)/);
    expect(FIX).toContain("VALUES ('security.privilege_escalation_blocked', auth.uid()");
  });
});
