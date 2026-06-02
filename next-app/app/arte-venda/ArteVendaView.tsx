'use client';
// ArteVendaView — feature do role `grafiteiro`. Lista artes que o user já
// publicou com `posts.for_sale=true` (a tabela posts JÁ tem as colunas
// for_sale/price/art_type — Composer já grava nesse shape). Permite republicar
// ou apagar uma listagem (soft delete via deletePost) e tem CTA pra publicar
// nova (deep link pro /publicar com forSale pré-marcado).
//
// Por que reutilizar `posts` em vez de criar tabela `art_listings`:
// - posts.for_sale + posts.price + posts.art_type já existem no schema;
// - Composer.tsx já fluxo de publicação tem o toggle "Pra venda";
// - Aparecer no feed normal (com badge "À venda") já dá visibilidade SEM
//   precisar de marketplace separado. Quem quiser comprar, fala pelo chat
//   (botão Orçar já adapta o fluxo).

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { getSupabase } from '@/lib/supabase';
import { showToast } from '@/lib/toast';

interface ArtListing {
  id: string;
  caption: string | null;
  media_url: string | null;
  price: number | null;
  art_type: string | null;
  status: string | null;
  created_at: string;
}

async function fetchMyArtListings(userId: string): Promise<ArtListing[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('posts')
    .select('id, caption, media_url, price, art_type, status, created_at')
    .eq('user_id', userId)
    .eq('for_sale', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ArtListing[];
}

export function ArteVendaView() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const dialog = useDialog();
  const userId = user?.id ?? '';

  const query = useQuery<ArtListing[], Error>({
    queryKey: ['art-listings', userId],
    queryFn: () => fetchMyArtListings(userId),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const total = useMemo(
    () => (query.data ?? []).reduce((acc, a) => acc + (a.price || 0), 0),
    [query.data],
  );

  async function handleDelete(postId: string) {
    if (!user) return;
    const ok = await dialog.confirm('Tirar essa arte da venda?', {
      title: 'Remover arte',
      okLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      const { deletePost } = await import('@/lib/services/postInteractions');
      await deletePost(user.id, postId);
      showToast('Arte removida da venda', 'success');
      qc.invalidateQueries({ queryKey: ['art-listings', userId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    } catch (e) {
      showToast((e as Error).message || 'Erro ao remover', 'error');
    }
  }

  const listings = query.data ?? [];

  return (
    <div className="px-1 pb-4">
      <h2
        className="font-extrabold"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          marginBottom: 4,
          color: 'var(--color-ink)',
        }}
      >
        🎨 Arte pra venda
      </h2>
      <p
        style={{
          fontSize: 12,
          color: 'var(--color-muted)',
          marginBottom: 14,
        }}
      >
        Suas artes publicadas como "à venda". Aparecem no feed com badge de preço.
      </p>

      {/* Resumo */}
      <div
        className="text-white"
        style={{
          background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
          borderRadius: 14,
          padding: 16,
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: '.5px' }}>
            CATÁLOGO ATUAL
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              lineHeight: 1,
            }}
          >
            {listings.length} {listings.length === 1 ? 'arte' : 'artes'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: '.5px' }}>
            VALOR TOTAL
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
            }}
          >
            R$ {total.toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      <Link
        href="/publicar?forSale=1"
        className="block w-full text-white font-bold text-center"
        style={{
          padding: 13,
          background: 'var(--color-ink)',
          borderRadius: 12,
          fontSize: 14,
          marginBottom: 16,
          textDecoration: 'none',
        }}
      >
        + Publicar nova arte
      </Link>

      {query.isLoading ? (
        <p className="text-center text-sm text-[color:var(--color-muted)] py-6">
          Carregando…
        </p>
      ) : listings.length === 0 ? (
        <div
          className="bg-white text-center"
          style={{
            borderRadius: 14,
            padding: 22,
            boxShadow: '0 2px 8px rgba(0,0,0,.05)',
          }}
        >
          <div className="text-3xl mb-2">🖼️</div>
          <div className="font-bold" style={{ fontSize: 14, color: 'var(--color-ink)' }}>
            Sem artes à venda
          </div>
          <div className="mt-1" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            Toque em &quot;Publicar nova arte&quot; e marque &quot;Pra venda&quot;
            no Composer.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {listings.map((a) => (
            <article
              key={a.id}
              className="bg-white relative"
              style={{
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: '0 1px 6px rgba(0,0,0,.06)',
              }}
            >
              <Link href={`/?post=${a.id}`} style={{ display: 'block' }}>
                <div
                  style={{
                    aspectRatio: '1 / 1',
                    background: 'var(--color-bg)',
                    backgroundImage: a.media_url ? `url('${a.media_url}')` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              </Link>
              <div style={{ padding: 10 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: 'var(--color-p1)',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  R$ {(a.price || 0).toLocaleString('pt-BR')}
                </div>
                {a.art_type ? (
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--color-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '.5px',
                      marginTop: 2,
                    }}
                  >
                    {a.art_type}
                  </div>
                ) : null}
                {a.caption ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-ink)',
                      marginTop: 4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {a.caption}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  className="font-bold"
                  style={{
                    color: 'var(--color-danger)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: 0,
                    marginTop: 6,
                  }}
                >
                  Tirar da venda
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
