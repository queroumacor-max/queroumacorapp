// LojaShell — orquestra a tela de seleção de loja (StoreSelector) e o
// catálogo de produtos (ProductsList) da loja escolhida.

'use client';

import { useState } from 'react';
import { StoreSelector } from './StoreSelector';
import { StoreComingSoon } from './StoreComingSoon';
import { ProductsList } from './ProductsList';
import { AliceFab } from './AliceFab';
import { CorDoAnoModal } from './CorDoAnoModal';
import type { Store } from '@/lib/services/stores';

// Única loja com catálogo de verdade hoje — o ProductsList inteiro (grid de
// categorias, busca, carrinho) é modelado em cima da tabela `products`, que
// é da Cali Colors. Loja nova cadastrada pelo portal (tela "Lojas") aparece
// no StoreSelector, mas cai no StoreComingSoon até ganhar catálogo próprio
// — sem essa trava, selecioná-la abriria escondido o catálogo da Cali
// Colors com o nome errado.
const CATALOG_STORE_ID = 'calicolors';

export function LojaShell() {
  const [store, setStore] = useState<Store | null>(null);

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
