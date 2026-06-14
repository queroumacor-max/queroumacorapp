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
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { ProfileLinks } from '@/components/ProfileLinks';
import { OrcamentoSheet } from '@/components/OrcamentoSheet';
import { DB } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';
import { useFollowing, followingQueryKey } from '@/lib/hooks/useFollowing';
import { buildDirectConvId } from '@/lib/services/chat-types';
import { listQuals, listCourses, type Qualification, type Course } from '@/lib/services/formacao';
import { listPainterReviews, type PainterReview } from '@/lib/services/reviews';
import type { Profile } from '@/lib/types';

// Roles considerados "profissionais" — habilitam CTA de orçamento, seção de
// avaliações e o selo de raio de atendimento. Cliente comum não vê.
const PRO_ROLES = new Set(['pintor', 'grafiteiro', 'automotivo', 'funileiro']);

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
  'id, name, tag, avatar_url, role, user_type, city, state, bio, is_pro, ' +
  'verified, profession, specialties, rating_avg, review_count, service_radius, ' +
  'instagram_url, website_url, followers_count, following_count, posts_count';

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
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [reviews, setReviews] = useState<PainterReview[]>([]);
  const [orcOpen, setOrcOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
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
        const prof = data as unknown as Profile;
        setProfile(prof);
        // Stats lidos direto das colunas desnormalizadas (mantidas por
        // triggers) — sem COUNT(*). O delta otimista do follow opera por cima.
        setStats({
          posts: prof.posts_count ?? 0,
          followers: prof.followers_count ?? 0,
          following: prof.following_count ?? 0,
        });
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
    const targetId = profile.id;
    const isProfessional = PRO_ROLES.has(String(profile.role ?? '').toLowerCase());
    let cancel = false;
    const sb = getSupabase();
    // Stats já vêm das colunas do profile (efeito acima). Aqui: portfólio +
    // formação (qualificações/cursos) + avaliações (só pra profissional).
    void (async () => {
      try {
        const [portRes, qualsRes, coursesRes, reviewsRes] = await Promise.all([
          sb
            .from('posts')
            .select('id, media_url, media_type, caption')
            .eq('user_id', targetId)
            .neq('media_type', 'story')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(30),
          listQuals(targetId).catch(() => [] as Qualification[]),
          listCourses(targetId).catch(() => [] as Course[]),
          isProfessional
            ? listPainterReviews(targetId, 20).catch(() => [] as PainterReview[])
            : Promise.resolve([] as PainterReview[]),
        ]);
        if (cancel) return;
        setPortfolio((portRes.data as PortfolioPost[] | null) ?? []);
        setQuals(qualsRes);
        setCourses(coursesRes);
        setReviews(reviewsRes);
      } catch {
        /* silent */
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

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
  // Selo azul: contas oficiais (verified) OU PRO — mesmo critério do feed.
  const isVerified = !!profile?.verified || isPro;
  const profession = (profile?.profession ?? '').trim();
  const specialties = (profile?.specialties ?? '').trim();
  const ratingAvg = Number(profile?.rating_avg ?? 0);
  const reviewCount = Number(profile?.review_count ?? 0);
  const serviceRadius = Number(profile?.service_radius ?? 0);
  const isProfessional = PRO_ROLES.has(String(role ?? '').toLowerCase());
  const canMessage = !!user && !isOwn && !!profile?.id;

  function handleMessage() {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!profile?.id) return;
    router.push(`/chat/${encodeURIComponent(buildDirectConvId(user.id, profile.id))}`);
  }

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
              {/* Selo azul: verified (contas oficiais) OU is_pro — mesmo
                  critério do feed (PostCard), pra consistência. */}
              {isVerified ? (
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
          {(profession || role) || city || state ? (
            <div className="text-xs text-white/60 mt-1">
              {(() => {
                const prof = profession || (role ? role.charAt(0).toUpperCase() + role.slice(1) : '');
                return prof;
              })()}
              {(profession || role) && (city || state) ? ' · ' : ''}
              {[city, state].filter(Boolean).join(', ')}
            </div>
          ) : null}
          {/* ⭐ nota + nº de avaliações (rating_avg/review_count mantidos por trigger) */}
          {reviewCount > 0 ? (
            <div className="text-xs mt-1 flex items-center gap-1" style={{ color: '#ffd166' }}>
              <span aria-hidden="true">★</span>
              <span className="font-bold">{ratingAvg.toFixed(1)}</span>
              <span className="text-white/55">
                · {reviewCount} {reviewCount === 1 ? 'avaliação' : 'avaliações'}
              </span>
            </div>
          ) : null}
          {specialties ? (
            <div className="text-[11px] text-white/55 mt-1">{specialties}</div>
          ) : null}
          {isProfessional && serviceRadius > 0 ? (
            <div className="text-[11px] text-white/55 mt-1">
              📍 Atende num raio de ~{serviceRadius} km
            </div>
          ) : null}
          <ProfileLinks
            instagramUrl={profile?.instagram_url ?? null}
            websiteUrl={profile?.website_url ?? null}
          />
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
                // ?ref=<userId> usa o id do PERFIL VISTO (o dono dessa página)
                // como referrer — quem clicar e se cadastrar fica indicado por ele.
                const refQ = profile?.id ? `?ref=${encodeURIComponent(profile.id)}` : '';
                void navigator.share({
                  title: name,
                  url: `${window.location.origin}/perfil/${profile.tag}${refQ}`,
                });
              }
            }}
            className="flex-1 text-center py-2.5 rounded-xl text-sm font-bold"
            style={{ background: 'rgba(255,255,255,.13)', color: '#fff' }}
          >
            Compartilhar
          </button>
        </div>

        {/* CTA de mensagem + orçamento (perfil de profissional, não-próprio) */}
        {!isOwn ? (
          <div className="mt-2 flex gap-2">
            {canMessage ? (
              <button
                type="button"
                onClick={handleMessage}
                className="flex-1 text-center py-2.5 rounded-xl text-sm font-bold"
                style={{ background: 'rgba(255,255,255,.13)', color: '#fff' }}
              >
                💬 Mensagem
              </button>
            ) : null}
            {isProfessional ? (
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    router.push('/login');
                    return;
                  }
                  setOrcOpen(true);
                }}
                className="flex-1 text-center py-2.5 rounded-xl text-sm font-extrabold"
                style={{ background: 'var(--color-p1)', color: '#fff' }}
              >
                📋 Pedir orçamento
              </button>
            ) : null}
          </div>
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
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {portfolio.map((p) => (
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
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Formação: qualificações + cursos (read-only). qualifications/courses
          são legíveis por qualquer logado (RLS Wave 3), então o visitante vê. */}
      {!loading && (quals.length > 0 || courses.length > 0) ? (
        <FormacaoSection quals={quals} courses={courses} />
      ) : null}

      {/* Avaliações do pintor (via RPC get_painter_reviews) */}
      {!loading && isProfessional && reviews.length > 0 ? (
        <ReviewsSection reviews={reviews} />
      ) : null}

      {isProfessional && profile?.id ? (
        <OrcamentoSheet
          open={orcOpen}
          onClose={() => setOrcOpen(false)}
          painterId={profile.id}
          painterName={name}
          postId={null}
        />
      ) : null}
    </>
  );
}

function FormacaoSection({ quals, courses }: { quals: Qualification[]; courses: Course[] }) {
  return (
    <div className="px-3.5 pt-2 pb-2">
      <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
        Formação
      </div>
      <div className="flex flex-col gap-2">
        {quals.map((q) => (
          <div
            key={q.id}
            className="bg-white rounded-xl px-3 py-2.5 flex items-center gap-3"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}
          >
            <span aria-hidden="true" style={{ fontSize: 20 }}>{q.icon || '🎓'}</span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-[color:var(--color-ink)] truncate">{q.title}</div>
              <div className="text-xs text-[color:var(--color-muted)] truncate">
                {[q.org, q.year ? String(q.year) : null].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        ))}
        {courses.map((c) => (
          <div
            key={c.id}
            className="bg-white rounded-xl px-3 py-2.5 flex items-center gap-3"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}
          >
            <span aria-hidden="true" style={{ fontSize: 20 }}>📚</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[color:var(--color-ink)] truncate">{c.title}</div>
              {c.subtitle ? (
                <div className="text-xs text-[color:var(--color-muted)] truncate">{c.subtitle}</div>
              ) : null}
            </div>
            {c.link ? (
              <a
                href={/^https?:\/\//i.test(c.link) ? c.link : `https://${c.link}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold flex-shrink-0"
                style={{ color: 'var(--color-p1)' }}
              >
                ver ›
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewsSection({ reviews }: { reviews: PainterReview[] }) {
  return (
    <div className="px-3.5 pt-2 pb-6">
      <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
        Avaliações
      </div>
      <div className="flex flex-col gap-2">
        {reviews.map((r) => (
          <div
            key={r.id}
            className="bg-white rounded-xl px-3.5 py-3"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-bold text-[color:var(--color-ink)] truncate">
                {r.reviewer_name || 'Cliente'}
              </div>
              <div aria-label={`${r.rating} de 5`} style={{ color: '#f4a300', fontSize: 13, letterSpacing: 1 }}>
                {'★'.repeat(Math.max(0, Math.min(5, r.rating)))}
                <span style={{ color: 'var(--color-border)' }}>
                  {'★'.repeat(5 - Math.max(0, Math.min(5, r.rating)))}
                </span>
              </div>
            </div>
            {r.comment ? (
              <p className="text-sm text-[color:var(--color-ink)]" style={{ lineHeight: 1.5 }}>
                {r.comment}
              </p>
            ) : null}
            {r.criteria.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {r.criteria.map((cr, i) => (
                  <span
                    key={i}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--color-cream)', color: 'var(--color-muted)' }}
                  >
                    {cr}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
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
