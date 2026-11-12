// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  usosHoje,
  registrarUso,
  limiteAtingido,
  restantesHoje,
  semLimite,
  LIMITE_DIARIO_FREE,
} from '@/lib/freemiumDiario';

// Usuário grátis = null (canSeeProFeature(null) === false).
// PRO sem data de validade = is_pro true sem expires/grace → canSeeProFeature true.
const FREE = null;
const PRO = { is_pro: true } as unknown as Parameters<typeof semLimite>[0];

describe('freemiumDiario — limite diário do free', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* noop */ }
  });

  it('começa em 0 e conta cada uso', () => {
    expect(usosHoje('calculadora')).toBe(0);
    expect(registrarUso('calculadora')).toBe(1);
    expect(registrarUso('calculadora')).toBe(2);
    expect(usosHoje('calculadora')).toBe(2);
  });

  it('cada ferramenta tem contador próprio', () => {
    registrarUso('frete');
    expect(usosHoje('frete')).toBe(1);
    expect(usosHoje('orcamento')).toBe(0);
    expect(usosHoje('calculadora')).toBe(0);
  });

  it('free: atinge o limite no 2º uso; restantes vai a 0', () => {
    expect(limiteAtingido('frete', FREE)).toBe(false);
    expect(restantesHoje('frete', FREE)).toBe(LIMITE_DIARIO_FREE);
    registrarUso('frete');
    expect(restantesHoje('frete', FREE)).toBe(LIMITE_DIARIO_FREE - 1);
    expect(limiteAtingido('frete', FREE)).toBe(false);
    registrarUso('frete');
    expect(restantesHoje('frete', FREE)).toBe(0);
    expect(limiteAtingido('frete', FREE)).toBe(true);
  });

  it('PRO/admin: ilimitado (nunca atinge; restantes null; semLimite true)', () => {
    registrarUso('orcamento');
    registrarUso('orcamento');
    registrarUso('orcamento');
    expect(semLimite(PRO)).toBe(true);
    expect(limiteAtingido('orcamento', PRO)).toBe(false);
    expect(restantesHoje('orcamento', PRO)).toBeNull();
  });
});
