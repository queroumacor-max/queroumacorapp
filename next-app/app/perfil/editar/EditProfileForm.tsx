'use client';
// EditProfileForm — porta o modal `#edit-profile-modal` do vanilla (open/
// save EditProfile em modules/profile-edit.js) para um form RHF+Zod sem DOM
// imperativo.
//
// Campos cobertos:
//   - nome, tag (readonly), bio, telefone, email (readonly)
//   - cidade, estado (com autocomplete IBGE via getCidadesByUF)
//   - endereço
//   - avatar (preview via URL.createObjectURL + upload separado)
//
// Decisões:
//  - tag é immutable pós-criação na UI — input fica disabled e o schema NÃO
//    inclui tag no patch enviado pra updateProfile. Mesma postura defensiva
//    do vanilla quando recarrega a row (vanilla deixa o input editável mas o
//    user em produção raramente troca; aqui tornamos o invariante explícito).
//  - email idem: editar email exige flow auth.updateUser, fora do escopo
//    deste form. Input fica readonly informativo.
//  - avatar preview usa URL.createObjectURL + state local — não mutamos DOM.
//    objectURL é revogado no useEffect cleanup pra não vazar memory.
//  - upload do avatar é feito SEPARADO do update do profile: fluxo é
//    uploadAvatar → patch.avatar_url = publicUrl → updateProfile. Se o
//    upload falhar, a UI mostra o erro e NÃO aplica nada (não persiste meio
//    update — comportamento mais previsível que o "best-effort" do vanilla
//    que salvava o resto mesmo se avatar quebrasse).

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { useAutosave } from '@/lib/hooks/useAutosave';
import {
  getCidadesByUF,
  uploadAvatar,
} from '@/lib/services/profile';
import { phoneSchema, requiredField } from '@/lib/schemas';

// Schema dos campos editáveis. Tag e email NÃO entram aqui — são
// readonly/immutable na UI.
const schema = z.object({
  name: requiredField('seu nome').refine((v) => !v.includes('@'), {
    message: 'Não use o email como nome',
  }),
  bio: z
    .string()
    .trim()
    .max(280, 'Bio com no máximo 280 caracteres')
    .optional()
    .or(z.literal('')),
  phone: phoneSchema,
  city: requiredField('sua cidade'),
  state: z
    .string()
    .trim()
    .min(1, 'Informe o estado (UF)')
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z]{2}$/.test(v), { message: 'UF deve ter 2 letras' }),
  address: z
    .string()
    .trim()
    .max(200, 'Endereço com no máximo 200 caracteres')
    .optional()
    .or(z.literal('')),
});

type FormData = z.infer<typeof schema>;

export function EditProfileForm() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading, error, update, isUpdating } = useProfile();

  // Avatar local: arquivo selecionado + preview URL via createObjectURL.
  // Nada é gravado no banco até o submit; até lá só fica em state.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(0);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      bio: '',
      phone: '',
      city: '',
      state: '',
      address: '',
    },
  });

  // Quando o profile chega do servidor, popula o form. reset() em vez de
  // setValue por campo porque RHF marca dirty apenas em mudanças após o
  // reset — assim o usuário só vê "tem mudanças não salvas" se realmente mexer.
  useEffect(() => {
    if (!profile) return;
    reset({
      name: profile.name ?? '',
      bio: profile.bio ?? '',
      phone: profile.phone ?? '',
      city: profile.city ?? '',
      state: (profile.state ?? '').toUpperCase(),
      address: profile.address ?? '',
    });
  }, [profile, reset]);

  // Autosave (UX#6): persiste rascunho a cada 5s em localStorage e
  // restaura no mount. Não cobre avatar (File) nem campos readonly.
  // O onRestore só dispara se já existir draft válido (TTL 7d).
  const watchedValues = watch();
  const autosave = useAutosave<FormData>({
    key: 'profile_edit',
    values: watchedValues as FormData,
    onRestore: (restored) => {
      reset(restored);
    },
  });
  // Trigger UI badge "Rascunho salvo" — react ao lastSavedAt do hook via
  // efeito leve no values.
  useEffect(() => {
    if (autosave.lastSavedAt && autosave.lastSavedAt !== draftSavedAt) {
      setDraftSavedAt(autosave.lastSavedAt);
    }
  }, [watchedValues, autosave.lastSavedAt, draftSavedAt]);

  // Watch state pra disparar o fetch de cidades quando UF muda. Mesmo
  // comportamento do vanilla _epStateChanged + loadCidadesDoEstado.
  const watchState = watch('state');
  const [cidades, setCidades] = useState<string[]>([]);
  useEffect(() => {
    const uf = (watchState || '').trim().toUpperCase();
    if (uf.length !== 2) {
      setCidades([]);
      return;
    }
    let cancelled = false;
    getCidadesByUF(uf).then((arr) => {
      if (!cancelled) setCidades(arr);
    });
    return () => {
      cancelled = true;
    };
  }, [watchState]);

  // Cleanup do objectURL quando trocar o arquivo ou desmontar — sem isso
  // o blob fica no heap até o GC, e em uploads sucessivos vaza.
  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const currentAvatarUrl = useMemo(() => {
    if (avatarPreview) return avatarPreview;
    return profile?.avatar_url ?? null;
  }, [avatarPreview, profile?.avatar_url]);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setAvatarFile(null);
      return;
    }
    if (!f.type.startsWith('image/')) {
      setSubmitError('Selecione um arquivo de imagem');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setSubmitError('Imagem muito grande (máx 5MB)');
      return;
    }
    setSubmitError(null);
    setAvatarFile(f);
  }

  async function onSubmit(data: FormData) {
    if (!user) return;
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      let avatarUrl: string | undefined;
      if (avatarFile) {
        avatarUrl = await uploadAvatar(user.id, avatarFile);
      }

      // bio/address opcionais: enviar string vazia como null pra normalizar
      // no banco (consistente com a coluna nullable).
      await update({
        name: data.name,
        bio: data.bio ? data.bio : null,
        phone: data.phone,
        city: data.city,
        state: data.state,
        address: data.address ? data.address : null,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      });

      setSubmitSuccess(true);
      setAvatarFile(null); // limpa preview pós-save
      // Apaga rascunho pra não restaurar valores antigos no próximo mount.
      autosave.clear();
      setDraftSavedAt(0);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  if (authLoading) {
    return <div className="text-sm text-[color:var(--color-muted)]">Carregando...</div>;
  }

  if (!user) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Entre pra editar seu perfil.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse" aria-label="Carregando perfil">
        <div className="h-10 bg-[color:var(--color-border)] rounded" />
        <div className="h-10 bg-[color:var(--color-border)] rounded" />
        <div className="h-10 bg-[color:var(--color-border)] rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-[color:var(--color-danger)]">
        Não foi possível carregar seu perfil. Recarregue a página.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {/* Avatar + upload */}
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full bg-[color:var(--color-border)] overflow-hidden flex-shrink-0">
          {currentAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentAvatarUrl}
              alt="Sua foto"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl text-[color:var(--color-muted)]">
              {(profile?.name ?? user.email ?? '?').charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-1">
          <label
            htmlFor="avatar-input"
            className="inline-block px-4 py-2 bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded-xl text-sm font-semibold cursor-pointer hover:bg-[color:var(--color-border)] transition-colors"
          >
            Trocar foto
          </label>
          <input
            id="avatar-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <p className="text-xs text-[color:var(--color-muted)] mt-1">
            JPG/PNG/WebP — máx 5MB
          </p>
        </div>
      </div>

      {/* Tag (readonly) — explica por que */}
      <Field id="tag" label="Tag (@)" hint="A tag não pode ser alterada após o cadastro">
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-muted)] font-semibold pointer-events-none"
            aria-hidden="true"
          >
            @
          </span>
          <input
            id="tag"
            type="text"
            value={profile?.tag ?? profile?.username ?? ''}
            disabled
            readOnly
            className={inputClass + ' pl-8 opacity-60 cursor-not-allowed'}
          />
        </div>
      </Field>

      {/* Email readonly (mudança via auth.updateUser fora de escopo) */}
      <Field id="email" label="Email" hint="Pra trocar o email, fale com o suporte">
        <input
          id="email"
          type="email"
          value={profile?.email ?? user.email ?? ''}
          disabled
          readOnly
          className={inputClass + ' opacity-60 cursor-not-allowed'}
        />
      </Field>

      <Field id="name" label="Nome completo" error={errors.name?.message}>
        <input
          id="name"
          type="text"
          autoComplete="name"
          {...register('name')}
          className={inputClass}
          aria-invalid={errors.name ? 'true' : 'false'}
        />
      </Field>

      <Field id="bio" label="Bio (opcional)" error={errors.bio?.message}>
        <textarea
          id="bio"
          rows={3}
          maxLength={280}
          {...register('bio')}
          className={inputClass + ' resize-none'}
          aria-invalid={errors.bio ? 'true' : 'false'}
        />
      </Field>

      <Field id="phone" label="WhatsApp" error={errors.phone?.message}>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="(11) 99999-9999"
          {...register('phone')}
          className={inputClass}
          aria-invalid={errors.phone ? 'true' : 'false'}
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <Field id="state" label="UF" error={errors.state?.message}>
            <input
              id="state"
              type="text"
              maxLength={2}
              autoComplete="address-level1"
              placeholder="SP"
              {...register('state')}
              onChange={(e) => {
                setValue('state', e.target.value.toUpperCase(), { shouldValidate: true, shouldDirty: true });
              }}
              className={inputClass + ' uppercase'}
              aria-invalid={errors.state ? 'true' : 'false'}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field id="city" label="Cidade" error={errors.city?.message}>
            <input
              id="city"
              type="text"
              autoComplete="address-level2"
              list="city-list"
              {...register('city')}
              className={inputClass}
              aria-invalid={errors.city ? 'true' : 'false'}
            />
            <datalist id="city-list">
              {cidades.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
      </div>

      <Field id="address" label="Endereço (opcional)" error={errors.address?.message}>
        <input
          id="address"
          type="text"
          autoComplete="street-address"
          placeholder="Rua, número, bairro"
          {...register('address')}
          className={inputClass}
          aria-invalid={errors.address ? 'true' : 'false'}
        />
      </Field>

      {submitError && (
        <p className="text-sm text-[color:var(--color-danger)]" role="alert">
          {submitError}
        </p>
      )}
      {submitSuccess && (
        <p className="text-sm text-[color:var(--color-p1)]" role="status">
          Perfil salvo!
        </p>
      )}

      <button
        type="submit"
        disabled={isUpdating || (!isDirty && !avatarFile)}
        className="w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {isUpdating ? 'Salvando...' : 'Salvar'}
      </button>

      {draftSavedAt > 0 && !submitSuccess ? (
        <p
          className="text-xs text-[color:var(--color-muted)] text-center"
          role="status"
          aria-live="polite"
        >
          Rascunho salvo
        </p>
      ) : null}
    </form>
  );
}

const inputClass =
  'w-full px-4 py-3 text-base bg-[color:var(--color-bg)] border-2 border-transparent focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors';

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-[color:var(--color-muted)] mt-1">{hint}</p>
      )}
      {error && (
        <p className="text-sm text-[color:var(--color-danger)] mt-1">{error}</p>
      )}
    </div>
  );
}
