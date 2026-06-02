// PublicProfileView — perfil público de outro usuário. Resolve id-ou-tag
// pra row de `profiles`, carrega stats + portfolio em paralelo, e mostra
// botão Seguir/Seguindo (otimista) quando o viewer está logado e não é
// o dono do perfil.
//
// Espelha o conteúdo de `openUserProfile()` do vanilla (app.js) +
// renderização de #screen-profile (index.html).
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { DB } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';
import { useFollowing, followingQueryKey } from '@/lib/hooks/useFollowing';
import type { Profile } from '@/lib/types';

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

// UUID v4 detector defensivo — se o param parece UUID, busca por id;
// senão, busca por tag (com ou sem @ prefix).
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// profiles_public NÃO tem coluna `username` (vide CLAUDE.md SQL Wave de
// `profiles.tag`/`username` sync — view projeta só `tag` e `username` é
// virtual). Mantemos `tag` como handle canônico.
const PROFILE_COLS =
  'id, name, tag, avatar_url, role, user_type, city, state, bio, is_pro';

export function PublicProfileView({ idOrTag }: { idOrTag: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  // useFollowing é a source of truth — qualquer follow/unfollow em
  // outro lugar (search, stories carousel) invalida essa cache e
  // o botão aqui atualiza automático sem precisar de refetch local.
  const { ids: followingIds, invalidate: invalidateFollowing } = useFollowing();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileNotFound, setProfileNotFound] = useState(false);
  const [stats, setStats] = useState<Stats>({ posts: 0, followers: 0, following: 0 });
  const [portfolio, setPortfolio] = useState<PortfolioPost[]>([]);
  const [loading, setLoading] = useState(true);
  // Override otimista local. Quando null, deriva do followingIds; quando
  // toggle dispara, seta pra true/false imediato (sem esperar refetch);
  // sucesso da mutation reseta pra null pra o cache assumir de volta.
  const [optimisticFollow, setOptimisticFollow] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  // Estado real do botão: optimistic > cache.
  const isFollowing =
    optimisticFollow !== null
      ? optimisticFollow
      : !!profile && followingIds.includes(profile.id);

  // 1) Resolve idOrTag → profile row.
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setProfileNotFound(false);
    const sb = getSupabase();
    const raw = (idOrTag || '').trim().replace(/^@/, '');
    if (!raw) {
      setLoading(false);
      setProfileNotFound(true);
      return;
    }

    (async () => {
      try {
        const q = UUID_RX.test(raw)
          ? sb.from('profiles_public').select(PROFILE_COLS).eq('id', raw).maybeSingle()
          : sb.from('profiles_public').select(PROFILE_COLS).eq('tag', raw.toLowerCase()).maybeSingle();
        const { data } = await q;
        if (cancel) return;
        if (!data) {
          setProfile(null);
          setProfileNotFound(true);
          return;
        }
        setProfile(data as unknown as Profile);
      } catch {
        if (cancel) return;
        setProfile(null);
        setProfileNotFound(true);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [idOrTag]);

  // 2) Quando temos profile, carrega stats + portfolio em paralelo.
  //    isFollowing NÃO é fetchado aqui — vem do useFollowing cache que é
  //    invalidado por qualquer follow/unfollow no app inteiro (search,
  //    perfil/[id], feed). Antes esse componente bypassava o cache com
  //    DB.follows.isFollowing direto e ficava dessincado da /search.
  useEffect(() => {
    if (!profile?.id) return;
    let cancel = false;
    const sb = getSupabase();
    Promise.all([
      DB.posts.countByUser(profile.id),
      DB.follows.countFollowers(profile.id),
      DB.follows.countFollowing(profile.id),
      sb
        .from('posts')
        .select('id, media_url, media_type, caption')
        .eq('user_id', profile.id)
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
  }, [profile?.id]);

  const isOwn = !!user && !!profile && user.id === profile.id;

  async function toggleFollow() {
    if (!user || !profile || isOwn || followBusy) return;
    setFollowBusy(true);
    const prev = isFollowing;
    // Optimistic override: dispara o estado novo já. Reset pra null
    // depois da invalidate — cache passa a ser a única fonte de verdade.
    setOptimisticFollow(!prev);
    setStats((s) => ({ ...s, followers: s.followers + (prev ? -1 : 1) }));
    const r = prev
      ? await DB.follows.unfollow(user.id, profile.id)
      : await DB.follows.follow(user.id, profile.id);
    if (!r.ok) {
      // Rollback: limpa override pra cache dominar de novo.
      setOptimisticFollow(null);
      setStats((s) => ({ ...s, followers: s.followers + (prev ? 1 : -1) }));
    } else {
      // Sucesso: invalida cache → quando refetch volta, optimistic vira
      // null e o derive isFollowing usa o cache fresco.
      qc.invalidateQueries({ queryKey: followingQueryKey(user.id) });
      invalidateFollowing();
      // Aguarda 1 frame pra cache atualizar antes de limpar o override
      // (evita flicker visível: optimistic → null → re-render → cache).
      setTimeout(() => setOptimisticFollow(null), 200);
    }
    setFollowBusy(false);
  }

  if (profileNotFound) {
    return (
      <div className="px-3.5 pt-12 pb-8 text-center">
        <div className="text-5xl mb-3" aria-hidden="true">🙈</div>
        <h1 className="font-bold text-lg mb-2">Perfil não encontrado</h1>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Esse usuário pode ter saído do app ou o link está errado.
        </p>
        <Link
          href="/search"
          className="inline-block font-bold"
          style={{ color: 'var(--color-p1)' }}
        >
          Voltar para a busca
        </Link>
      </div>
    );
  }

  const name = profile?.name || (profile?.tag ? '@' + profile.tag : 'Usuário');
  const role = profile?.role;
  const city = profile?.city;
  const state = profile?.state;
  const bio = profile?.bio;
  const isPro = !!profile?.is_pro;

  return (
    <>
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
            <div
              className="w-full h-full rounded-full overflow-hidden flex items-center justify-center"
              style={{ background: 'var(--color-ink)', border: '2px solid var(--color-ink)' }}
            >
              <Avatar profile={profile} size={70} />
            </div>
          </div>

          <div className="flex-1 flex items-center justify-around">
            <Stat value={stats.posts} label="posts" />
            <Stat value={stats.followers} label="seguidores" />
            <Stat value={stats.following} label="seguindo" />
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className="font-extrabold flex items-center gap-1.5"
              style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}
            >
              {name}
              {/* Badge verificado (PRO benefit "✓ Badge verificado no perfil"
                  do #pro-modal). Selo azul estilo IG/Twitter pra dar
                  confiança visual em listas e busca. */}
              {isPro ? (
                <span
                  aria-label="Perfil verificado"
                  title="Perfil verificado"
                  className="inline-flex items-center justify-center"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#1d9bf0',
                    flexShrink: 0,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              ) : null}
            </div>
            {isPro ? (
              <span
                className="font-extrabold"
                style={{
                  background:
                    'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
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
          {profile?.tag ? (
            <div className="text-sm text-white/70">@{profile.tag}</div>
          ) : null}
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

        {/* Ações */}
        <div className="mt-3.5 flex gap-2">
          {isOwn ? (
            <Link
              href="/perfil/editar"
              className="flex-1 text-center py-2.5 rounded-xl text-sm font-bold"
              style={{ background: 'rgba(255,255,255,.13)', color: '#fff' }}
            >
              Editar perfil
            </Link>
          ) : (
            <button
              type="button"
              onClick={toggleFollow}
              disabled={followBusy || !user}
              aria-pressed={isFollowing}
              aria-label={isFollowing ? `Deixar de seguir ${name}` : `Seguir ${name}`}
              className="flex-1 text-center py-2.5 rounded-xl text-sm font-bold"
              style={{
                background: isFollowing
                  ? 'rgba(255,255,255,.13)'
                  : 'var(--color-p1)',
                color: '#fff',
                opacity: followBusy ? 0.6 : 1,
                cursor: !user ? 'not-allowed' : 'pointer',
              }}
            >
              {isFollowing ? 'Seguindo' : 'Seguir'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.share && profile?.tag) {
                void navigator.share({
                  title: name,
                  url: `${window.location.origin}/perfil/${profile.tag}`,
                });
              }
            }}
            className="flex-1 text-center py-2.5 rounded-xl text-sm font-bold"
            style={{ background: 'rgba(255,255,255,.13)', color: '#fff' }}
          >
            Compartilhar
          </button>
        </div>
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
