import { describe, expect, it } from 'vitest';
import { chaveAvisoPro, fimDoPro, proAcabandoEm, quandoAcaba } from '@/lib/proAviso';
import type { PolicyUser } from '@/lib/policies';

const H = 60 * 60 * 1000;
const agora = Date.parse('2026-10-20T15:00:00Z'); // 12:00 em Brasília
const iso = (t: number) => new Date(t).toISOString();
const u = (o: Partial<PolicyUser> & Record<string, unknown>): PolicyUser =>
  ({ id: 'u1', is_pro: true, role: 'pintor', ...o }) as PolicyUser;

describe('proAcabandoEm', () => {
  it('avisa quando faltam menos de 24h', () => {
    const fim = agora + 5 * H;
    expect(proAcabandoEm(u({ pro_expires_at: iso(fim) }), agora)).toBe(fim);
  });
  it('não avisa com mais de 24h, nem depois de vencido', () => {
    expect(proAcabandoEm(u({ pro_expires_at: iso(agora + 25 * H) }), agora)).toBeNull();
    expect(proAcabandoEm(u({ pro_expires_at: iso(agora - H) }), agora)).toBeNull();
  });
  it('carência estende o fim (mesma conta do canSeeProFeature)', () => {
    const user = u({ pro_expires_at: iso(agora + 2 * H), pro_grace_until: iso(agora + 72 * H) });
    expect(fimDoPro(user)).toBe(agora + 72 * H);
    expect(proAcabandoEm(user, agora)).toBeNull();
  });
  it('não avisa sem PRO, sem data, nem pra admin', () => {
    expect(proAcabandoEm(u({ is_pro: false, pro_expires_at: iso(agora + H) }), agora)).toBeNull();
    expect(proAcabandoEm(u({}), agora)).toBeNull();
    expect(proAcabandoEm(u({ role: 'admin', pro_expires_at: iso(agora + H) }), agora)).toBeNull();
    expect(proAcabandoEm(null, agora)).toBeNull();
  });
  it('a marca de visto muda quando o prazo muda (renovação avisa de novo)', () => {
    expect(chaveAvisoPro(1)).not.toBe(chaveAvisoPro(2));
  });
});

describe('quandoAcaba', () => {
  it('diz hoje/amanhã no fuso de Brasília', () => {
    expect(quandoAcaba(Date.parse('2026-10-20T21:30:00Z'), agora)).toBe('hoje às 18:30');
    expect(quandoAcaba(Date.parse('2026-10-21T12:00:00Z'), agora)).toBe('amanhã às 09:00');
  });
});
