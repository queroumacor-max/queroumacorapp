// ProfileHeader — bloco escuro com avatar + nome + stats no topo de /perfil.
// Replica o estilo do vanilla (index.html `#screen-myprofile` topo).
//
// Stats (posts/seguidores/seguindo) ainda são placeholder — quando o hook
// useProfileStats for portado, plugar aqui.
'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';

export function ProfileHeader() {
  const { user } = useAuth();
  const { profile } = useProfile();

  const name = profile?.name || user?.email?.split('@')[0] || 'Usuário';
  const tag = profile?.tag ? '@' + profile.tag : '';
  const avatarUrl =
    profile?.avatar_url ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;
  const isPro = !!profile?.is_pro;

  return (
    <>
      {/* Bloco header dark */}
      <div
        className="px-4 pt-4 pb-5"
        style={{
          background: 'var(--color-ink)',
          color: '#fff',
        }}
      >
        <div className="flex items-center gap-3.5">
          <div
            className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0"
            style={{ border: '3px solid rgba(255,255,255,.15)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-lg truncate" style={{ fontFamily: 'var(--font-display)' }}>
              {name}
            </div>
            {tag && (
              <div className="text-xs text-white/70 truncate">{tag}</div>
            )}
            <div className="mt-1.5 flex gap-3 text-xs">
              <span><strong>0</strong> <span className="text-white/60">posts</span></span>
              <span><strong>0</strong> <span className="text-white/60">seguidores</span></span>
              <span><strong>0</strong> <span className="text-white/60">seguindo</span></span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Link
            href="/perfil/editar"
            className="flex-1 text-center py-2 rounded-xl text-xs font-bold"
            style={{
              background: 'rgba(255,255,255,.13)',
              color: '#fff',
            }}
          >
            Editar perfil
          </Link>
          <button
            type="button"
            className="flex-1 text-center py-2 rounded-xl text-xs font-bold"
            style={{
              background: 'rgba(255,255,255,.13)',
              color: '#fff',
            }}
          >
            Compartilhar
          </button>
        </div>
      </div>

      {/* Banner PRO (só se não-PRO) */}
      {!isPro && (
        <div className="px-3.5 pt-3">
          <Link
            href="/pro"
            className="block rounded-2xl p-3.5 shadow-md"
            style={{
              background: 'linear-gradient(135deg, var(--color-p1), #ff8a4e)',
              color: '#fff',
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl" style={{ background: 'rgba(255,255,255,.18)' }}>
                ✨
              </div>
              <div className="flex-1">
                <div className="font-extrabold text-sm" style={{ fontFamily: 'var(--font-display)' }}>
                  Ative o Plano PRO
                </div>
                <div className="text-xs text-white/90 mt-0.5">
                  R$ 39/mês — Seu Zé, Arte IG, CRM e mais
                </div>
              </div>
              <div className="text-xl text-white/85">›</div>
            </div>
          </Link>
        </div>
      )}
    </>
  );
}
