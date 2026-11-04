// PRO grátis 30 dias pra profissional NOVO (2026-11-04, decisão do usuário:
// "1 profissionais / 2 novas / 3 se apagar e criar outra não").
// Testado ponta a ponta em Postgres 16 local; aqui trava as regras no fonte.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(__dirname, '../../migrations/2026-11-04-pro-trial-profissionais.sql'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const termos = readFileSync(join(__dirname, '../app/info/termos/page.tsx'), 'utf8');
const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.grant_pro_trial'), sql.indexOf('REVOKE ALL ON FUNCTION public.grant_pro_trial'));

describe('PRO grátis 30 dias', () => {
  it('só profissional', () => {
    expect(fn).toMatch(/NOT IN \('pintor', 'grafiteiro', 'automotivo', 'arquiteto'\)/);
    expect(fn).not.toMatch(/'cliente'/);
  });
  it('só conta nova (criada depois do SQL)', () => {
    expect(fn).toMatch(/u\.created_at < c\.desde THEN RETURN NEW/);
    expect(sql).toMatch(/desde timestamptz NOT NULL DEFAULT now\(\)/);
  });
  it('uma vez por e-mail, mesmo apagando a conta', () => {
    expect(fn).toMatch(/'email:' \|\| lower\(trim\(u\.email\)\)/);
    expect(fn).toMatch(/ON CONFLICT \(email_hash\) DO NOTHING RETURNING user_id INTO v_ok; IF v_ok IS NULL THEN RETURN NEW/);
    const tabela = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.pro_trial_grants'));
    expect(tabela.split(';')[0]).not.toMatch(/REFERENCES/);
  });
  it('não mexe em quem já é PRO e nunca derruba o cadastro', () => {
    expect(fn).toMatch(/NEW\.is_pro = true AND \(NEW\.pro_expires_at IS NULL OR NEW\.pro_expires_at > now\(\)\) THEN RETURN NEW/);
    expect(fn).toMatch(/EXCEPTION WHEN OTHERS THEN RAISE WARNING 'grant_pro_trial/);
  });
  it('ninguém chama a função de fora e o gatilho só olha categoria', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.grant_pro_trial\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/AFTER INSERT OR UPDATE OF role, user_type ON public\.profiles/);
  });
  it('os Termos dizem a regra', () => {
    expect(termos).toMatch(/30 dias de Plano PRO grátis/);
    expect(termos).toMatch(/uma única vez por e-mail/);
  });
});
