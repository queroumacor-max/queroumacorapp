'use client';

import { ROLE_OPTIONS } from '@/lib/roles';
// CompleteProfileForm — onboarding pós-OAuth (Google/Apple). Quem loga social
// cai aqui (redirectTo do signInWithOAuth). Se o perfil já está completo
// (tem categoria + @tag), manda direto pro /feed. Senão, pede o mínimo pra
// usar o app: categoria, nome e @tag (cidade/UF opcionais).
//
// Por que existe: o /perfil/editar deixa a @tag readonly e não tem seletor de
// categoria — então não serve pra completar uma conta criada via OAuth (que
// nasce sem user_type nem tag). Aqui esses campos são editáveis uma vez.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { checkTagAvailability } from '@/lib/services/signup';
import { getCidadesByUF } from '@/lib/services/profile';
import {
  tagSchema,
  calculateAge,
  MIN_AGE,
  limparNome,
  limparTag,
  sugerirTagDeNome,
  mascararDataBR,
  dataBRParaISO,
} from '@/lib/schemas';
import type { UserRole } from '@/lib/types';
// Mesma regra usada pelo guard do AppShell — uma definição só de "completo".
import { isProfileComplete } from '@/lib/profileCompletion';

interface RoleOption {
  value: UserRole;
  icon: string;
  label: string;
}

// Mesmas categorias do SignupStep1 — as duas telas leem de `lib/roles`.
// Escritas à mão, elas já tinham divergido: aqui o automotivo aparecia como
// "Estética Automotiva" e lá como "Funileiro / Estética Automotiva".
const ROLES: RoleOption[] = ROLE_OPTIONS.map((o) => ({
  value: o.value as UserRole,
  icon: o.icon,
  label: o.label,
}));

export function CompleteProfileForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, update, isUpdating } = useProfile();

  const [category, setCategory] = useState<UserRole>('pintor');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tag, setTag] = useState('');
  const [uf, setUf] = useState('');
  const [city, setCity] = useState('');
  const [cities, setCities] = useState<string[]>([]);
  const [birthDate, setBirthDate] = useState('');
  // Texto na tela (DD/MM/AAAA); `birthDate` segue guardando ISO.
  const [dataTexto, setDataTexto] = useState('');
  // Sugestão de @ só enquanto a pessoa não mexeu no campo.
  const [tagTocada, setTagTocada] = useState(false);
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
  const complete = useMemo(() => isProfileComplete(profile), [profile]);

  // Prefill de TUDO que já sabemos — uma vez, e sem sobrescrever o que a
  // pessoa já digitou.
  //
  // Por que isso importa (07/09/2026): quem se cadastrou por e-mail já
  // informou nome, telefone, cidade/UF e data de nascimento no passo 2. Se
  // cair aqui (perfil sem @tag, por exemplo), pedir tudo de novo é o relato
  // de "cadastro em duas etapas com informação repetida". Pior: a categoria
  // nascia sempre em 'pintor', então quem se cadastrou como grafiteiro e não
  // reparasse trocava o próprio papel sem querer.
  const preenchido = useRef(false);
  useEffect(() => {
    // Prefill ÚNICO a partir de dado assíncrono (profile do Supabase +
    // user_metadata do OAuth) — não é reset derivado de prop, é
    // sincronização com sistema externo guardada por ref pra rodar 1x.
    if (!ready || preenchido.current) return;
    preenchido.current = true;
    const p = profile as Record<string, unknown> | null | undefined;
    const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

    const inicialNome = texto(p?.name) || metaName;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    if (inicialNome) setName(inicialNome);

    const papel = texto(p?.user_type) || texto(p?.role);
    if (papel && ROLES.some((r) => r.value === papel)) {
      setCategory(papel as UserRole);
    }

    const tel = texto(p?.phone);
    if (tel) setPhone(tel);

    const estado = texto(p?.state).toUpperCase();
    if (estado) setUf(estado);
    const cidade = texto(p?.city);
    if (cidade) setCity(cidade);

    const nasc = texto(p?.birth_date).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(nasc)) {
      setBirthDate(nasc);
      const [a, m, d] = nasc.split('-');
      setDataTexto(`${d}/${m}/${a}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

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

    // Phone é obrigatório
    if (!phone.trim()) {
      setError('Informe seu telefone.');
      return;
    }

    const parsed = tagSchema.safeParse(tag);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || '@ inválido.');
      return;
    }
    const normalizedTag = parsed.data;

    // Age gate 18+ (Apple 1.6 / Google Family) — o cadastro por email já exige;
    // o login social precisa exigir aqui também, senão dá pra burlar a idade.
    if (!birthDate) {
      setError('Informe sua data de nascimento.');
      return;
    }
    const age = calculateAge(birthDate);
    if (age < MIN_AGE) {
      setError(`Você precisa ter ${MIN_AGE} anos ou mais para usar o app.`);
      return;
    }

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
        phone: phone.trim(),
        tag: normalizedTag,
        birth_date: birthDate,
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(uf.trim() ? { state: uf.trim().toUpperCase() } : {}),
        // Aproveita o avatar do provedor se o perfil ainda não tem um.
        ...(metaAvatar && !profile?.avatar_url ? { avatar_url: metaAvatar } : {}),
      });
      // Aguarda o cache refetch completar antes de navegar — senão o AppShell
      // vê perfil ainda incompleto (stale cache) e redireciona de volta
      await qc.refetchQueries({ queryKey: ['profile', user?.id] });
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
          // Só letras: número e símbolo não chegam a aparecer. Mesma regra do
          // cadastro por email (personNameSchema).
          onChange={(e) => {
            const cleaned = limparNome(e.target.value);
            setName(cleaned);
            // Auto-suggest tag based on name if user hasn't manually edited tag yet
            if (!tagTocada && cleaned) {
              const suggested = sugerirTagDeNome(cleaned);
              if (suggested) {
                setTag(suggested);
              }
            }
          }}
          placeholder="Seu nome"
          className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
        />
        <p className="text-xs text-[color:var(--color-muted)] mt-1">
          Só letras — sem números ou símbolos.
        </p>
      </div>

      {/* Telefone (obrigatório) */}
      <div>
        <label htmlFor="cp-phone" className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]">
          Telefone
        </label>
        <input
          id="cp-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(11) 9XXXX-XXXX"
          className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
        />
        <p className="text-xs text-[color:var(--color-muted)] mt-1">
          Número de telefone (obrigatório).
        </p>
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
            onChange={(e) => {
              setTagTocada(true);
              setTag(limparTag(e.target.value));
            }}
            placeholder="seunomedeusuario"
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full pl-8 pr-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
          />
        </div>
        <p className="text-xs text-[color:var(--color-muted)] mt-1">
          Só letras — sem espaço, número ou símbolo (3 a 24). Não pode ser
          alterado depois.
        </p>
        {!tagTocada && !tag && sugerirTagDeNome(name) && (
          <button
            type="button"
            onClick={() => {
              setTagTocada(true);
              setTag(sugerirTagDeNome(name));
            }}
            className="text-xs mt-1 font-semibold text-[color:var(--color-p1)] underline underline-offset-2"
          >
            Usar @{sugerirTagDeNome(name)}
          </button>
        )}
      </div>

      {/* Data de nascimento (obrigatória — age gate 18+, igual ao cadastro
          por email). Sem isso, o login social burlava a verificação de idade. */}
      <div>
        <label htmlFor="cp-birth" className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]">
          Data de nascimento
        </label>
        {/* TEXTO com máscara, não seletor nativo: escolher o ano de
            nascimento rolando décadas é o que travava o cadastro no celular.
            `birthDate` continua em ISO — data incompleta ou inexistente
            (31/02) vira '', e o gate de idade barra. */}
        <input
          id="cp-birth"
          type="text"
          inputMode="numeric"
          placeholder="DD/MM/AAAA"
          maxLength={10}
          value={dataTexto}
          onChange={(e) => {
            const texto = mascararDataBR(e.target.value);
            setDataTexto(texto);
            setBirthDate(dataBRParaISO(texto));
          }}
          className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
        />
        <p className="text-xs text-[color:var(--color-muted)] mt-1">
          É necessário ter {MIN_AGE} anos ou mais para usar o app.
        </p>
      </div>

      {/* Cidade / UF (opcionais) */}
      <div className="grid grid-cols-[1fr_88px] gap-3">
        <div>
          <label htmlFor="cp-city" className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]">
            Cidade <span className="font-normal text-[color:var(--color-muted)]">(opcional)</span>
          </label>
          {cities.length > 0 ? (
            <select
              id="cp-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
            >
              <option value="">Selecione uma cidade</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="cp-city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Selecione um estado primeiro"
              disabled={!uf}
              className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
          )}
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
            onChange={async (e) => {
              const newUf = e.target.value.toUpperCase();
              setUf(newUf);
              if (newUf.length === 2) {
                const cidadesLista = await getCidadesByUF(newUf);
                setCities(cidadesLista);
                setCity('');
              } else {
                setCities([]);
              }
            }}
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

      {/* Saída pro diagnóstico. Existe porque o link do /diag mora no rodapé
          do PERFIL — que fica atrás do mesmo guarda que traz a pessoa pra cá.
          Ou seja: no estado exato que precisa ser diagnosticado, o
          diagnóstico era inalcançável dentro do app. */}
      <p className="text-center" style={{ fontSize: 12 }}>
        <Link
          href="/diag"
          className="underline"
          style={{ color: 'var(--color-muted)' }}
        >
          Caiu aqui de novo? Abrir diagnóstico
        </Link>
      </p>
    </form>
  );
}
