'use client';
// CompleteProfileForm — onboarding pós-OAuth (Google/Apple). Quem loga social
// cai aqui (redirectTo do signInWithOAuth). Se o perfil já está completo
// (tem categoria + @tag), manda direto pro /feed. Senão, pede o mínimo pra
// usar o app: categoria, nome e @tag (cidade/UF opcionais).
//
// Por que existe: o /perfil/editar deixa a @tag readonly e não tem seletor de
// categoria — então não serve pra completar uma conta criada via OAuth (que
// nasce sem user_type nem tag). Aqui esses campos são editáveis uma vez.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { checkTagAvailability } from '@/lib/services/signup';
import { tagSchema } from '@/lib/schemas';
import type { UserRole } from '@/lib/types';

interface RoleOption {
  value: UserRole;
  icon: string;
  label: string;
}

// Mesmas categorias do SignupStep1.
const ROLES: RoleOption[] = [
  { value: 'pintor', icon: '🖌️', label: 'Pintor' },
  { value: 'grafiteiro', icon: '🎨', label: 'Grafiteiro / Muralista' },
  { value: 'automotivo', icon: '🚗', label: 'Estética Automotiva' },
  { value: 'cliente', icon: '🏠', label: 'Cliente' },
];

function isComplete(profile: { user_type?: unknown; role?: unknown; tag?: unknown; username?: unknown } | null): boolean {
  if (!profile) return false;
  const hasCategory = !!(profile.user_type || profile.role);
  const hasTag = !!(profile.tag || profile.username);
  return hasCategory && hasTag;
}

export function CompleteProfileForm() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, update, isUpdating } = useProfile();

  const [category, setCategory] = useState<UserRole>('pintor');
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [city, setCity] = useState('');
  const [uf, setUf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkingTag, setCheckingTag] = useState(false);

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const metaName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    '';
  const metaAvatar =
    (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
    (typeof meta.picture === 'string' && meta.picture) ||
    '';

  const ready = !authLoading && !profileLoading;
  const complete = useMemo(() => isComplete(profile), [profile]);

  // Prefill do nome (do perfil ou dos metadados do provedor) uma vez.
  useEffect(() => {
    if (ready && !name) {
      const initial = (profile?.name || metaName || '').toString();
      if (initial) setName(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, profile?.name, metaName]);

  // Roteamento: sem sessão → login; perfil já completo → feed.
  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (complete) {
      router.replace('/feed');
    }
  }, [ready, user, complete, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nm = name.trim();
    if (nm.length < 2) {
      setError('Informe seu nome.');
      return;
    }
    const parsed = tagSchema.safeParse(tag);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || '@ inválido.');
      return;
    }
    const normalizedTag = parsed.data;

    setCheckingTag(true);
    const available = await checkTagAvailability(normalizedTag);
    setCheckingTag(false);
    if (!available) {
      setError('Esse @ já está em uso. Escolha outro.');
      return;
    }

    try {
      await update({
        user_type: category,
        name: nm,
        tag: normalizedTag,
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(uf.trim() ? { state: uf.trim().toUpperCase() } : {}),
        // Aproveita o avatar do provedor se o perfil ainda não tem um.
        ...(metaAvatar && !profile?.avatar_url ? { avatar_url: metaAvatar } : {}),
      });
      router.replace('/feed');
      router.refresh();
    } catch (err) {
      setError(
        (err as Error)?.message ||
          'Não foi possível salvar. Tente de novo em instantes.',
      );
    }
  }

  // Enquanto resolve auth/perfil ou está redirecionando (sem user / completo),
  // mostra estado neutro pra não piscar o form.
  if (!ready || !user || complete) {
    return (
      <p className="text-center text-sm text-[color:var(--color-muted)] py-8">
        Carregando…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <h2
          className="font-extrabold text-[color:var(--color-ink)]"
          style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginBottom: 6 }}
        >
          Falta pouco 🎨
        </h2>
        <p className="text-[color:var(--color-muted)]" style={{ fontSize: 14 }}>
          Complete seu perfil pra começar a usar o QueroUmaCor.
        </p>
      </div>

      {/* Categoria */}
      <div>
        <label className="block text-sm font-semibold mb-2 text-[color:var(--color-ink)]">
          Você é…
        </label>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Categoria">
          {ROLES.map((r) => {
            const active = r.value === category;
            return (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(r.value)}
                className={
                  'text-left p-3 rounded-xl border-2 transition-colors ' +
                  (active
                    ? 'border-[color:var(--color-p1)] bg-[color:var(--color-p1)]/5'
                    : 'border-[color:var(--color-border)] bg-white hover:border-[color:var(--color-p1)]/40')
                }
              >
                <div className="text-2xl mb-1" aria-hidden="true">
                  {r.icon}
                </div>
                <div className="text-sm font-bold text-[color:var(--color-ink)]">
                  {r.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nome */}
      <div>
        <label htmlFor="cp-name" className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]">
          Nome
        </label>
        <input
          id="cp-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome"
          className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
        />
      </div>

      {/* @tag */}
      <div>
        <label htmlFor="cp-tag" className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]">
          Seu @ (nome de usuário)
        </label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[color:var(--color-muted)]">
            @
          </span>
          <input
            id="cp-tag"
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value.replace(/^@+/, '').toLowerCase())}
            placeholder="seu_nome"
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full pl-8 pr-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
          />
        </div>
        <p className="text-xs text-[color:var(--color-muted)] mt-1">
          Letras minúsculas, números e _ (3 a 24 caracteres). Não pode ser alterado depois.
        </p>
      </div>

      {/* Cidade / UF (opcionais) */}
      <div className="grid grid-cols-[1fr_88px] gap-3">
        <div>
          <label htmlFor="cp-city" className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]">
            Cidade <span className="font-normal text-[color:var(--color-muted)]">(opcional)</span>
          </label>
          <input
            id="cp-city"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Sua cidade"
            className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
          />
        </div>
        <div>
          <label htmlFor="cp-uf" className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]">
            UF
          </label>
          <input
            id="cp-uf"
            type="text"
            value={uf}
            maxLength={2}
            onChange={(e) => setUf(e.target.value.toUpperCase())}
            placeholder="SP"
            className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors uppercase"
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="text-sm text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10 px-3 py-2 rounded-lg"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isUpdating || checkingTag}
        className="w-full bg-[color:var(--color-p1)] text-white font-bold text-base hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        style={{ padding: 15, borderRadius: 14 }}
      >
        {isUpdating || checkingTag ? 'Salvando…' : 'Concluir cadastro'}
      </button>
    </form>
  );
}
