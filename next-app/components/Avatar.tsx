// Avatar — componente reusável que renderiza o avatar de um Profile.
// Substitui o helper `avatarImgTag(prof, size)` do vanilla (app.js) por um
// componente React tipado:
//   - se o profile tem `avatar_url`, mostra <img> (com onError pra fallback);
//   - senão, mostra placeholder com inicial do nome em background colorido
//     (mesmo padrão do vanilla — letra branca em fundo escuro, círculo).
//
// Sem `next/image` por enquanto: avatar é normalmente CDN externo do Supabase
// (ou Cloudflare R2), e setar `next/image` com `unoptimized` perde valor.
// Quando tivermos um pipeline de otimização (cfImg helper portado), trocamos.

'use client';

import { useState } from 'react';
import type { Profile } from '@/lib/types';

export interface AvatarProps {
  profile: Pick<Profile, 'id' | 'name' | 'tag' | 'avatar_url'> | null | undefined;
  // Tamanho em px. Default 40 — bate com o tamanho do header do post no feed.
  size?: number;
  // Classe adicional pra layout (ex.: `flex-shrink-0`).
  className?: string;
}

// Cores de fallback — paleta do app (var(--p1..p5)). Função determinística:
// mesmo nome → mesma cor sempre, sem precisar de hashStr ainda.
const FALLBACK_COLORS = ['#ef6c2b', '#3b82f6', '#10b981', '#a855f7', '#f59e0b'];

function colorFor(seed: string): string {
  if (!seed) return FALLBACK_COLORS[0]!;
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length]!;
}

function initialOf(profile: AvatarProps['profile']): string {
  if (!profile) return '?';
  const src = profile.name || profile.tag || '?';
  const first = src.trim().charAt(0).toUpperCase();
  return first || '?';
}

export function Avatar({ profile, size = 40, className = '' }: AvatarProps) {
  // Local state pra controlar fallback quando a img estoura (URL quebrada,
  // 403, etc.). Sem estado, browser deixa o broken-image ícone aparecer.
  const [imgError, setImgError] = useState(false);
  const url = profile?.avatar_url ?? null;
  const showImg = !!url && !imgError;
  const dim = `${size}px`;

  if (showImg) {
    return (
      <img
        src={url}
        alt={profile?.name ?? profile?.tag ?? 'Avatar'}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setImgError(true)}
        className={`rounded-full object-cover ${className}`}
        style={{ width: dim, height: dim }}
      />
    );
  }

  const initial = initialOf(profile);
  const bg = colorFor(profile?.id ?? profile?.tag ?? profile?.name ?? '?');
  return (
    <span
      className={`rounded-full inline-flex items-center justify-center text-white font-bold ${className}`}
      style={{
        width: dim,
        height: dim,
        backgroundColor: bg,
        fontSize: Math.round(size * 0.45),
      }}
      aria-label={profile?.name ?? profile?.tag ?? 'Avatar'}
    >
      {initial}
    </span>
  );
}
