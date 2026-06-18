// Composer — orquestra MediaUploader + MediaPreview + CaptionInput +
// "Para venda" toggle + botão de publicar. Substitui o post-modal do vanilla
// (publishPost + handlePostFiles + clearPostImages + gerarLegendaPost).
//
// Estado local:
//   - files: File[]            mídias selecionadas (pré-upload)
//   - caption: string          texto do post
//   - postType: 'post'|'story' aba "Foto/Vídeo" vs "Story"
//   - forSale, price, artType  campos de venda (só grafiteiro)
//   - publishError local: pra erros de validação client-side (count > 5 etc.)
//   - genCaption status: useState próprio (separado do mutation pra UX
//                        independente — botão "Gerar IA" tem seu loading)
//
// Por que não react-hook-form? Form é simples e a parte interativa pesada é
// upload/IA — RHF resolve menos do que adicionaria de superfície. Mantemos
// useState puro alinhado com o resto do app.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { MediaUploader } from './MediaUploader';
import { MediaPreview } from './MediaPreview';
import { CaptionInput } from './CaptionInput';
import { usePublishPost } from '@/lib/hooks/usePublishPost';
import { useAutosave } from '@/lib/hooks/useAutosave';
import {
  uploadMedia,
  compressImage,
  extractVideoThumbnail,
  generateCaption,
  MAX_IMAGES,
  MAX_FILE_BYTES,
  COMPRESS_THRESHOLD,
  type CreatePostMediaType,
} from '@/lib/services/posts';
import { getMediaType, parseBRL } from '@/lib/utils';

// Tipos de arte aceitos quando for_sale=true. Alinha com o select que o
// vanilla mostra no post-art-type (grafiteiro: fachada/mural/etc).
const ART_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'fachada', label: 'Fachada' },
  { value: 'mural', label: 'Mural' },
  { value: 'interna', label: 'Arte interna' },
  { value: 'logo', label: 'Logo / letreiro' },
  { value: 'outro', label: 'Outro' },
];

function validateFiles(
  next: File[],
  existing: File[]
): { ok: true; files: File[] } | { ok: false; error: string } {
  const merged = [...existing, ...next];

  // Regra: max 5 imagens OU 1 vídeo (não mistura). Se chegar vídeo, descarta
  // imagens anteriores; se já tem vídeo, novas imagens substituem.
  const hasVideoIncoming = next.some((f) => getMediaType(f) === 'video');
  if (hasVideoIncoming) {
    const videoFiles = next.filter((f) => getMediaType(f) === 'video');
    if (videoFiles.length > 1) {
      return { ok: false, error: 'Selecione apenas 1 vídeo.' };
    }
    if (videoFiles[0].size > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `Vídeo grande demais (máx ${MAX_FILE_BYTES / 1024 / 1024} MB).`,
      };
    }
    return { ok: true, files: [videoFiles[0]] };
  }

  // Só imagens: aceita até MAX_IMAGES no total.
  const imagesOnly = merged.filter((f) => getMediaType(f) === 'image');
  if (imagesOnly.length > MAX_IMAGES) {
    return { ok: false, error: `Máximo ${MAX_IMAGES} imagens.` };
  }
  const totalBytes = imagesOnly.reduce((acc, f) => acc + f.size, 0);
  if (totalBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `Total grande demais (máx ${MAX_FILE_BYTES / 1024 / 1024} MB).`,
    };
  }
  return { ok: true, files: imagesOnly };
}

export interface ComposerProps {
  /** Quando true, Composer é usado dentro de um modal/sheet — não faz
   *  router.push após publish (caller fecha o sheet). */
  embedded?: boolean;
  /** Callback após publish bem-sucedido — caller pode fechar modal,
   *  refetch feed, etc. */
  onPublishSuccess?: () => void;
}

export function Composer({ embedded, onPublishSuccess }: ComposerProps = {}) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const publish = usePublishPost();

  // ?forSale=1 vem de deep-links tipo "Arte pra venda → Publicar nova arte".
  // Pré-marca o toggle pra evitar 1 click — autosave assume depois.
  const initialForSale = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('forSale') === '1'
    : false;

  const [postType, setPostType] = useState<CreatePostMediaType>('image');
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [forSale, setForSale] = useState(initialForSale);
  const [priceText, setPriceText] = useState('');
  const [artType, setArtType] = useState<string>(ART_TYPES[0].value);
  // S5: link externo opcional pra story (CTA "ver mais" no viewer).
  const [linkUrl, setLinkUrl] = useState('');

  const [validationError, setValidationError] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState(0);

  // Autosave (UX#6): persiste só campos texto/toggle do composer em
  // localStorage. Arquivos (File[]) NÃO entram — File não é serializável e o
  // user precisa re-selecionar mídia se voltar pro draft (constraint do spec:
  // não autosave de arquivos). Restore aplica via setState individuais.
  const autosaveValues = useMemo(
    () => ({ postType, caption, forSale, priceText, artType }),
    [postType, caption, forSale, priceText, artType]
  );
  const autosave = useAutosave<typeof autosaveValues>({
    key: 'post_composer',
    values: autosaveValues,
    onRestore: (restored) => {
      if (typeof restored.postType === 'string') setPostType(restored.postType);
      if (typeof restored.caption === 'string') setCaption(restored.caption);
      if (typeof restored.forSale === 'boolean') setForSale(restored.forSale);
      if (typeof restored.priceText === 'string') setPriceText(restored.priceText);
      if (typeof restored.artType === 'string') setArtType(restored.artType);
    },
  });
  useEffect(() => {
    if (autosave.lastSavedAt && autosave.lastSavedAt !== draftSavedAt) {
      setDraftSavedAt(autosave.lastSavedAt);
    }
  }, [autosaveValues, autosave.lastSavedAt, draftSavedAt]);

  const handleFiles = useCallback(
    (incoming: File[]) => {
      setValidationError(null);
      const result = validateFiles(incoming, files);
      if (!result.ok) {
        setValidationError(result.error);
        return;
      }
      setFiles(result.files);
      // Se chegou vídeo, força mediaType=video; se voltou pra imagem, image.
      const hasVideo = result.files.some((f) => getMediaType(f) === 'video');
      if (hasVideo) {
        setPostType('video');
      } else if (postType === 'video') {
        setPostType('image');
      }
    },
    [files, postType]
  );

  const handleRemove = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setValidationError(null);
  }, []);

  // "Gerar legenda IA" — sobe a 1a mídia (com compressão se >2MB; ou frame
  // extraído se for vídeo) e chama /api/caption. NÃO grava no banco — só
  // popula o textarea.
  const handleGenerateCaption = useCallback(async () => {
    setGenError(null);
    if (!user) {
      setGenError('Faça login pra usar a IA.');
      return;
    }
    if (files.length === 0) {
      setGenError('Selecione uma foto ou vídeo primeiro.');
      return;
    }
    setGenLoading(true);
    try {
      const first = files[0];
      let toUpload: File;
      if (getMediaType(first) === 'video') {
        // Vídeo: extrai frame, sobe como JPG e usa essa URL.
        const blob = await extractVideoThumbnail(first);
        toUpload = new File([blob], 'frame.jpg', { type: 'image/jpeg' });
      } else if (first.size > COMPRESS_THRESHOLD) {
        toUpload = await compressImage(first);
      } else {
        toUpload = first;
      }
      const { url } = await uploadMedia(user.id, toUpload);
      const { caption: cap, hashtags } = await generateCaption([url]);
      const tagLine = hashtags.join(' ');
      const built = [cap, tagLine].filter(Boolean).join('\n\n');
      const existing = caption.trim();
      const next = existing ? `${existing}\n\n${built}` : built;
      setCaption(next);
    } catch (e) {
      setGenError(
        e instanceof Error ? e.message : 'Falha ao gerar legenda.'
      );
    } finally {
      setGenLoading(false);
    }
  }, [user, files, caption]);

  const handleSubmit = useCallback(() => {
    setValidationError(null);
    publish.reset();

    // Mídia obrigatória pra publicar (post/story/portfólio são visuais). Sem
    // foto/vídeo, dá feedback claro em vez de o clique não fazer nada (BUG10).
    if (files.length === 0) {
      setValidationError('Selecione uma foto ou vídeo para publicar.');
      return;
    }

    // mediaType final: 'story' se aba story, senão image|video conforme files.
    const mediaType: CreatePostMediaType =
      postType === 'story'
        ? 'story'
        : files.length > 0 && getMediaType(files[0]) === 'video'
          ? 'video'
          : 'image';

    const price = forSale ? parseBRL(priceText) : 0;

    const linkUrlTrim = linkUrl.trim();
    publish.publishAsync({
      files,
      caption: caption.trim(),
      mediaType,
      forSale,
      price: forSale ? price : null,
      artType: forSale ? artType : null,
      linkUrl: mediaType === 'story' && linkUrlTrim ? linkUrlTrim : null,
    })
      .then(() => {
        // Limpa estado. Em embedded (modal), só chama onPublishSuccess pra
        // o caller fechar o sheet; em standalone, navega pro feed.
        setFiles([]);
        setCaption('');
        setForSale(false);
        setPriceText('');
        autosave.clear();
        setDraftSavedAt(0);
        if (embedded) {
          onPublishSuccess?.();
        } else {
          router.push('/feed');
        }
      })
      .catch(() => {
        // Erro já fica em publish.error — pintamos no banner abaixo.
      });
  }, [
    publish,
    postType,
    files,
    caption,
    forSale,
    priceText,
    artType,
    router,
    autosave,
    embedded,
    onPublishSuccess,
  ]);

  if (authLoading) {
    return (
      <div
        className="bg-white rounded-2xl border border-[color:var(--color-border)] p-8 animate-pulse"
        aria-hidden="true"
      >
        <div className="h-40 bg-[color:var(--color-border)] rounded-xl mb-4" />
        <div className="h-3 w-1/3 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-24 bg-[color:var(--color-border)] rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-2xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🔒
        </div>
        <h2 className="font-semibold mb-2">Entre para publicar</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Faça login pra postar foto, vídeo ou story no feed.
        </p>
        <a
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </a>
      </div>
    );
  }

  const isVideoMode =
    files.length > 0 && getMediaType(files[0]) === 'video';
  const canAddMore = !isVideoMode && files.length < MAX_IMAGES;
  const submitting = publish.isPending;

  return (
    <div className="flex flex-col gap-4">
      {/* Aba post/story — só visual; o tipo final é resolvido no submit
          com base nos files também (vídeo → 'video', story → 'story'). */}
      <div className="flex gap-2" role="tablist" aria-label="Tipo de publicação">
        <button
          type="button"
          role="tab"
          aria-selected={postType !== 'story'}
          onClick={() => setPostType('image')}
          disabled={submitting}
          className={
            'flex-1 px-3 py-2 rounded-xl text-sm font-semibold border ' +
            (postType !== 'story'
              ? 'bg-[color:var(--color-ink)] text-white border-[color:var(--color-ink)]'
              : 'bg-white border-[color:var(--color-border)]')
          }
        >
          Foto / Vídeo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={postType === 'story'}
          onClick={() => setPostType('story')}
          disabled={submitting}
          className={
            'flex-1 px-3 py-2 rounded-xl text-sm font-semibold border ' +
            (postType === 'story'
              ? 'bg-[color:var(--color-ink)] text-white border-[color:var(--color-ink)]'
              : 'bg-white border-[color:var(--color-border)]')
          }
        >
          Story
        </button>
      </div>

      {/* Uploader: some quando já tem o máximo permitido. */}
      {(files.length === 0 || canAddMore) && (
        <MediaUploader
          onFiles={handleFiles}
          disabled={submitting}
          accept={
            isVideoMode
              ? 'video/*'
              : files.length > 0
                ? 'image/*'
                : 'image/*,video/*'
          }
        />
      )}

      <MediaPreview files={files} onRemove={handleRemove} disabled={submitting} />

      {validationError ? (
        <div
          role="alert"
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {validationError}
        </div>
      ) : null}

      <CaptionInput
        value={caption}
        onChange={setCaption}
        onGenerate={handleGenerateCaption}
        isGenerating={genLoading}
        canGenerate={files.length > 0}
        disabled={submitting}
      />

      {genError ? (
        <div
          role="alert"
          className="p-3 rounded-xl bg-yellow-50 border border-yellow-200 text-sm text-yellow-900"
        >
          {genError}
        </div>
      ) : null}

      {/* S5: link externo só faz sentido em story (CTA "ver mais"). */}
      {postType === 'story' ? (
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-white p-4">
          <label htmlFor="story-link" className="block text-sm font-semibold mb-2">
            Link "ver mais" (opcional)
          </label>
          <input
            id="story-link"
            type="url"
            placeholder="https://seusite.com/promo"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value.slice(0, 500))}
            disabled={submitting}
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
          <p className="text-[11px] text-[color:var(--color-muted)] mt-1">
            Aparece como botão no story. Deixe vazio se não quiser link.
          </p>
        </div>
      ) : null}

      {/* "Para venda" — só faz sentido fora de story */}
      {postType !== 'story' ? (
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-white p-4">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={forSale}
              onChange={(e) => setForSale(e.target.checked)}
              disabled={submitting}
              data-testid="for-sale-toggle"
              className="w-4 h-4"
            />
            <span className="text-sm font-semibold">Marcar como venda</span>
          </label>

          {forSale ? (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="post-price" className="block text-xs mb-1">
                  Preço (R$)
                </label>
                <input
                  id="post-price"
                  type="text"
                  inputMode="decimal"
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  disabled={submitting}
                  placeholder="0,00"
                  className="w-full p-2 rounded-xl border border-[color:var(--color-border)] bg-white text-sm"
                />
              </div>
              <div>
                <label htmlFor="post-art-type" className="block text-xs mb-1">
                  Tipo de arte
                </label>
                <select
                  id="post-art-type"
                  value={artType}
                  onChange={(e) => setArtType(e.target.value)}
                  disabled={submitting}
                  className="w-full p-2 rounded-xl border border-[color:var(--color-border)] bg-white text-sm"
                >
                  {ART_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {publish.error ? (
        <div
          role="alert"
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {publish.error.message || 'Não foi possível publicar.'}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={
          submitting ||
          (files.length === 0 && !caption.trim()) ||
          (postType === 'story' && files.length === 0)
        }
        data-testid="publish-btn"
        className="w-full py-3 rounded-2xl bg-[color:var(--color-p1)] text-white font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        {submitting ? 'Publicando…' : 'Publicar'}
      </button>

      {draftSavedAt > 0 ? (
        <p
          className="text-xs text-[color:var(--color-muted)] text-center"
          role="status"
          aria-live="polite"
        >
          Rascunho salvo
        </p>
      ) : null}
    </div>
  );
}
