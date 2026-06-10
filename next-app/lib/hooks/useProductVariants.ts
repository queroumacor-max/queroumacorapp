// useProductVariants — busca as variantes (Wave 25) de um produto.
// Cacheado individualmente porque o ProductDetailSheet abre por produto.
// staleTime = MKT_TTL pra alinhar com useProducts.

'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchProductVariants, type ProductVariant } from '@/lib/services/mkt';

const MKT_TTL = 5 * 60 * 1000;

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
    variants: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
  };
}
