// @vitest-environment jsdom
//
// Achado do Codex na revisão do PR #392: `storeId` era usado só como flag
// (truthy/falsy) — selecionar qualquer loja diferente da Cali Colors abria
// escondido o mesmo ProductsList (catálogo da Cali Colors), com o nome
// errado no header. Trava: só 'calicolors' abre o catálogo de verdade;
// qualquer outra loja cai no StoreComingSoon.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Store } from '@/lib/services/stores';

const CALICOLORS: Store = {
  id: 'calicolors',
  name: 'Cali Colors',
  subtitle: 'Tintas, texturas e ferramentas',
  emoji: '🎨',
  active: true,
  sort_order: 0,
};
const OUTRA_LOJA: Store = {
  id: 'tintas-abc',
  name: 'Tintas ABC',
  subtitle: null,
  emoji: '🏬',
  active: true,
  sort_order: 1,
};

const mockStores: { stores: Store[] } = { stores: [CALICOLORS, OUTRA_LOJA] };

const mockParams: { loja: string | null } = { loja: null };
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'loja' ? mockParams.loja : null) }),
}));

vi.mock('@/lib/hooks/useStores', () => ({
  useStores: () => ({ stores: mockStores.stores, loading: false, error: null }),
}));
vi.mock('@/lib/hooks/useProducts', () => ({
  useProducts: () => ({ all: [], loading: false }),
}));
vi.mock('@/app/loja/ProductsList', () => ({
  ProductsList: () => <div data-testid="catalogo-calicolors">catálogo Cali Colors</div>,
}));
vi.mock('@/app/loja/AliceFab', () => ({ AliceFab: () => null }));
vi.mock('@/app/loja/CorDoAnoModal', () => ({ CorDoAnoModal: () => null }));

import { LojaShell } from '@/app/loja/LojaShell';

afterEach(() => {
  cleanup();
  mockParams.loja = null;
  window.history.replaceState(null, '', '/');
});

describe('LojaShell — roteamento por loja', () => {
  it('escolher a Cali Colors abre o catálogo de produtos', () => {
    render(<LojaShell />);
    fireEvent.click(screen.getByText('Cali Colors'));
    expect(screen.getByTestId('catalogo-calicolors')).toBeTruthy();
  });

  it('escolher outra loja NÃO abre o catálogo da Cali Colors — mostra "em preparação"', () => {
    render(<LojaShell />);
    fireEvent.click(screen.getByText('Tintas ABC'));
    expect(screen.queryByTestId('catalogo-calicolors')).toBeNull();
    expect(screen.getByText('Catálogo em preparação')).toBeTruthy();
    expect(screen.getAllByText(/Tintas ABC/).length).toBeGreaterThan(0);
  });

  it('"Voltar pras lojas" na tela de espera volta pro grid de lojas', () => {
    render(<LojaShell />);
    fireEvent.click(screen.getByText('Tintas ABC'));
    fireEvent.click(screen.getByText('← Voltar pras lojas'));
    expect(screen.getByText('Cali Colors')).toBeTruthy();
    expect(screen.getByText('Tintas ABC')).toBeTruthy();
  });

  it('?loja=calicolors abre direto no catálogo (links de carrinho/produto/pedido)', () => {
    mockParams.loja = 'calicolors';
    render(<LojaShell />);
    expect(screen.getByTestId('catalogo-calicolors')).toBeTruthy();
  });

  it('?loja= com outra loja NÃO abre catálogo nenhum — cai na seleção', () => {
    mockParams.loja = 'tintas-abc';
    render(<LojaShell />);
    expect(screen.queryByTestId('catalogo-calicolors')).toBeNull();
    expect(screen.getByText('Tintas ABC')).toBeTruthy();
  });

  it('escolher a Cali Colors espelha ?loja= na URL (VOLTAR do produto cai no catálogo)', () => {
    window.history.replaceState(null, '', '/loja');
    render(<LojaShell />);
    fireEvent.click(screen.getByText('Cali Colors'));
    expect(window.location.pathname + window.location.search).toBe('/loja?loja=calicolors');
  });
});
