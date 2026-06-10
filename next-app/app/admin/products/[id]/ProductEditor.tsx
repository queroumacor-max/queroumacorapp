// ProductEditor — exibe header do produto + lista de variantes existentes
// com edit inline + botão "Gerar 3 variantes padrão" + adicionar 1 manual.

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { useProduct } from '@/lib/hooks/useProducts';
import { useProductVariants } from '@/lib/hooks/useProductVariants';
import { useProductVariantsAdmin } from '@/lib/hooks/useProductVariantsAdmin';
import { isAdmin } from '@/lib/policies';
import { showToast } from '@/lib/toast';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function ProductEditor({ productId }: { productId: string }) {
  const { user } = useAuth();
  const dialog = useDialog();
  const { product, loading: prodLoading } = useProduct(productId);
  const { variants, loading: varLoading } = useProductVariants(productId);
  const admin = useProductVariantsAdmin(productId);
  const [addOpen, setAddOpen] = useState(false);

  const policyUser = user
    ? {
        id: user.id,
        is_admin: (user.user_metadata?.is_admin as boolean | undefined) ?? false,
        role: (user.user_metadata?.role as string | undefined) ?? null,
      }
    : null;

  if (!isAdmin(policyUser)) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">🔒</div>
        <h2 className="font-semibold mb-2">Acesso restrito</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          Apenas administradores podem editar produtos.
        </p>
      </div>
    );
  }

  if (prodLoading) {
    return <div className="text-sm text-[color:var(--color-muted)]">Carregando…</div>;
  }
  if (!product) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <p className="text-sm text-[color:var(--color-muted)] mb-3">
          Produto não encontrado.
        </p>
        <Link
          href="/admin/products"
          className="text-sm font-semibold text-[color:var(--color-p1)]"
        >
          ← Voltar pra lista
        </Link>
      </div>
    );
  }

  async function handleGenerate() {
    if (variants.length > 0) {
      const ok = await dialog.confirm(
        'Esse produto já tem variantes. Gerar 3 padrão vai criar mais — pode causar duplicata. Continuar?',
        { title: 'Confirmar', okLabel: 'Gerar mesmo assim' },
      );
      if (!ok) return;
    } else {
      const ok = await dialog.confirm(
        `Vai criar 3 variantes:\n\n• Quartinho 900ml — ${BRL.format(Number(product!.price || 0) / 14)}\n• Galão 3.6L — ${BRL.format(Number(product!.price || 0) / 4)}\n• Lata 18L — ${BRL.format(Number(product!.price || 0))}\n\nPreços calculados por proporção a partir do preço atual (assumido como lata 18L). Você pode ajustar depois.`,
        { title: 'Gerar 3 variantes', okLabel: 'Gerar' },
      );
      if (!ok) return;
    }
    try {
      await admin.generateDefaults({ basePrice: Number(product!.price || 0) });
      showToast('Variantes geradas!', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Falha ao gerar.', 'error');
    }
  }

  async function handleDelete(id: string, label: string) {
    const ok = await dialog.confirm(
      `Apagar variante "${label}"?`,
      { title: 'Confirmar', okLabel: 'Apagar' },
    );
    if (!ok) return;
    try {
      await admin.remove(id);
      showToast('Variante removida.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Falha ao remover.', 'error');
    }
  }

  return (
    <>
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--color-p1)] mb-3"
      >
        ← Voltar
      </Link>
      <h1 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
        {product.name}
      </h1>
      <div className="text-xs text-[color:var(--color-muted)] mb-1">
        {product.code ? `Cód ${product.code}` : ''}
        {product.line ? ` · ${product.line}` : ''}
      </div>
      <div className="text-sm font-semibold mb-6">
        Preço atual: {BRL.format(Number(product.price || 0))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Variantes ({variants.length})
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={admin.isMutating}
            className="px-3 py-2 text-xs font-semibold bg-[color:var(--color-ink)] text-white rounded-lg disabled:opacity-60"
          >
            Gerar 3 padrão
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={admin.isMutating}
            className="px-3 py-2 text-xs font-semibold bg-white border border-[color:var(--color-border)] text-[color:var(--color-ink)] rounded-lg disabled:opacity-60"
          >
            + Adicionar
          </button>
        </div>
      </div>

      {varLoading ? (
        <div className="text-sm text-[color:var(--color-muted)]">Carregando variantes…</div>
      ) : variants.length === 0 ? (
        <div className="text-center py-8 px-4 rounded-xl bg-white border border-[color:var(--color-border)] mb-4">
          <p className="text-sm text-[color:var(--color-muted)]">
            Nenhuma variante. Use "Gerar 3 padrão" pra criar quartinho/galão/lata
            de uma vez.
          </p>
        </div>
      ) : (
        <ul className="space-y-2 mb-4">
          {variants.map((v) => (
            <VariantRow
              key={v.id}
              variant={v}
              onSave={(patch) => admin.update({ id: v.id, patch })}
              onDelete={() => handleDelete(v.id, v.size_label)}
              disabled={admin.isMutating}
            />
          ))}
        </ul>
      )}

      {addOpen ? (
        <AddVariantForm
          onCancel={() => setAddOpen(false)}
          onSubmit={async (input) => {
            try {
              await admin.create(input);
              setAddOpen(false);
              showToast('Variante criada!', 'success');
            } catch (e) {
              showToast(e instanceof Error ? e.message : 'Falha ao criar.', 'error');
            }
          }}
          disabled={admin.isMutating}
        />
      ) : null}

      {admin.error ? (
        <div className="mt-3 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
          {admin.error.message}
        </div>
      ) : null}
    </>
  );
}

function VariantRow({
  variant,
  onSave,
  onDelete,
  disabled,
}: {
  variant: { id: string; size_label: string; volume_ml: number | null; price: number; stock: number | null; sort_order: number };
  onSave: (patch: { size_label?: string; volume_ml?: number | null; price?: number; stock?: number | null; sort_order?: number }) => Promise<void>;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [label, setLabel] = useState(variant.size_label);
  const [volMl, setVolMl] = useState(variant.volume_ml?.toString() ?? '');
  const [price, setPrice] = useState(variant.price.toString());
  const [stock, setStock] = useState(variant.stock?.toString() ?? '');
  const [sortOrder, setSortOrder] = useState(variant.sort_order.toString());
  const dirty =
    label !== variant.size_label ||
    (volMl ? parseInt(volMl, 10) : null) !== variant.volume_ml ||
    parseFloat(price) !== variant.price ||
    (stock ? parseInt(stock, 10) : null) !== variant.stock ||
    parseInt(sortOrder, 10) !== variant.sort_order;

  async function handleSave() {
    await onSave({
      size_label: label,
      volume_ml: volMl ? parseInt(volMl, 10) : null,
      price: parseFloat(price) || 0,
      stock: stock ? parseInt(stock, 10) : null,
      sort_order: parseInt(sortOrder, 10) || 0,
    });
  }

  return (
    <li className="p-3 bg-white rounded-xl border border-[color:var(--color-border)]">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Quartinho"
          aria-label="Nome da variante"
          className="col-span-2 px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
        <input
          type="number"
          value={volMl}
          onChange={(e) => setVolMl(e.target.value)}
          placeholder="Volume (ml)"
          aria-label="Volume em ml"
          className="px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
        <input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Preço"
          aria-label="Preço"
          className="px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
        <input
          type="number"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          placeholder="Estoque (opcional)"
          aria-label="Estoque"
          className="px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          placeholder="Ordem"
          aria-label="Ordem"
          className="px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-60"
        >
          Apagar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled || !dirty}
          className="px-3 py-1.5 text-xs font-semibold bg-[color:var(--color-p1)] text-white rounded-lg disabled:opacity-60"
        >
          Salvar
        </button>
      </div>
    </li>
  );
}

function AddVariantForm({
  onCancel,
  onSubmit,
  disabled,
}: {
  onCancel: () => void;
  onSubmit: (input: { size_label: string; volume_ml: number | null; price: number; sort_order: number }) => Promise<void>;
  disabled: boolean;
}) {
  const [label, setLabel] = useState('');
  const [volMl, setVolMl] = useState('');
  const [price, setPrice] = useState('');
  const [sortOrder, setSortOrder] = useState('0');

  return (
    <div className="p-3 bg-white rounded-xl border border-[color:var(--color-border)] mb-4">
      <h3 className="text-sm font-bold mb-2">Nova variante</h3>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nome (ex: Quartinho 900ml)"
          aria-label="Nome"
          className="col-span-2 px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
        <input
          type="number"
          value={volMl}
          onChange={(e) => setVolMl(e.target.value)}
          placeholder="Volume ml"
          aria-label="Volume"
          className="px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
        <input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Preço"
          aria-label="Preço"
          className="px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          placeholder="Ordem"
          aria-label="Ordem"
          className="px-3 py-2 text-sm border border-[color:var(--color-border)] rounded-lg"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="px-3 py-1.5 text-xs font-semibold text-[color:var(--color-muted)] disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => {
            if (!label.trim() || !price) return;
            onSubmit({
              size_label: label.trim(),
              volume_ml: volMl ? parseInt(volMl, 10) : null,
              price: parseFloat(price) || 0,
              sort_order: parseInt(sortOrder, 10) || 0,
            });
          }}
          disabled={disabled || !label.trim() || !price}
          className="px-3 py-1.5 text-xs font-semibold bg-[color:var(--color-p1)] text-white rounded-lg disabled:opacity-60"
        >
          Criar
        </button>
      </div>
    </div>
  );
}
