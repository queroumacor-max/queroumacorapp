import { describe, it, expect } from 'vitest';
import { proAtivoNaLinha } from '../../lib/api/security';
import { canSeeProFeature } from '../../lib/policies';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const ontem = '2026-09-25T12:00:00Z';
const amanha = '2026-09-27T12:00:00Z';

describe('proAtivoNaLinha (requirePro)', () => {
  it('PRO vencido mas dentro da carência continua ativo', () => {
    expect(
      proAtivoNaLinha({ is_pro: true, pro_expires_at: ontem, pro_grace_until: amanha }, NOW),
    ).toBe(true);
  });

  it('carência também vencida → não é PRO', () => {
    expect(
      proAtivoNaLinha({ is_pro: true, pro_expires_at: ontem, pro_grace_until: ontem }, NOW),
    ).toBe(false);
  });

  it('sem datas confia no is_pro', () => {
    expect(proAtivoNaLinha({ is_pro: true }, NOW)).toBe(true);
    expect(proAtivoNaLinha({ is_pro: false }, NOW)).toBe(false);
  });

  it('is_pro false nunca vira PRO pela carência', () => {
    expect(proAtivoNaLinha({ is_pro: false, pro_grace_until: amanha }, NOW)).toBe(false);
  });

  it('bate com canSeeProFeature (selo e portão perguntam a mesma coisa)', () => {
    const casos = [
      { is_pro: true, pro_expires_at: ontem, pro_grace_until: amanha },
      { is_pro: true, pro_expires_at: ontem, pro_grace_until: null },
      { is_pro: true, pro_expires_at: amanha, pro_grace_until: null },
      { is_pro: true, pro_expires_at: null, pro_grace_until: null },
      { is_pro: false, pro_expires_at: amanha, pro_grace_until: amanha },
    ];
    const real = Date.now;
    Date.now = () => NOW;
    try {
      for (const c of casos) {
        expect(proAtivoNaLinha(c, NOW)).toBe(canSeeProFeature(c as never));
      }
    } finally {
      Date.now = real;
    }
  });
});
