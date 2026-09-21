// StoreSelector — tela inicial da /loja: grade de LOJAS (hoje só a Cali
// Colors) antes de entrar no catálogo de produtos. Clicar num tile entra
// na loja (LojaShell troca pra ProductsList). Preparada pra crescer quando
// outras lojas parceiras entrarem — a lista vive num array, não é um
// single case hardcoded no JSX.

'use client';

import { useProducts } from '@/lib/hooks/useProducts';

export interface StoreOption {
  id: string;
  name: string;
  subtitle: string;
  emoji: string;
}

const STORES: StoreOption[] = [
  {
    id: 'calicolors',
    name: 'Cali Colors',
    subtitle: 'Tintas, texturas e ferramentas',
    emoji: '🎨',
  },
];

export function StoreSelector({ onSelect }: { onSelect: (storeId: string) => void }) {
  // Contagem de itens só faz sentido pra Cali Colors hoje — é o único
  // catálogo que existe. Loja nova vai precisar da própria fonte de contagem.
  const { all, loading } = useProducts();

  return (
    <>
      <header
        className="sticky top-0 z-20"
        style={{
          background: 'var(--color-ink-fixed)',
          padding: '14px 16px 20px',
        }}
      >
        <div
          className="font-extrabold text-[color:var(--color-white-fixed)]"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
          }}
        >
          Lojas
        </div>
      </header>

      <div className="px-3 pt-3">
        <ul className="grid grid-cols-2 gap-3 pb-4" aria-label="Lojas disponíveis">
          {STORES.map((store) => (
            <li key={store.id}>
              <button
                type="button"
                onClick={() => onSelect(store.id)}
                className="w-full h-full flex flex-col items-center justify-center text-center gap-2 bg-white rounded-2xl border border-[color:var(--color-border)] hover:shadow-md transition-shadow"
                style={{ padding: '22px 12px', minHeight: 148 }}
              >
                <span aria-hidden="true" style={{ fontSize: 38, lineHeight: 1 }}>
                  {store.emoji}
                </span>
                <span className="text-sm font-semibold text-[color:var(--color-ink)] leading-tight">
                  {store.name}
                </span>
                <span className="text-xs text-[color:var(--color-muted)]">
                  {store.subtitle}
                </span>
                {store.id === 'calicolors' ? (
                  <span className="text-xs text-[color:var(--color-muted)]">
                    {loading ? 'Carregando…' : `${all.length} ${all.length === 1 ? 'item' : 'itens'}`}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
