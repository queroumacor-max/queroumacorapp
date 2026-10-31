// "Escolhe pintor e fica como pintor" (2026-10-31). Quem entrava por
// Google/Apple nascia cliente; no /completar-perfil escolhia Pintor, o app
// gravava user_type='pintor' e `role` (que o app lê) ficava 'cliente'.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
import { comPapel } from '../lib/hooks/useProfile';
import type { Profile } from '../lib/types';

const sql = readFileSync(join(__dirname, '../../migrations/2026-10-31-role-segue-user-type.sql'), 'utf8');

describe('cache: role acompanha a categoria escolhida', () => {
  it('cliente que escolhe pintor vira pintor', () => {
    const p = comPapel({ id: 'u', role: 'cliente', user_type: 'cliente' } as unknown as Profile, { user_type: 'pintor' });
    expect((p as unknown as { role: string }).role).toBe('pintor');
  });
  it('sinônimo vira o papel canônico', () => {
    const p = comPapel({ id: 'u', role: 'cliente' } as unknown as Profile, { user_type: 'funileiro' as never });
    expect((p as unknown as { role: string }).role).toBe('automotivo');
  });
  it('admin nunca muda', () => {
    const p = comPapel({ id: 'u', role: 'admin' } as unknown as Profile, { user_type: 'cliente' });
    expect((p as unknown as { role: string }).role).toBe('admin');
  });
  it('patch sem categoria não mexe no papel', () => {
    const p = comPapel({ id: 'u', role: 'pintor' } as unknown as Profile, { name: 'X' });
    expect((p as unknown as { role: string }).role).toBe('pintor');
  });
});

describe('SQL: role segue user_type sem abrir escalada', () => {
  it('só os 5 papéis comuns viram role (nunca admin)', () => {
    expect(sql).toMatch(/v IN \('cliente','pintor','grafiteiro','automotivo','arquiteto'\)/);
    expect(sql).not.toMatch(/IN \([^)]*'admin'/);
  });
  it('role admin nunca é tocado', () => {
    expect(sql).toMatch(/coalesce\(NEW\.role, ''\) <> 'admin'/);
  });
  it('acompanha quando a categoria MUDA (não só quando role está vazio)', () => {
    expect(sql).toMatch(/NEW\.user_type IS DISTINCT FROM OLD\.user_type/);
  });
});
