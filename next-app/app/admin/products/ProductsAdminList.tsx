// ProductsAdminList — busca + lista compacta dos 4171 produtos. Click → editor.
// Reusa useProducts (já paginado por baixo do pano, mesmo fetch da Loja).

'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useProducts } from '@/lib/hooks/useProducts';
import { isAdmin } from '@/lib/policies';

const MAX_VISIBLE = 50;

export function ProductsAdminList() {
  const { user } = useAuth();
  const { all, loading, error } = useProducts();
  const [search, setSearch] = useState('');

  const policyUser = user
    ? {
        id: user.id,
        is_admin: (user.user_metadata?.is_admin as boolean | undefined) ?? false,
        role: (user.user_metadata?.role as string | undefined) ?? null,
      }
    : null;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all.slice(0, MAX_VISIBLE);
    return all
      .filter(
        (p) =>
          (p.name || '').toLowerCase().includes(q) ||
          String(p.code || '').toLowerCase().includes(q),
      )
      .slice(0, MAX_VISIBLE);
  }, [all, search]);

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

  return (
    <>
      <div className="relative mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar produto por nome ou código…"
          className="w-full px-4 py-3 rounded-xl border border-[color:var(--color-border)] bg-white text-sm outline-none focus:border-[color:var(--color-p1)]"
          aria-label="Buscar produto"
        />
      </div>

      {loading ? (
        <div className="text-sm text-[color:var(--color-muted)]">Carregando…</div>
      ) : error ? (
        <div className="text-sm text-red-600">Erro: {error.message}</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-[color:var(--color-muted)]">
          {search ? 'Nenhum produto encontrado.' : 'Sem produtos cadastrados.'}
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {visible.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/products/${p.id}`}
                  className="flex items-center justify-between p-3 bg-white rounded-xl border border-[color:var(--color-border)] hover:shadow-sm transition-shadow"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[color:var(--color-ink)] line-clamp-2 leading-tight">
                      {p.name}
                    </div>
                    <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
                      {p.code ? `Cód ${p.code}` : ''}
                      {p.line ? ` · ${p.line}` : ''}
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="var(--color-muted)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="flex-shrink-0 ml-3"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
          {all.length > MAX_VISIBLE && !search ? (
            <p className="text-xs text-[color:var(--color-muted)] mt-3 text-center">
              Mostrando {MAX_VISIBLE} de {all.length}. Use a busca pra filtrar.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
