// ProfileHeader — bloco escuro com avatar + nome + stats no topo de /perfil.
// Replica o estilo do vanilla (index.html #screen-myprofile) o mais
// próximo possível: ring colorido no avatar, stats vertical (número em
// cima + label embaixo), 3 botões (Editar / Compartilhar / Sair), banner
// PRO escuro/vermelho.
'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';

export function ProfileHeader() {
  const { signOut } = useAuth();
  const { profile } = useProfile();

  const hasName = !!profile?.name;
  const name = profile?.name || 'Seu Nome';
  const subtitle = hasName
    ? profile?.tag
      ? '@' + profile.tag
      : ''
    : 'Configure seu perfil';
  const avatarUrl = profile?.avatar_url || '';
  const isPro = !!profile?.is_pro;

  async function handleLogout() {
    if (!window.confirm('Deseja sair da conta?')) return;
    await signOut();
    window.location.href = '/login';
  }

  return (
    <>
      {/* Bloco header dark — replica visual vanilla */}
      <div
        className="px-4 pt-5 pb-5"
        style={{
          background: 'var(--color-ink)',
          color: '#fff',
        }}
      >
        {/* Linha 1: avatar + stats (3 colunas: posts/seguidores/seguindo) */}
        <div className="flex items-center gap-4">
          <div
            className="w-20 h-20 rounded-full p-[3px] flex items-center justify-center flex-shrink-0"
            style={{
              background:
                'conic-gradient(var(--color-p1), var(--color-p2), var(--color-p3), var(--color-p4), var(--color-p1))',
            }}
          >
            <div className="w-full h-full rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
              {avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={avatarUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
                </svg>
              )}
            </div>
          </div>

          {/* Stats — vertical: número em cima, label embaixo (match vanilla) */}
          <div className="flex-1 flex items-center justify-around">
            <StatBlock value={0} label="posts" />
            <StatBlock value={0} label="seguidores" />
            <StatBlock value={0} label="seguindo" />
          </div>
        </div>

        {/* Linha 2: nome + subtítulo */}
        <div className="mt-3">
          <div
            className="font-extrabold text-xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {name}
          </div>
          {subtitle && (
            <div className="text-sm text-white/70">{subtitle}</div>
          )}
        </div>

        {/* Linha 3: 3 botões (Editar / Compartilhar / Sair) */}
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
            onClick={() => {
              if (navigator.share && profile?.tag) {
                void navigator.share({
                  title: name,
                  url: `${window.location.origin}/profissional/${profile.tag}`,
                });
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

      {/* Banner PRO — só pra quem não é PRO. Dark/vermelho como vanilla. */}
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
