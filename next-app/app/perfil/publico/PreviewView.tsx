// PreviewView — client component que carrega counts em paralelo (posts,
// seguidores, seguindo) + lista de portfólio do user logado e renderiza
// como se fosse o perfil público de outro usuário.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { Avatar } from '@/components/Avatar';
import { DB } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';

interface PortfolioPost {
  id: string;
  media_url: string | null;
  media_type: string | null;
  caption: string | null;
}

interface Stats {
  posts: number;
  followers: number;
  following: number;
}

export function PreviewView() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [stats, setStats] = useState<Stats>({ posts: 0, followers: 0, following: 0 });
  const [portfolio, setPortfolio] = useState<PortfolioPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);

    const sb = getSupabase();
    Promise.all([
      DB.posts.countByUser(user.id),
      DB.follows.countFollowers(user.id),
      DB.follows.countFollowing(user.id),
      sb
        .from('posts')
        .select('id, media_url, media_type, caption')
        .eq('user_id', user.id)
        .neq('media_type', 'story')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(30),
    ])
      .then(([posts, followers, following, portfolioRes]) => {
        if (cancel) return;
        setStats({ posts, followers, following });
        setPortfolio((portfolioRes.data as PortfolioPost[] | null) ?? []);
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => {
      cancel = true;
    };
  }, [user]);

  const name = profile?.name || 'Seu Nome';
  const tag = profile?.tag;
  const role = profile?.role;
  const city = profile?.city;
  const state = profile?.state;
  const bio = profile?.bio;
  const isPro = !!profile?.is_pro;

  return (
    <>
      {/* Top bar: pílula "PREVIEW" + link voltar */}
      <div
        className="flex items-center justify-between"
        style={{
          background: 'var(--color-ink)',
          padding: '12px 16px',
        }}
      >
        <span
          className="font-bold text-white"
          style={{
            fontSize: 11,
            background: 'rgba(255,107,53,.25)',
            padding: '4px 10px',
            borderRadius: 999,
            letterSpacing: '.05em',
          }}
        >
          👁️ PREVIEW DO PERFIL PÚBLICO
        </span>
        <Link
          href="/perfil/editar"
          className="font-bold"
          style={{ color: 'var(--color-p1)', fontSize: 12 }}
        >
          Editar
        </Link>
      </div>

      {/* Header dark com avatar + stats — mesma estrutura do ProfileHeader */}
      <div
        className="px-4 pt-5 pb-5"
        style={{ background: 'var(--color-ink)', color: '#fff' }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-20 h-20 rounded-full p-[3px] flex items-center justify-center flex-shrink-0"
            style={{
              background:
                'conic-gradient(var(--color-p1), var(--color-p4), var(--color-p5), var(--color-p3), var(--color-p1))',
            }}
          >
            <div className="w-full h-full rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
              <Avatar profile={profile} size={68} />
            </div>
          </div>

          <div className="flex-1 flex items-center justify-around">
            <Stat value={stats.posts} label="posts" />
            <Stat value={stats.followers} label="seguidores" />
            <Stat value={stats.following} label="seguindo" />
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-2">
            <div
              className="font-extrabold"
              style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}
            >
              {name}
            </div>
            {isPro ? (
              <span
                className="font-extrabold"
                style={{
                  background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: 999,
                  letterSpacing: '.05em',
                }}
              >
                PRO
              </span>
            ) : null}
          </div>
          {tag ? <div className="text-sm text-white/70">@{tag}</div> : null}
          {role || city || state ? (
            <div className="text-xs text-white/60 mt-1">
              {role ? role.charAt(0).toUpperCase() + role.slice(1) : ''}
              {role && (city || state) ? ' · ' : ''}
              {[city, state].filter(Boolean).join(', ')}
            </div>
          ) : null}
        </div>

        {bio ? (
          <p
            className="mt-3 text-sm text-white/85"
            style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}
          >
            {bio}
          </p>
        ) : null}
      </div>

      <div className="px-3.5 pt-4 pb-2">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Portfólio
        </div>
        {loading ? (
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-[color:var(--color-border)] animate-pulse"
                style={{ aspectRatio: '1 / 1', borderRadius: 8 }}
              />
            ))}
          </div>
        ) : portfolio.length === 0 ? (
          <div
            className="bg-white text-center"
            style={{
              borderRadius: 14,
              padding: 24,
              boxShadow: '0 2px 8px rgba(0,0,0,.05)',
            }}
          >
            <div className="text-3xl mb-2">📸</div>
            <div
              className="font-bold"
              style={{ fontSize: 14, color: 'var(--color-ink)' }}
            >
              Sem trabalhos publicados
            </div>
            <Link
              href="/publicar"
              className="font-bold inline-block mt-2"
              style={{ fontSize: 12, color: 'var(--color-p1)' }}
            >
              + Adicionar trabalho
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {portfolio.map((p) => (
              <div
                key={p.id}
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
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div
        className="text-2xl font-extrabold leading-none"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </div>
      <div className="text-xs text-white/65 mt-1">{label}</div>
    </div>
  );
}
