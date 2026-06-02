// ProfileHeader — bloco escuro com avatar + nome + stats no topo de /perfil.
// Replica o estilo do vanilla (index.html #screen-myprofile + head.js
// loadMyProfileData) o mais próximo possível:
//   - ring colorido no avatar (gradient conic);
//   - fallback chain pro nome: profile.name → user_metadata.name →
//     email username → 'Seu Nome' (vanilla head.js linha 789);
//   - normaliza nome (underscores → espaços, capitaliza palavras);
//   - stats reais (posts/seguidores/seguindo) via DB.posts/DB.follows
//     em paralelo (vanilla loadMyProfileStats linha 845);
//   - 3 botões (Editar / Compartilhar / Sair);
//   - banner PRO escuro/vermelho.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { Avatar } from '@/components/Avatar';
import { DB } from '@/lib/db';
import { showToast } from '@/lib/toast';

// Normaliza nome no estilo do vanilla (head.js linha 790-791):
// remove "@..." se vier email-like, troca underscore por espaço,
// capitaliza inícios de palavras.
function normalizeName(raw: string): string {
  if (!raw) return '';
  let n = raw;
  if (n.includes('@')) n = n.split('@')[0] || n;
  n = n.replace(/_/g, ' ');
  return n.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Stats {
  posts: number;
  followers: number;
  following: number;
}

export function ProfileHeader() {
  const { signOut, user } = useAuth();
  const { profile } = useProfile();

  const [stats, setStats] = useState<Stats>({ posts: 0, followers: 0, following: 0 });
  // Fallback do avatar via profiles_public (mesma fonte que o feed usa pra
  // mostrar Jackson Matos no header do post). Se `useProfile().avatar_url`
  // vier null mas a view tiver a URL, usa ela. Resolve o caso em que a
  // tabela `profiles` direto retorna avatar_url null por algum motivo
  // (RLS, cache stale, ou row antiga sem o campo populado mas o sync
  // trigger só popula em UPDATE).
  const [publicAvatar, setPublicAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    Promise.all([
      DB.posts.countByUser(user.id),
      DB.follows.countFollowers(user.id),
      DB.follows.countFollowing(user.id),
      DB.profiles.getMany([user.id], 'id, avatar_url'),
    ])
      .then(([posts, followers, following, pubProfs]) => {
        if (cancel) return;
        setStats({ posts, followers, following });
        const pub = pubProfs?.[0];
        if (pub?.avatar_url) setPublicAvatar(pub.avatar_url);
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      cancel = true;
    };
  }, [user]);

  // Fallback chain pra nome (vanilla head.js linha 789).
  const meta = (user?.user_metadata as Record<string, unknown> | undefined) ?? {};
  const metaName = meta['name'] as string | undefined;
  const emailUsername = user?.email?.split('@')[0];
  const rawName = profile?.name || metaName || emailUsername || '';
  const name = normalizeName(rawName) || 'Seu Nome';
  const hasName = !!(profile?.name || metaName);

  // Fallback chain pro avatar:
  //   1. profile.avatar_url (tabela profiles direto via useProfile)
  //   2. publicAvatar (profiles_public via DB.profiles.getMany — view safe
  //      que o feed também usa pra renderizar avatares)
  //   3. user_metadata.avatar_url (signup OAuth Google/Facebook)
  //   4. user_metadata.picture (Google)
  const metaAvatar =
    (meta['avatar_url'] as string | undefined) ||
    (meta['picture'] as string | undefined) ||
    null;
  const effectiveAvatar =
    profile?.avatar_url || publicAvatar || metaAvatar || null;

  const subtitle = hasName
    ? profile?.tag
      ? '@' + profile.tag
      : ''
    : 'Configure seu perfil';
  const isPro = !!profile?.is_pro;
  // Grace period: 3 dias após falha de pagamento. Backend usa
  // pro_grace_until — se NULL/passado, plano caducou. Se futuro, ainda
  // tem PRO mas com aviso (vanilla mostra banner amarelo).
  const graceUntil = (profile as { pro_grace_until?: string | null } | null)
    ?.pro_grace_until;
  const inGrace =
    isPro && graceUntil ? new Date(graceUntil).getTime() > Date.now() : false;
  const graceDays = inGrace && graceUntil
    ? Math.max(
        0,
        Math.ceil(
          (new Date(graceUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        ),
      )
    : 0;

  async function handleLogout() {
    if (!window.confirm('Deseja sair da conta?')) return;
    await signOut();
    window.location.href = '/login';
  }

  return (
    <>
      {/* Bloco header dark */}
      <div
        className="px-4 pt-5 pb-5"
        style={{
          background: 'var(--color-ink)',
          color: '#fff',
        }}
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
              <Avatar
                profile={{
                  id: profile?.id ?? user?.id ?? '',
                  name: profile?.name ?? name,
                  tag: profile?.tag ?? null,
                  // Usa effectiveAvatar (já contempla user_metadata se profile
                  // não tiver avatar_url no banco).
                  avatar_url: effectiveAvatar,
                }}
                size={70}
              />
            </div>
          </div>

          <div className="flex-1 flex items-center justify-around">
            <StatBlock value={stats.posts} label="posts" />
            <StatBlock value={stats.followers} label="seguidores" />
            <StatBlock value={stats.following} label="seguindo" />
          </div>
        </div>

        <div className="mt-3">
          <div
            className="font-extrabold text-xl flex items-center gap-1.5"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {name}
            {isPro ? (
              <span
                aria-label="Perfil verificado"
                title="Perfil verificado"
                className="inline-flex items-center justify-center"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#1d9bf0',
                  flexShrink: 0,
                }}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : null}
          </div>
          {subtitle && (
            <div className="text-sm text-white/70">{subtitle}</div>
          )}
        </div>

        <div className="mt-3.5 flex gap-2">
          <Link
            href="/perfil/editar"
            className="flex-1 text-center py-2.5 rounded-xl text-sm font-bold"
            style={{
              background: 'rgba(255,255,255,.13)',
              color: '#fff',
            }}
          >
            Editar perfil
          </Link>
          <button
            type="button"
            onClick={async () => {
              // URL pública: /perfil/<id>. Aceita tag também, mas id sempre
              // resolve. Antes ia pra /profissional/<tag> que não existe
              // (rota não foi portada — quebrava todos os shares).
              const slug = user?.id || profile?.tag;
              if (!slug) {
                showToast('Configure o perfil antes de compartilhar', 'info');
                return;
              }
              const url = `${window.location.origin}/perfil/${slug}`;
              if (typeof navigator !== 'undefined' && navigator.share) {
                try {
                  await navigator.share({ title: name, url });
                  return;
                } catch (e) {
                  if ((e as Error).name === 'AbortError') return;
                  // continua pro clipboard fallback
                }
              }
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                try {
                  await navigator.clipboard.writeText(url);
                  showToast('Link copiado!', 'success');
                } catch {
                  showToast('Erro ao copiar', 'error');
                }
              }
            }}
            className="flex-1 text-center py-2.5 rounded-xl text-sm font-bold"
            style={{
              background: 'rgba(255,255,255,.13)',
              color: '#fff',
            }}
          >
            Compartilhar
          </button>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sair"
            className="w-11 flex items-center justify-center rounded-xl"
            style={{
              background: 'rgba(230,57,70,.18)',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e63946" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Banner de grace period: user PRO com pagamento falho, ainda
          dentro dos 3 dias de tolerância (pro_grace_until > now()). */}
      {inGrace ? (
        <div className="px-3.5 pt-3">
          <Link
            href="/pro"
            className="block rounded-2xl p-4 shadow-md"
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#fff',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                style={{ background: 'rgba(255,255,255,.2)' }}
              >
                ⚠️
              </div>
              <div className="flex-1">
                <div
                  className="font-extrabold text-sm"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Renove seu PRO em {graceDays} {graceDays === 1 ? 'dia' : 'dias'}
                </div>
                <div className="text-xs text-white/85 mt-0.5">
                  Pagamento não confirmado — atualize antes que as features sejam bloqueadas
                </div>
              </div>
              <div className="text-xl text-white/80">›</div>
            </div>
          </Link>
        </div>
      ) : null}

      {!isPro && (
        <div className="px-3.5 pt-3">
          <Link
            href="/pro"
            className="block rounded-2xl p-4 shadow-md"
            style={{
              background: 'linear-gradient(135deg, #4a1a1f, #2d0f12)',
              color: '#fff',
              border: '1px solid rgba(230,57,70,.3)',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                style={{
                  background: 'linear-gradient(135deg, var(--color-p1), #ff8a4e)',
                }}
              >
                ⚡
              </div>
              <div className="flex-1">
                <div
                  className="font-extrabold text-sm"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Ative o Plano PRO
                </div>
                <div className="text-xs text-white/75 mt-0.5">
                  Destaque-se e receba mais clientes · R$ 39/mês
                </div>
              </div>
              <div className="text-xl text-white/60">›</div>
            </div>
          </Link>
        </div>
      )}
    </>
  );
}

function StatBlock({ value, label }: { value: number; label: string }) {
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
