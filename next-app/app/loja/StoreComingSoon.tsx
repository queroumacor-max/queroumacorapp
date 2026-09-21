// StoreComingSoon — tela mostrada ao escolher, no StoreSelector, uma loja
// que ainda NÃO tem catálogo próprio. Hoje só a Cali Colors tem catálogo
// de verdade (o ProductsList inteiro — categorias, busca, carrinho — é
// modelado em cima da tabela `products`, que é dela). Sem esta tela, loja
// nova cadastrada pelo portal abriria escondido o catálogo da Cali Colors
// com o nome errado (achado do Codex na revisão do PR #392).

'use client';

import type { Store } from '@/lib/services/stores';

export function StoreComingSoon({
  store,
  onBackToStores,
}: {
  store: Store;
  onBackToStores: () => void;
}) {
  return (
    <>
      <header
        className="sticky top-0 z-20"
        style={{
          background: 'var(--color-ink-fixed)',
          padding: '14px 16px 20px',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBackToStores}
            aria-label="Voltar para lojas"
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'rgba(255,255,255,.1)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div
            className="font-extrabold text-[color:var(--color-white-fixed)] truncate"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
            }}
          >
            {store.emoji} {store.name}
          </div>
        </div>
      </header>

      <div className="px-4 pt-12 text-center">
        <div className="text-5xl mb-4" aria-hidden="true">
          🚧
        </div>
        <h2 className="font-semibold mb-2">Catálogo em preparação</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-6">
          A loja <strong>{store.name}</strong> ainda não tem produtos cadastrados por aqui.
        </p>
        <button
          type="button"
          onClick={onBackToStores}
          className="text-sm font-semibold text-[color:var(--color-p1)]"
        >
          ← Voltar pras lojas
        </button>
      </div>
    </>
  );
}
