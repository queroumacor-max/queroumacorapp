// LojaShell — orquestra a tela de seleção de loja (StoreSelector) e o
// catálogo de produtos (ProductsList) da loja escolhida.

'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { StoreSelector } from './StoreSelector';
import { StoreComingSoon } from './StoreComingSoon';
import { ProductsList } from './ProductsList';
import { AliceFab } from './AliceFab';
import { CorDoAnoModal } from './CorDoAnoModal';
import {
  CATALOG_STORE_ID,
  FALLBACK_STORES,
  LOJA_CATALOGO_HREF,
  type Store,
} from '@/lib/services/stores';

// Única loja com catálogo de verdade hoje — o ProductsList inteiro (grid de
// categorias, busca, carrinho) é modelado em cima da tabela `products`, que
// é da Cali Colors. Loja nova cadastrada pelo portal (tela "Lojas") aparece
// no StoreSelector, mas cai no StoreComingSoon até ganhar catálogo próprio
// — sem essa trava, selecioná-la abriria escondido o catálogo da Cali
// Colors com o nome errado.

// `?loja=calicolors` (LOJA_CATALOGO_HREF) abre direto no catálogo. Só a loja
// que TEM catálogo é aceita: qualquer outro valor cai na seleção, igual a
// /loja sem nada — um link velho ou digitado não abre catálogo errado.
function lojaInicial(id?: string | null): Store | null {
  if (id !== CATALOG_STORE_ID) return null;
  return FALLBACK_STORES.find((s) => s.id === CATALOG_STORE_ID) ?? null;
}

// A escolha da loja fica espelhada na URL (replaceState, sem entrada nova no
// histórico): assim o VOLTAR do Android, saindo de um produto, cai de novo no
// catálogo — antes o componente remontava sem estado e parava na seleção.
function espelharNaUrl(href: string) {
  if (typeof window === 'undefined') return;
  const atual = window.location.pathname + window.location.search;
  if (atual !== href) window.history.replaceState(window.history.state, '', href);
}

export function LojaShell() {
  const params = useSearchParams();
  const [store, setStoreState] = useState<Store | null>(() =>
    lojaInicial(params?.get('loja')),
  );

  const setStore = (s: Store | null) => {
    setStoreState(s);
    if (!s) espelharNaUrl('/loja');
    else if (s.id === CATALOG_STORE_ID) espelharNaUrl(LOJA_CATALOGO_HREF);
  };

  if (!store) {
    return <StoreSelector onSelect={setStore} />;
  }

  if (store.id !== CATALOG_STORE_ID) {
    return <StoreComingSoon store={store} onBackToStores={() => setStore(null)} />;
  }

  return (
    <>
      <ProductsList onBackToStores={() => setStore(null)} />
      <AliceFab />
      <CorDoAnoModal />
    </>
  );
}
