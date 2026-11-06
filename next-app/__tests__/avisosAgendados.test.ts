// Avisos agendados (horário de Brasília) + push geral (2026-11-06).
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jaNoAr } from '@/lib/services/announcements';

type A = { active?: boolean; publish_at?: string | null; id?: string };
let h: {
  brasiliaParaISO: (d: string, t: string) => string | null;
  isoParaBrasilia: (iso: string) => { dia: string; hora: string };
  quandoBrasilia: (iso: string) => string;
  faltaQuanto: (iso: string, agora: number) => string;
  separarAvisos: (l: A[], agora: number) => { agendados: A[]; publicados: A[] };
  amanhaNoveBrasilia: (agora: number) => { dia: string; hora: string };
};

const portal = () => readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');

beforeAll(() => {
  const src = portal();
  const ini = src.indexOf('// [teste:aviso-agenda-inicio]');
  const fim = src.indexOf('// [teste:aviso-agenda-fim]');
  expect(ini).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(ini);
  const trecho = src.slice(ini, fim);
  expect(trecho).not.toMatch(/<[A-Za-z]/);
  h = new Function(`${trecho}; return { brasiliaParaISO, isoParaBrasilia, quandoBrasilia, faltaQuanto, separarAvisos, amanhaNoveBrasilia };`)();
});

describe('horário de Brasília', () => {
  it('converte dia + hora de Brasília para UTC (UTC-3)', () => {
    expect(h.brasiliaParaISO('2026-11-07', '09:00')).toBe('2026-11-07T12:00:00.000Z');
    expect(h.brasiliaParaISO('2026-11-07', '22:30')).toBe('2026-11-08T01:30:00.000Z');
  });
  it('recusa dia ou hora vazios/errados', () => {
    expect(h.brasiliaParaISO('', '09:00')).toBeNull();
    expect(h.brasiliaParaISO('2026-11-07', '9h')).toBeNull();
  });
  it('volta de UTC para o que a loja digitou', () => {
    expect(h.isoParaBrasilia('2026-11-08T01:30:00.000Z')).toEqual({ dia: '2026-11-07', hora: '22:30' });
    expect(h.quandoBrasilia('2026-11-07T12:00:00.000Z')).toMatch(/07\/11\/2026 às 09:00$/);
  });
  it('amanhã 09:00 de Brasília, mesmo de madrugada em UTC', () => {
    // 06/11 23:30 Brasília = 07/11 02:30 UTC → amanhã em Brasília é 07/11
    expect(h.amanhaNoveBrasilia(Date.parse('2026-11-07T02:30:00Z'))).toEqual({ dia: '2026-11-07', hora: '09:00' });
  });
});

describe('separarAvisos', () => {
  const agora = Date.parse('2026-11-06T18:00:00Z');
  it('agendado = ativo com publish_at no futuro, em ordem de saída', () => {
    const r = h.separarAvisos([
      { id: 'b', active: true, publish_at: '2026-11-09T12:00:00Z' },
      { id: 'a', active: true, publish_at: '2026-11-07T12:00:00Z' },
      { id: 'c', active: true, publish_at: null },
      { id: 'd', active: true, publish_at: '2026-11-05T12:00:00Z' },
      { id: 'e', active: false, publish_at: '2026-11-08T12:00:00Z' },
    ], agora);
    expect(r.agendados.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.publicados.map((x) => x.id)).toEqual(['c', 'd', 'e']);
  });
  it('falta quanto', () => {
    expect(h.faltaQuanto('2026-11-06T18:20:00Z', agora)).toBe('em 20 min');
    expect(h.faltaQuanto('2026-11-06T23:00:00Z', agora)).toBe('em 5 h');
    expect(h.faltaQuanto('2026-11-09T18:00:00Z', agora)).toBe('em 3 dias');
  });
});

describe('portal grava publish_at e created_at juntos', () => {
  it('na criação e ao mudar o horário', () => {
    const src = portal();
    expect(src).toContain('linha.publish_at = quando; linha.created_at = quando;');
    expect(src).toContain("update(id, { publish_at: iso, created_at: iso })");
  });
});

describe('app: jaNoAr', () => {
  const agora = Date.parse('2026-11-06T18:00:00Z');
  it('esconde o agendado até a hora (admin passa pela RLS)', () => {
    expect(jaNoAr({ publish_at: '2026-11-07T12:00:00Z' }, agora)).toBe(false);
    expect(jaNoAr({ publish_at: '2026-11-06T17:59:00Z' }, agora)).toBe(true);
    expect(jaNoAr({ publish_at: null }, agora)).toBe(true);
    expect(jaNoAr({}, agora)).toBe(true);
  });
});

describe('SQL do agendamento + push', () => {
  const sql = () => readFileSync(join(process.cwd(), '../migrations/2026-11-06-announcements-schedule-push.sql'), 'utf8');
  it('a RLS pública esconde o agendado e os avisos antigos não disparam push', () => {
    const s = sql();
    expect(s).toContain('USING (active = true AND (publish_at IS NULL OR publish_at <= now()))');
    expect(s).toMatch(/UPDATE public\.announcements SET push_done = true/);
    expect(s).toContain("cron.schedule('announcements-push'");
    expect(s).toContain('REVOKE ALL ON FUNCTION public.run_announcement_push() FROM PUBLIC, anon, authenticated;');
  });
});
