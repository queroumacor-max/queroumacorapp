// PortfolioSection — espelha o `#myprofile-portfolio` do vanilla
// (index.html linha 983+). Lista os posts (não-stories) do próprio user
// em grid 3-col + header com link "+ Adicionar" → /publicar.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';

interface PortfolioPost {
  id: string;
  media_url: string | null;
  media_type: string | null;
  caption: string | null;
}

export function PortfolioSection() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<PortfolioPost[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    const sb = getSupabase();
    sb.from('posts')
      .select('id, media_url, media_type, caption')
      .eq('user_id', user.id)
      .neq('media_type', 'story')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (cancel) return;
        setPosts((data as PortfolioPost[] | null) ?? []);
      })
      .then(undefined, () => {
        if (cancel) return;
        setPosts([]);
      })
      .then(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [user]);

  return (
    <div className="px-3.5 pt-4 pb-2">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)]">
          Meu Portfólio
        </div>
        <Link
          href="/publicar"
          className="font-bold"
          style={{ fontSize: 12, color: 'var(--color-p1)' }}
        >
          + Adicionar
        </Link>
      </div>

      {loading ? (
        <div
          className="grid grid-cols-3 gap-1"
          aria-label="Carregando portfólio"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-[color:var(--color-border)] animate-pulse"
              style={{ aspectRatio: '1 / 1', borderRadius: 8 }}
            />
          ))}
        </div>
      ) : !posts || posts.length === 0 ? (
        <div
          className="bg-white text-center"
          style={{
            borderRadius: 14,
            padding: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,.05)',
          }}
        >
          <div className="text-3xl mb-2" aria-hidden="true">📸</div>
          <div
            className="font-bold"
            style={{ fontSize: 14, color: 'var(--color-ink)' }}
          >
            Sem trabalhos publicados
          </div>
          <div
            className="mt-1"
            style={{ fontSize: 12, color: 'var(--color-muted)' }}
          >
            Toque em + Adicionar pra mostrar seus serviços.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {posts.map((p) => (
            <Link
              key={p.id}
              href={`/post/${p.id}`}
              className="block overflow-hidden bg-[color:var(--color-ink)] relative"
              style={{ aspectRatio: '1 / 1', borderRadius: 8 }}
            >
              {p.media_url ? (
                p.media_type === 'video' ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <video
                    src={p.media_url}
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.media_url}
                    alt={p.caption ?? 'Post'}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                )
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/40 text-xs">
                  sem mídia
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
