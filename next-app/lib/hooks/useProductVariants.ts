// useProductVariants — busca as variantes (Wave 25) de um produto.
// Cacheado individualmente porque o ProductDetailSheet abre por produto.
// staleTime = MKT_TTL pra alinhar com useProducts.

'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchProductVariants, type ProductVariant } from '@/lib/services/mkt';

const MKT_TTL = 5 * 60 * 1000;

// Referência ESTÁVEL pro caso "sem variantes" (enquanto `query.data` é
// undefined — loading, ou productId nulo). `query.data ?? []` criaria um
// array NOVO em toda chamada, e o `ProductDetailSheet` compara `variants`
// por IDENTIDADE (`variants !== variantsVisto`) pra ajustar state durante o
// render — com uma referência nova a cada render, essa comparação nunca
// estabiliza e vira loop infinito ("Too many re-renders"), quebrando a tela
// com o error boundary. Ver CLAUDE.md.
const EMPTY_VARIANTS: ProductVariant[] = [];

export function useProductVariants(productId: string | null | undefined): {
  variants: ProductVariant[];
  loading: boolean;
  error: Error | null;
} {
  const query = useQuery<ProductVariant[], Error>({
    queryKey: ['product-variants', productId ?? ''],
    queryFn: ({ signal }) => fetchProductVariants(productId ?? '', { signal }),
    enabled: !!productId,
    staleTime: MKT_TTL,
  });
  return {
    variants: query.data ?? EMPTY_VARIANTS,
    loading: query.isLoading,
    error: query.error ?? null,
  };
}
