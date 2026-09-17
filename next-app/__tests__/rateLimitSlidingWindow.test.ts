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

  it('mantém REVOKE de PUBLIC/anon/authenticated + GRANT só service_role (não afrouxou o achado B do audit anterior)', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_rate_limit\(text, text, integer, integer\) FROM PUBLIC, anon, authenticated;/
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.check_rate_limit\(text, text, integer, integer\) TO service_role;/
    );
  });
});

// Review automático do Codex no PR #326 achou 2 problemas reais na primeira
// versão desta migration (verificados e corrigidos antes do merge — ver
// comentário "REVISÃO" no topo do arquivo SQL). Os dois viraram guarda aqui.
describe('check_rate_limit — fixes do review (P1 corrida, P2 retry_after ingênuo)', () => {
  it('P1: serializa por (user_id, endpoint) com advisory lock ANTES de ler o bucket anterior', () => {
    const body = corpoDaFuncao();
    const idxLock = body.indexOf('pg_advisory_xact_lock');
    const idxRead = body.indexOf("window_start = v_window - (v_window_minutes");
    expect(idxLock).toBeGreaterThan(-1);
    expect(idxRead).toBeGreaterThan(-1);
    // a ordem importa: o lock tem que vir ANTES da leitura que ele protege.
    expect(idxLock).toBeLessThan(idxRead);
  });

  it('P1: pega o lock pelos dois campos da chave (não só um, senão colide entre endpoints diferentes)', () => {
    const body = corpoDaFuncao();
    expect(body).toMatch(/pg_advisory_xact_lock\(hashtext\(p_user_id\), hashtext\(p_endpoint\)\)/);
  });

  it('P2: retry_after_seconds já não é mais só "tempo até o próximo minuto" — resolve o decaimento', () => {
    const body = corpoDaFuncao();
    // A versão ingênua que o Codex apontou (só isso, sem mais nada em volta).
    expect(body).not.toMatch(
      /'retry_after_seconds', GREATEST\(1, v_window_seconds - EXTRACT\(EPOCH FROM \(now\(\) - v_window\)\)::integer\)/
    );
    // A versão corrigida projeta o cruzamento com p_limit.
    expect(body).toMatch(/v_retry_in_window := v_window_seconds/);
    expect(body).toMatch(/1 - \(p_limit - v_count\)::numeric \/ v_prev_count/);
  });

  it('P2: quando o decaimento não basta dentro da janela atual, projeta pro próximo bucket', () => {
    const body = corpoDaFuncao();
    expect(body).toMatch(/CASE WHEN v_count > p_limit/);
  });
});
