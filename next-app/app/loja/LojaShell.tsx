// LojaShell — orquestra a tela de seleção de loja (StoreSelector) e o
// catálogo de produtos (ProductsList) da loja escolhida. Hoje só existe a
// Cali Colors; a tela de seleção já fica pronta pra quando outras lojas
// parceiras entrarem.

'use client';

import { useState } from 'react';
import { StoreSelector } from './StoreSelector';
import { ProductsList } from './ProductsList';
import { AliceFab } from './AliceFab';
import { CorDoAnoModal } from './CorDoAnoModal';

export function LojaShell() {
  const [storeId, setStoreId] = useState<string | null>(null);

  if (!storeId) {
    return <StoreSelector onSelect={setStoreId} />;
  }

  return (
    <>
      <ProductsList onBackToStores={() => setStoreId(null)} />
      <AliceFab />
      <CorDoAnoModal />
    </>
  );
}
