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
//  - avatar sobe NA HORA (2026-08-29), igual ao logo: uploadAvatar →
//    update({avatar_url}) → toast. Antes esperava o submit e virava um
//    preview que a pessoa achava que tinha salvado. Fluxo antigo era
//    uploadAvatar → patch.avatar_url = publicUrl → updateProfile. Se o
//    upload falhar, a UI mostra o erro e NÃO aplica nada (não persiste meio
//    update — comportamento mais previsível que o "best-effort" do vanilla
//    que salvava o resto mesmo se avatar quebrasse).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { useProfile } from '@/lib/hooks/useProfile';
import { useAutosave } from '@/lib/hooks/useAutosave';
import {
  getCidadesByUF,
  uploadAvatar,
} from '@/lib/services/profile';
import { fetchLogo, uploadLogo, saveLogo } from '@/lib/services/aiLogo';
import { phoneSchema, requiredField } from '@/lib/schemas';
import { showToast } from '@/lib/toast';
import { CameraCapture } from '@/components/CameraCapture';
import { native } from '@/lib/native';
import { useOfereceCamera } from '@/lib/hooks/useOfereceCamera';
import { armarSelecao, consumirEscolhaPendente } from '@/lib/utils/pickerRecovery';
import { descreverArquivo, normalizarArquivo, provadoNaoImagem } from '@/lib/utils/mediaType';
import { reportFailure } from '@/lib/utils/reportFailure';

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
  business_name: z
    .string()
    .trim()
    .max(80, 'Nome do negócio com no máximo 80 caracteres')
    .optional()
    .or(z.literal('')),
  // S4: links externos. Aceita só http/https (UI valida visualmente, schema
  // garante). Vazio é OK (sem link). Instagram pode vir com ou sem URL —
  // permite "@user" também sendo conservador (mas dá preferência a URL).
  instagram_url: z
    .string()
    .trim()
    .max(200, 'URL longa demais')
    .optional()
    .or(z.literal('')),
  website_url: z
    .string()
    .trim()
    .max(200, 'URL longa demais')
    .refine(
      (v) => !v || /^https?:\/\//i.test(v),
      { message: 'Use https://exemplo.com' },
    )
    .optional()
    .or(z.literal('')),
});

type FormData = z.infer<typeof schema>;

export function EditProfileForm() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading, error, update, isUpdating } = useProfile();
  const dialog = useDialog();

  // Avatar: sobe NA HORA, igual ao logo do negócio logo abaixo.
  //
  // Antes esperava o submit e a foto virava só um preview — a pessoa
  // escolhia, via a cara nova na tela, saía da página e nada tinha sido
  // salvo. Nenhuma mensagem, porque nada tinha acontecido mesmo. Pior:
  // o logo, no mesmo formulário, JÁ salvava sozinho — dois controles
  // vizinhos com comportamentos opostos.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const cancelarAvisoRef = useRef<(() => void) | null>(null);
  const [reiniciouNaEscolha, setReiniciouNaEscolha] = useState(false);
  const [camAberta, setCamAberta] = useState(false);
  const podeCamera = useOfereceCamera();

  // P7: cancela o que o `armarSelecao` armou quando a tela sai — senão
  // sobram ouvintes vivos e a marca de recuperação no localStorage vira
  // aviso falso na próxima abertura.
  useEffect(() => () => cancelarAvisoRef.current?.(), []);

  // Voltamos de um app que o Android matou com a galeria aberta? A foto se
  // perdeu no caminho e ninguém contou pra pessoa — ela só viu o app voltar
  // pro início. Conta aqui, com as saídas (ver lib/utils/pickerRecovery).
  useEffect(() => {
    if (!consumirEscolhaPendente('perfil/editar')) return;
    setReiniciouNaEscolha(true);
    reportFailure('picker-restart', new Error('app reiniciou com a galeria aberta'), {
      ctx: 'perfil/editar',
    });
  }, []);
  // Logo do negócio: lê do banco via fetchLogo (sincronizado com camisetas
  // — mesma URL `profiles.business_logo_url` que ShirtCustomizer/AiArt usam).
  // Upload faz commit imediato (não espera o submit do form principal) pra
  // ficar consistente com o fluxo de geração de logo IA.
  const [savedLogoUrl, setSavedLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(0);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setFocus,
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
      business_name: '',
      instagram_url: '',
      website_url: '',
    },
  });

  // Quando o profile chega do servidor, popula o form. reset() em vez de
  // setValue por campo porque RHF marca dirty apenas em mudanças após o
  // reset. Pulamos quando o user tem alterações não salvas (isDirty=true)
  // pra não sobrescrever o que ele está digitando — caso clássico: profile
  // refetch do servidor durante uma edição.
  useEffect(() => {
    if (!profile) return;
    if (isDirty) return;
    reset({
      name: profile.name ?? '',
      bio: profile.bio ?? '',
      phone: profile.phone ?? '',
      city: profile.city ?? '',
      state: (profile.state ?? '').toUpperCase(),
      address: profile.address ?? '',
      business_name:
        ((profile as { business_name?: string | null }).business_name ?? '') as string,
      instagram_url: profile.instagram_url ?? '',
      website_url: profile.website_url ?? '',
    });
  }, [profile, reset, isDirty]);

  // Autosave (UX#6): persiste rascunho a cada 5s em localStorage e
  // restaura no mount. Não cobre avatar (File) nem campos readonly.
  // O onRestore só dispara se já existir draft válido (TTL 7d).
  const watchedValues = watch();
  const autosave = useAutosave<FormData>({
    key: 'profile_edit',
    values: watchedValues as FormData,
    onRestore: (restored) => {
      // Não restaura rascunho por cima do perfil já carregado do servidor:
      // numa tela de EDIÇÃO o servidor é a fonte de verdade. Restaurar só
      // quando o perfil ainda não chegou (offline/lento). Antes, com o
      // perfil em cache (React Query quente), o efeito de popular rodava
      // primeiro e o restore do draft (possivelmente vazio/antigo) apagava
      // Nome e Cidade já preenchidos (BUG45).
      if (profile) return;
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

  // Carrega logo atual do banco no mount + quando user muda. Bate na mesma
  // coluna `profiles.business_logo_url` que ShirtCustomizer lê. Se não
  // tiver, fica null e a UI mostra placeholder.
  useEffect(() => {
    if (!user) return;
    let cancel = false;
    fetchLogo(user.id)
      .then((url) => {
        if (!cancel) setSavedLogoUrl(url);
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      cancel = true;
    };
  }, [user]);

  // Upload do logo: PUT no bucket + UPDATE profiles.business_logo_url.
  // Commit imediato (não espera submit) — comportamento idêntico ao
  // ShirtCustomizer pra manter sync entre as 2 telas.
  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    let file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    // `file.type` VAZIO é rotina no seletor do wrapper (ver
    // lib/utils/mediaType.ts) — validar por ele recusava foto de verdade.
    file = await normalizarArquivo(file);
    if (provadoNaoImagem(file)) {
      showToast(`Esse arquivo não é imagem (${file.type})`, 'error');
      reportFailure('avatar-fail', new Error(`logo nao-imagem: ${descreverArquivo(file)}`), {
        userId: user?.id,
        ctx: 'perfil/editar/logo',
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Imagem grande demais (máx 5MB)', 'error');
      return;
    }
    setLogoBusy(true);
    try {
      const url = await uploadLogo(user.id, file);
      await saveLogo(user.id, url);
      setSavedLogoUrl(url);
      showToast('Logo do negócio salvo!', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Erro ao enviar logo', 'error');
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleLogoRemove() {
    if (!user || logoBusy) return;
    const ok = await dialog.confirm('Remover o logo do negócio?', {
      title: 'Remover logo',
      okLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    setLogoBusy(true);
    try {
      // saveLogo exige string não-vazia; pra limpar, updateProfile direto.
      const { updateProfile } = await import('@/lib/services/profile');
      await updateProfile(user.id, { business_logo_url: null });
      setSavedLogoUrl(null);
      showToast('Logo removido', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Erro ao remover logo', 'error');
    } finally {
      setLogoBusy(false);
    }
  }

  // Enquanto sobe, mostra o arquivo local; depois vale o que está no
  // banco. O objectURL é revogado pra não vazar blob no heap.
  const currentAvatarUrl = useMemo(() => {
    if (avatarPreview) return avatarPreview;
    return profile?.avatar_url ?? null;
  }, [avatarPreview, profile?.avatar_url]);

  useEffect(() => {
    return () => {
      if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    cancelarAvisoRef.current?.();
    const f = e.target.files?.[0] ?? null;
    e.target.value = ''; // permite reescolher o MESMO arquivo depois
    await processarAvatar(f);
  }

  /**
   * Sobe a foto de perfil. Recebe o File pronto — venha ele da galeria ou
   * da câmera (`CameraCapture`), que é o caminho de quem está no app
   * empacotado, onde a galeria não abre.
   */
  async function processarAvatar(entrada: File | null) {
    let f = entrada;
    if (!f || !user || avatarBusy) return;
    // O seletor do app instalado devolve a foto SEM MIME type — era isto
    // que barrava a troca de foto com "Selecione um arquivo de imagem" na
    // cara de quem tinha selecionado exatamente isso.
    f = await normalizarArquivo(f);
    // Recusa só com PROVA. Antes bastava o Android não declarar o tipo pra
    // barrar a foto — era o bug que travou a troca de foto no app.
    if (provadoNaoImagem(f)) {
      showToast(`Esse arquivo não é imagem (${f.type})`, 'error');
      reportFailure('avatar-fail', new Error(`avatar nao-imagem: ${descreverArquivo(f)}`), {
        userId: user?.id,
        ctx: 'perfil/editar',
      });
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      showToast('Imagem muito grande (máx 5MB)', 'error');
      return;
    }
    const local = URL.createObjectURL(f);
    setAvatarPreview(local);
    setAvatarBusy(true);
    try {
      const { url, hash } = await uploadAvatar(user.id, f);
      await update({
        avatar_url: url,
        avatar_hash: hash || null,
      } as Parameters<typeof update>[0]);
      setAvatarPreview(null); // a partir daqui vale a do banco
      URL.revokeObjectURL(local);
      showToast('Foto atualizada!', 'success');
    } catch (err) {
      setAvatarPreview(null);
      URL.revokeObjectURL(local);
      showToast((err as Error).message || 'Não consegui salvar a foto', 'error');
      // O toast some em segundos e nunca chegava aqui — sem isso, "não
      // salvou a foto" continua sendo relato, não evidência.
      reportFailure('avatar-fail', err, { userId: user.id, ctx: 'perfil/editar' });
    } finally {
      setAvatarBusy(false);
    }
  }

  /**
   * Validação reprovou. Sem isto o botão "Salvar" não fazia NADA visível:
   * o erro aparecia lá embaixo, ao lado do campo, e quem estava no topo
   * da página (trocando a foto, por exemplo) só via o botão piscar. Agora
   * a página rola até o primeiro campo com problema e diz o que falta.
   */
  function onInvalid(errs: Record<string, { message?: string }>) {
    setSubmitSuccess(false);
    const primeiro = Object.keys(errs)[0] as keyof FormData | undefined;
    const msg = primeiro ? errs[primeiro as string]?.message : '';
    setSubmitError(msg ? `Falta corrigir: ${msg}` : 'Confira os campos destacados em vermelho.');
    if (primeiro) {
      try {
        setFocus(primeiro);
        document
          .querySelector(`[name="${String(primeiro)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        /* foco é conforto, não requisito */
      }
    }
  }

  async function onSubmit(data: FormData) {
    if (!user) return;
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      // bio/address opcionais: enviar string vazia como null pra normalizar
      // no banco (consistente com a coluna nullable).
      await update({
        name: data.name,
        bio: data.bio ? data.bio : null,
        phone: data.phone,
        city: data.city,
        state: data.state,
        address: data.address ? data.address : null,
        // business_name: vazio explicitamente vira null (limpa dirty data
        // legado tipo nome de logo de camisa antigo). Trim já feito pelo schema.
        business_name: data.business_name ? data.business_name : null,
        instagram_url: data.instagram_url ? data.instagram_url : null,
        website_url: data.website_url ? data.website_url : null,
      } as Parameters<typeof update>[0] & { business_name?: string | null });

      setSubmitSuccess(true);
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
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid as Parameters<typeof handleSubmit>[1])}
      className="space-y-4"
      noValidate
    >
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
            onClick={(e) => {
              // Picker NATIVO primeiro (avatar é só-imagem, então pickImages
              // serve): evita o seletor da WebView e a seleção múltipla não é
              // problema (limit 1). Só cai no <input> quando o nativo não está
              // disponível. preventDefault impede o label de abrir o <input>
              // quando vamos pelo caminho nativo.
              if (native.camera.isPickerAvailable()) {
                e.preventDefault();
                void (async () => {
                  const r = await native.camera.pickImages(1);
                  if (r.status === 'ok' && r.files[0]) void processarAvatar(r.files[0]);
                  // 'cancelled'/'unavailable'/'error' → não faz nada (a pessoa
                  // toca de novo; unavailable só ocorre se o plugin sumir no
                  // meio, caso raríssimo).
                })();
                return;
              }
              cancelarAvisoRef.current?.();
              cancelarAvisoRef.current = armarSelecao({
                rota: '/perfil/editar',
                ctx: 'perfil/editar',
              });
            }}
            className="inline-block px-4 py-2 bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded-xl text-sm font-semibold cursor-pointer hover:bg-[color:var(--color-border)] transition-colors"
            style={{ opacity: avatarBusy ? 0.6 : 1, pointerEvents: avatarBusy ? 'none' : 'auto' }}
          >
            {avatarBusy ? 'Enviando…' : 'Trocar foto'}
          </label>
          <input
            id="avatar-input"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleAvatarChange}
          />
          {podeCamera ? (
            <button
              type="button"
              onClick={async () => {
                if (avatarBusy) return;
                // Câmera nativa primeiro (pede a permissão real, aparece nos
                // ajustes do app). Fallback: CameraCapture web.
                const r = await native.camera.takePhoto('CAMERA');
                if (r.status === 'ok') {
                  void processarAvatar(r.file);
                  return;
                }
                if (r.status === 'cancelled') return;
                setCamAberta(true);
              }}
              disabled={avatarBusy}
              className="inline-block ml-2 px-4 py-2 bg-white border border-[color:var(--color-border)] rounded-xl text-sm font-semibold"
              style={{ opacity: avatarBusy ? 0.6 : 1 }}
              data-testid="avatar-camera"
            >
              📷 Tirar foto
            </button>
          ) : null}
          <p className="text-xs text-[color:var(--color-muted)] mt-1">
            JPG/PNG/WebP — máx 5MB. Salva sozinha ao escolher.
          </p>
        </div>
      </div>

      {/* Câmera: caminho direto pra foto, sem passar pelo seletor. */}
      <CameraCapture
        open={camAberta}
        facing="user"
        title="Foto de perfil"
        onClose={() => setCamAberta(false)}
        onCapture={(f) => void processarAvatar(f)}
        ctx="perfil/editar"
        userId={user?.id}
      />
      {/* O app MORREU com a galeria aberta (o Android mata o processo que
          ficou atrás). É outro caso, e continua real: a foto se perdeu.
          Aviso em linha, não modal — não há decisão a tomar, só escolher a
          foto de novo. */}
      {reiniciouNaEscolha && (
        <div
          className="mt-2 px-3 py-2 rounded-xl bg-[color:var(--color-p2-soft,#fff4e5)] text-xs text-[color:var(--color-ink)] flex items-start gap-2"
          role="status"
        >
          <span aria-hidden="true">↻</span>
          <span className="flex-1">
            O app fechou enquanto a galeria estava aberta e a foto se perdeu.
            É só escolher de novo.
          </span>
          <button
            type="button"
            onClick={() => setReiniciouNaEscolha(false)}
            className="font-semibold text-[color:var(--color-muted)]"
            aria-label="Dispensar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {/* Logo do negócio — espelha profiles.business_logo_url, mesma fonte
          que /camisetas e arte-ig leem. Upload imediato (não espera submit
          do form) pra ficar consistente com o fluxo de geração de logo IA. */}
      <div
        className="bg-white"
        style={{
          borderRadius: 14,
          padding: 14,
          border: '1px solid var(--color-border)',
        }}
      >
        <div
          className="font-bold"
          style={{ fontSize: 13, color: 'var(--color-ink)', marginBottom: 4 }}
        >
          🎨 Logo do negócio
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-muted)',
            marginBottom: 10,
          }}
        >
          O mesmo logo aparece nas camisetas e nas artes pro Instagram.
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 64,
              height: 64,
              borderRadius: 10,
              background: savedLogoUrl ? '#fff' : 'var(--color-cream)',
              border: '1.5px dashed var(--color-border)',
              overflow: 'hidden',
              padding: 4,
            }}
          >
            {savedLogoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={savedLogoUrl}
                alt="Logo do negócio"
                className="w-full h-full object-contain"
              />
            ) : (
              <span style={{ fontSize: 22 }} aria-hidden="true">🖼️</span>
            )}
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <label
              htmlFor="business-logo-input"
              className="text-center font-bold text-sm cursor-pointer"
              style={{
                padding: '8px 14px',
                background: 'var(--color-ink)',
                color: '#fff',
                borderRadius: 10,
                opacity: logoBusy ? 0.6 : 1,
                pointerEvents: logoBusy ? 'none' : 'auto',
              }}
            >
              {logoBusy ? 'Enviando…' : savedLogoUrl ? 'Trocar logo' : 'Enviar logo'}
            </label>
            <input
              id="business-logo-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleLogoFile}
              disabled={logoBusy}
            />
            {savedLogoUrl ? (
              <button
                type="button"
                onClick={handleLogoRemove}
                disabled={logoBusy}
                className="text-center font-semibold text-xs"
                style={{
                  padding: '6px 10px',
                  background: 'transparent',
                  color: 'var(--color-danger)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Remover
              </button>
            ) : (
              <Link
                href="/perfil"
                className="text-center font-semibold text-xs"
                style={{
                  padding: '6px 10px',
                  background: 'transparent',
                  color: 'var(--color-p1)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  textDecoration: 'none',
                }}
              >
                Ou gerar com IA (tile Camisetas)
              </Link>
            )}
          </div>
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

      <Field
        id="business_name"
        label="Nome do negócio (opcional)"
        error={errors.business_name?.message}
      >
        <input
          id="business_name"
          type="text"
          placeholder="Ex: JR Design Build (deixe em branco se não tiver)"
          {...register('business_name')}
          className={inputClass}
          aria-invalid={errors.business_name ? 'true' : 'false'}
        />
        <p className="text-[11px] text-[color:var(--color-muted)] mt-1">
          Aparece em PDFs e geração de IA. Apague pra usar seu nome pessoal.
        </p>
      </Field>

      <Field
        id="instagram_url"
        label="Instagram (opcional)"
        error={errors.instagram_url?.message}
      >
        <input
          id="instagram_url"
          type="text"
          placeholder="https://instagram.com/seu_perfil ou @seu_perfil"
          {...register('instagram_url')}
          className={inputClass}
          aria-invalid={errors.instagram_url ? 'true' : 'false'}
        />
      </Field>

      <Field
        id="website_url"
        label="Site / portfólio (opcional)"
        error={errors.website_url?.message}
      >
        <input
          id="website_url"
          type="url"
          placeholder="https://seusite.com.br"
          {...register('website_url')}
          className={inputClass}
          aria-invalid={errors.website_url ? 'true' : 'false'}
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
        disabled={isUpdating || !isDirty}
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
