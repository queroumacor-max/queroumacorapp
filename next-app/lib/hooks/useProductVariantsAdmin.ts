// useProductVariantsAdmin — mutations admin pra product_variants. RLS no
// banco já gateia por is_portal_admin(), então UI só precisa de feedback.

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createVariant,
  updateVariant,
  deleteVariant,
  generateDefaultVariants,
  type ProductVariant,
} from '@/lib/services/mkt';

interface CreateArg {
  size_label: string;
  volume_ml?: number | null;
  price: number;
  stock?: number | null;
  sort_order?: number;
}

interface UpdateArg {
  id: string;
  patch: Partial<Pick<ProductVariant, 'size_label' | 'volume_ml' | 'price' | 'stock' | 'sort_order'>>;
}

export function useProductVariantsAdmin(productId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['product-variants', productId] });
  };

  const createMut = useMutation<string, Error, CreateArg>({
    mutationFn: (arg) => createVariant(productId, arg),
    onSuccess: invalidate,
  });
  const updateMut = useMutation<void, Error, UpdateArg>({
    mutationFn: ({ id, patch }) => updateVariant(id, patch),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation<void, Error, string>({
    mutationFn: (id) => deleteVariant(id),
    onSuccess: invalidate,
  });
  const generateMut = useMutation<void, Error, { basePrice: number }>({
    mutationFn: ({ basePrice }) => generateDefaultVariants(productId, basePrice),
    onSuccess: invalidate,
  });

  return {
    create: createMut.mutateAsync,
    update: updateMut.mutateAsync,
    remove: deleteMut.mutateAsync,
    generateDefaults: generateMut.mutateAsync,
    isMutating:
      createMut.isPending ||
      updateMut.isPending ||
      deleteMut.isPending ||
      generateMut.isPending,
    error:
      createMut.error ??
      updateMut.error ??
      deleteMut.error ??
      generateMut.error ??
      null,
  };
}
