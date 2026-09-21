// StoreSelector — tela inicial da /loja: grade de LOJAS (hoje só a Cali
// Colors) antes de entrar no catálogo de produtos. Clicar num tile entra
// na loja (LojaShell troca pra ProductsList). A lista de lojas vem do
// banco (tabela `stores`, cadastrada pelo portal em "Lojas") — cadastrar
// loja nova não precisa de deploy nem de mexer neste arquivo.

'use client';

import { useStores } from '@/lib/hooks/useStores';
import { useProducts } from '@/lib/hooks/useProducts';
import type { Store } from '@/lib/services/stores';

export function StoreSelector({ onSelect }: { onSelect: (store: Store) => void }) {
  const { stores, loading: storesLoading } = useStores();
  // Contagem de itens só faz sentido pra Cali Colors hoje — é o único
  // catálogo que existe. Loja nova vai precisar da própria fonte de contagem.
  const { all, loading: productsLoading } = useProducts();

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
          Selecione sua loja
        </div>
      </header>

      <div className="px-3 pt-3">
        {storesLoading ? (
          <div className="text-center py-10 text-sm text-[color:var(--color-muted)]">
            Carregando lojas…
          </div>
        ) : (
          <>
            {/* Um tile por linha, ocupando a largura toda — com só uma
                loja hoje, 2 colunas deixava metade da tela vazia. A
                mensagem "mais lojas em breve" vem DEPOIS da lista (não é
                absoluta), então ela desce sozinha conforme lojas novas
                forem cadastradas pelo portal. */}
            <ul className="grid grid-cols-1 gap-3 pb-3" aria-label="Lojas disponíveis">
              {stores.map((store) => (
                <li key={store.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(store)}
                    className="w-full h-full flex flex-col items-center justify-center text-center gap-2 bg-white rounded-2xl border border-[color:var(--color-border)] hover:shadow-md transition-shadow"
                    style={{ padding: '22px 12px', minHeight: 148 }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 38, lineHeight: 1 }}>
                      {store.emoji}
                    </span>
                    <span className="text-sm font-semibold text-[color:var(--color-ink)] leading-tight">
                      {store.name}
                    </span>
                    {store.subtitle ? (
                      <span className="text-xs text-[color:var(--color-muted)]">
                        {store.subtitle}
                      </span>
                    ) : null}
                    {store.id === 'calicolors' ? (
                      <span className="text-xs text-[color:var(--color-muted)]">
                        {productsLoading ? 'Carregando…' : `${all.length} ${all.length === 1 ? 'item' : 'itens'}`}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-center text-xs text-[color:var(--color-muted)] pb-4">
              Mais lojas em breve...
            </p>
          </>
        )}
      </div>
    </>
  );
}
