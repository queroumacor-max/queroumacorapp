// Guarda de CONTEÚDO da migration 2026-09-17-rate-limit-sliding-window.sql.
//
// Mesma filosofia de businessLogicSecurityAudit.test.ts: a lógica de
// verdade vive em SQL (a função PL/pgSQL roda no Postgres, não dá pra
// exercitar num teste de unidade normal). Este teste lê o arquivo e trava
// os invariantes que não podem regredir silenciosamente numa edição futura
// — não substitui rodar a migration de verdade contra um banco.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(
  new URL('../../migrations/2026-09-17-rate-limit-sliding-window.sql', import.meta.url),
  'utf8'
);

function corpoDaFuncao() {
  const start = SQL.indexOf('CREATE OR REPLACE FUNCTION public.check_rate_limit(');
  const end = SQL.indexOf('$$;', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('check_rate_limit — sliding window (não mais fixed window puro)', () => {
  it('mantém a assinatura (text, text, integer, integer) — sem quebrar caller nenhum', () => {
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.check_rate_limit\(\s*p_user_id text, p_endpoint text, p_limit integer DEFAULT 30, p_window_minutes integer DEFAULT 1\s*\)/
    );
  });

  it('lê o bucket ANTERIOR (não só o atual) — é isso que fecha o "dobrar na virada do minuto"', () => {
    const body = corpoDaFuncao();
    expect(body).toMatch(/window_start = v_window - \(v_window_minutes \|\| ' minutes'\)::interval/);
  });

  it('pondera o bucket anterior pela fração ainda não decorrida do atual (decaimento, não corte seco)', () => {
    const body = corpoDaFuncao();
    expect(body).toMatch(/v_elapsed_fraction/);
    expect(body).toMatch(/v_estimated := v_count \+ COALESCE\(v_prev_count, 0\) \* \(1 - v_elapsed_fraction\)/);
  });

  it('a decisão "allowed" usa a contagem ESTIMADA da janela, não só o bucket cru', () => {
    const body = corpoDaFuncao();
    expect(body).toMatch(/'allowed', v_estimated <= p_limit/);
  });

  it('retry_after_seconds respeita p_window_minutes (não fica preso a 60s fixo)', () => {
    const body = corpoDaFuncao();
    expect(body).toMatch(/v_window_seconds - EXTRACT\(EPOCH FROM \(now\(\) - v_window\)\)::integer/);
  });

  it('mantém REVOKE de PUBLIC/anon/authenticated + GRANT só service_role (não afrouxou o achado B do audit anterior)', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_rate_limit\(text, text, integer, integer\) FROM PUBLIC, anon, authenticated;/
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.check_rate_limit\(text, text, integer, integer\) TO service_role;/
    );
  });
});
