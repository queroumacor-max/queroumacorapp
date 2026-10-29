// @vitest-environment jsdom
//
// Guard de cadastro incompleto no AppShell: quem entrou por Google/Apple e
// ficou sem @tag é levado de volta pro /completar-perfil na próxima abertura,
// em vez de seguir usando o app com o perfil pela metade.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const replace = vi.fn();
const mockPathname = { value: '/feed' };
const mockAuth = { user: { id: 'u1' } as { id: string } | null, loading: false };
const mockProfile = {
  profile: null as Record<string, unknown> | null,
  loading: false,
  error: null as Error | null,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => mockPathname.value,
}));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => mockAuth }));
vi.mock('@/lib/hooks/useProfile', () => ({ useProfile: () => mockProfile }));
// Chrome e efeitos colaterais fora do escopo do guard.
vi.mock('@/components/TopNav', () => ({ TopNav: () => <div /> }));
vi.mock('@/components/BottomNav', () => ({ BottomNav: () => <div /> }));
// NativeBadge usa os hooks de não-lidas (react-query), igual TopNav/BottomNav —
// mockado pra o teste do guard não precisar de QueryClientProvider.
vi.mock('@/components/NativeBadge', () => ({ NativeBadge: () => null }));
vi.mock('@/components/RealtimeBindings', () => ({ RealtimeBindings: () => null }));
vi.mock('@/components/AppTour', () => ({ AppTour: () => null }));
vi.mock('@/components/billing/BoasVindasCompraModal', () => ({ BoasVindasCompraModal: () => null }));

import { AppShell } from '@/components/AppShell';

beforeEach(() => {
  replace.mockClear();
  mockPathname.value = '/feed';
  mockAuth.user = { id: 'u1' };
  mockAuth.loading = false;
  mockProfile.profile = { user_type: 'pintor', tag: 'joao' };
  mockProfile.loading = false;
  mockProfile.error = null;
});
afterEach(cleanup);

describe('AppShell — cadastro incompleto', () => {
  it('perfil completo passa direto', () => {
    render(<AppShell><p>conteúdo privado</p></AppShell>);
    expect(screen.getByText('conteúdo privado')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sem @tag → manda pro /completar-perfil e não renderiza a tela', () => {
    mockProfile.profile = { user_type: 'pintor', tag: null };
    render(<AppShell><p>conteúdo privado</p></AppShell>);
    expect(replace).toHaveBeenCalledWith('/completar-perfil');
    expect(screen.queryByText('conteúdo privado')).toBeNull();
  });

  it('sem categoria → mesma coisa', () => {
    mockProfile.profile = { tag: 'joao' };
    render(<AppShell><p>conteúdo privado</p></AppShell>);
    expect(replace).toHaveBeenCalledWith('/completar-perfil');
  });

  it('NÃO redireciona enquanto o profile está carregando', () => {
    mockProfile.profile = null;
    mockProfile.loading = true;
    render(<AppShell><p>conteúdo privado</p></AppShell>);
    expect(replace).not.toHaveBeenCalled();
  });

  it('NÃO redireciona quando a busca do profile falhou (erro de rede)', () => {
    mockProfile.profile = null;
    mockProfile.error = new Error('offline');
    render(<AppShell><p>conteúdo privado</p></AppShell>);
    expect(replace).not.toHaveBeenCalledWith('/completar-perfil');
  });

  it('não se auto-redireciona quando já está no /completar-perfil', () => {
    mockPathname.value = '/completar-perfil';
    mockProfile.profile = { user_type: 'pintor', tag: null };
    render(<AppShell><p>conteúdo privado</p></AppShell>);
    expect(replace).not.toHaveBeenCalled();
  });

  it('página pública (requireAuth=false) não é afetada', () => {
    mockProfile.profile = { tag: null };
    render(<AppShell requireAuth={false}><p>página legal</p></AppShell>);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('página legal')).toBeTruthy();
  });
});
