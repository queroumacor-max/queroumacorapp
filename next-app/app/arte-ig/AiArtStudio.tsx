// AiArtStudio — client component, orquestra todo o fluxo da feature:
// upload de foto(s) + seleção de estilo/aspect + hint + geração + ações.
//
// Espelha o estado do `ai-art-modal` do vanilla (modules/ai-art.js), mas
// como state local React em vez de variáveis de módulo. Cada subcomponente
// recebe props enxutas — não há Context aqui (escopo de uma única rota).
//
// Fluxo:
//   1. Auth check (loading → CTA login).
//   2. Gate: PRO OU créditos restantes > 0. Se nenhum, mostra paywall.
//   3. Form: StyleSelector + slot(s) de foto + AspectSelector + textarea hint.
//   4. Botão "Gerar arte" dispara useAiArt.generate().
//   5. Em sucesso, renderiza ResultActions (download/postar/refazer).
//   6. Em "Postar" com sucesso, limpa o estado e mostra confirmação.
//
// Validações finas (foto obrigatória, tamanho < 8MB, antesdepois precisa de 2)
// ficam no service generateArt() — UI só intercepta ValidationError pra surfar.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/components/AuthProvider';
import { useAiArt } from '@/lib/hooks/useAiArt';
import { useProfile } from '@/lib/hooks/useProfile';
import { canSeeProFeature, type PolicyUser } from '@/lib/policies';
import type { ArtAspect, ArtStyle } from '@/lib/services/aiArt';
import { StyleSelector } from './StyleSelector';
import { AspectSelector } from './AspectSelector';
import { ResultActions } from './ResultActions';

// Tamanho máximo aceito pelo backend (matchea MAX_INPUT_BYTES em
// functions/api/_services/ig-art.js). Validação client-side pra surfar erro
// imediato sem queimar request.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB

// User do Supabase guarda is_pro/is_admin no `user_metadata`. Adaptador
// pra PolicyUser igual ao AnalysisCard do financeiro.
function userToPolicy(user: User | null): PolicyUser | null {
  if (!user) return null;
  const meta =
    user.user_metadata && typeof user.user_metadata === 'object'
      ? (user.user_metadata as Record<string, unknown>)
      : {};
  return {
    id: user.id,
    is_pro: meta.is_pro === true ? true : meta.is_pro === false ? false : null,
    is_admin:
      meta.is_admin === true ? true : meta.is_admin === false ? false : null,
    role: typeof meta.role === 'string' ? meta.role : null,
  };
}

export function AiArtStudio() {
  const { user, loading: authLoading } = useAuth();
  const { profile } = useProfile();

  // Form state. Default style=profissional, aspect=square — bate com o
  // vanilla _aiArtReset().
  const [style, setStyle] = useState<ArtStyle>('profissional');
  const [needsTwo, setNeedsTwo] = useState(false);
  const [aspect, setAspect] = useState<ArtAspect>('square');
  const [hint, setHint] = useState('');
  const [photo1, setPhoto1] = useState<string | null>(null);
  const [photo2, setPhoto2] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const ai = useAiArt();

  const isPro = canSeeProFeature(userToPolicy(user));
  // Gate combinado: PRO OU tem créditos. Se nenhum, paywall.
  const canUse = isPro || !ai.isAtLimit;

  const onSelectStyle = useCallback((s: ArtStyle, two: boolean) => {
    setStyle(s);
    setNeedsTwo(two);
    if (!two) setPhoto2(null);
  }, []);

  const onPickPhoto = useCallback(
    async (file: File | null, slot: 1 | 2) => {
      setPhotoError(null);
      if (!file) return;
      if (!file.type || !file.type.startsWith('image/')) {
        setPhotoError('Selecione uma imagem');
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setPhotoError('Foto muito grande (máx 8MB)');
        return;
      }
      try {
        const compressed = await compressImage(file, 512, 0.7);
        if (slot === 2) setPhoto2(compressed);
        else setPhoto1(compressed);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setPhotoError('Erro ao processar imagem: ' + msg);
      }
    },
    [],
  );

  const handleGenerate = useCallback(() => {
    ai.generate({
      style,
      aspect,
      photo1: photo1 || '',
      photo2: photo2 || undefined,
      bizName: profile?.business_name || profile?.name || '',
      hint: hint.trim(),
    });
  }, [ai, style, aspect, photo1, photo2, hint, profile]);

  const handlePost = useCallback(
    (caption: string, finalImageDataUrl: string) => {
      ai.post({ imageDataUrl: finalImageDataUrl, caption });
    },
    [ai],
  );

  // Limpa o form quando o post foi publicado com sucesso.
  useEffect(() => {
    if (ai.postResult?.ok) {
      setPhoto1(null);
      setPhoto2(null);
      setHint('');
      ai.resetResult();
    }
    // ai.resetResult é stable dentro do hook; postResult dispara só no sucesso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.postResult?.ok]);

  const creditsBadge = useMemo(() => {
    const left = ai.creditsLeft;
    const color =
      left >= 3 ? '#0a8a4f' : left >= 1 ? '#c97a00' : '#c0392b';
    return (
      <span
        className="text-xs font-bold"
        style={{ color }}
        aria-label={`${left} créditos restantes hoje`}
      >
        {left}/{ai.creditsLimit} hoje
      </span>
    );
  }, [ai.creditsLeft, ai.creditsLimit]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (authLoading) {
    return <Skeleton />;
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🎨
        </div>
        <h2 className="font-semibold mb-2">Entre pra gerar arte com IA</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Faça login pra usar o Seu Zé e turbinar seu Instagram.
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

  if (!canUse) {
    return (
      <div className="text-center py-10 px-4 rounded-2xl bg-gradient-to-br from-purple-50 to-orange-50 border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🚫
        </div>
        <h2 className="font-semibold mb-2">Limite diário atingido</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Você usou seus 5 créditos grátis de hoje. Volta amanhã, ou faça
          upgrade pro Pintor PRO pra gerar arte ilimitada.
        </p>
        <Link
          href="/perfil"
          className="inline-block px-5 py-2 bg-gradient-to-br from-[#8338ec] to-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Conhecer PRO
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Header de créditos */}
      <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden="true">⚡</span>
          <span className="text-[color:var(--color-muted)]">Créditos:</span>
          {isPro ? (
            <span className="text-xs font-bold text-[color:var(--color-p1)]">
              PRO · ilimitado
            </span>
          ) : (
            creditsBadge
          )}
        </div>
      </div>

      {!ai.result ? (
        <section className="space-y-5">
          <StyleSelector value={style} onChange={onSelectStyle} />

          {/* Slot(s) de foto */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
              2. {needsTwo ? 'Suas fotos (antes + depois)' : 'Sua foto'}
            </h3>
            <div className={needsTwo ? 'grid grid-cols-2 gap-2' : ''}>
              <PhotoSlot
                label={needsTwo ? 'Antes' : 'Sua foto'}
                value={photo1}
                onPick={(f) => onPickPhoto(f, 1)}
                onClear={() => setPhoto1(null)}
              />
              {needsTwo ? (
                <PhotoSlot
                  label="Depois"
                  value={photo2}
                  onPick={(f) => onPickPhoto(f, 2)}
                  onClear={() => setPhoto2(null)}
                />
              ) : null}
            </div>
            {photoError ? (
              <div
                role="alert"
                className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2"
              >
                {photoError}
              </div>
            ) : null}
          </div>

          <AspectSelector value={aspect} onChange={setAspect} />

          {/* Hint opcional */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
              4. Dica pra IA (opcional)
            </h3>
            <textarea
              value={hint}
              onChange={(e) => setHint(e.target.value.slice(0, 300))}
              rows={2}
              placeholder="Ex: quero passar confiança e profissionalismo"
              className="w-full p-2 border border-[color:var(--color-border)] rounded-lg text-sm"
              maxLength={300}
            />
          </div>

          {/* Erro da geração */}
          {ai.generateError ? (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"
            >
              {ai.generateError.message || 'Erro ao gerar arte.'}
            </div>
          ) : null}

          {/* Botão gerar */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={ai.isGenerating || !photo1 || (needsTwo && !photo2)}
            className="w-full px-4 py-3 bg-gradient-to-br from-[#8338ec] to-[color:var(--color-p1)] text-white rounded-xl text-base font-bold disabled:opacity-60"
          >
            {ai.isGenerating ? '✨ Seu Zé tá pintando...' : '✨ Gerar arte com Seu Zé'}
          </button>
        </section>
      ) : (
        <ResultActions
          imageDataUrl={ai.result.imageDataUrl}
          initialCaption={ai.result.caption}
          logoUrl={profile?.business_logo_url || null}
          onPost={handlePost}
          isPosting={ai.isPosting}
          postError={ai.postError}
          onReset={() => {
            ai.resetResult();
          }}
        />
      )}
    </>
  );
}

// ── Sub-bits ────────────────────────────────────────────────────────────────

interface PhotoSlotProps {
  label: string;
  value: string | null; // data URL
  onPick: (file: File | null) => void;
  onClear: () => void;
}

function PhotoSlot({ label, value, onPick, onClear }: PhotoSlotProps) {
  // Input file invisível; o `label` faz o trigger via htmlFor. Visual fica
  // só com o preview/drop area.
  const id = `photo-input-${label.toLowerCase().replace(/\s+/g, '-')}`;
  if (value) {
    return (
      <div className="rounded-xl border border-[color:var(--color-border)] overflow-hidden bg-white">
        <img src={value} alt={label} className="w-full aspect-square object-cover" />
        <div className="p-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-[color:var(--color-muted)]">
            {label}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-red-600 font-semibold"
          >
            Trocar
          </button>
        </div>
      </div>
    );
  }
  return (
    <label
      htmlFor={id}
      className="block aspect-square rounded-xl border-2 border-dashed border-[color:var(--color-border)] bg-white flex flex-col items-center justify-center cursor-pointer hover:border-[color:var(--color-p1)] transition-colors"
    >
      <div className="text-3xl mb-1" aria-hidden="true">
        📷
      </div>
      <div className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className="text-[10px] text-[color:var(--color-muted)] mt-0.5">
        toque pra escolher
      </div>
      <input
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          onPick(f);
          // reset input pra permitir re-selecionar mesmo arquivo.
          e.target.value = '';
        }}
      />
    </label>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-label="Carregando">
      <div className="h-10 rounded-xl bg-white border border-[color:var(--color-border)]" />
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[4/5] rounded-2xl bg-white border border-[color:var(--color-border)]"
          />
        ))}
      </div>
      <div className="h-32 rounded-xl bg-white border border-[color:var(--color-border)]" />
    </div>
  );
}

/**
 * Compacta File de imagem via canvas pra reduzir payload no /api/ig-art.
 * Mesmo cap do vanilla (_compressImageFile): lado maior ≤ 512px, JPEG q=0.7.
 * Resultado típico ~80-200KB (CF Pages Functions rejeita body > ~1MB).
 */
function compressImage(
  file: File,
  maxDim: number,
  quality: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('compressImage requer browser'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Falha ao decodificar imagem'));
      img.onload = () => {
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D não disponível'));
          return;
        }
        // Fundo branco caso a imagem tenha transparência (JPEG não suporta alpha).
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (err: unknown) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      const r = e.target?.result;
      if (typeof r === 'string') img.src = r;
      else reject(new Error('FileReader result não é string'));
    };
    reader.readAsDataURL(file);
  });
}
