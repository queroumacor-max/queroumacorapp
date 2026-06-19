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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useAiArt } from '@/lib/hooks/useAiArt';
import { useProfile } from '@/lib/hooks/useProfile';
import { canSeeProFeature, isAdmin } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { useArtHistory } from '@/lib/hooks/useArtHistory';
import { showToast } from '@/lib/toast';
import { generateCaption } from '@/lib/services/posts';
import type { ArtAspect, ArtStyle } from '@/lib/services/aiArt';
import { StyleSelector } from './StyleSelector';
import { AspectSelector } from './AspectSelector';
import { ResultActions } from './ResultActions';

// Tamanho máximo aceito pelo backend (matchea MAX_INPUT_BYTES em
// functions/api/_services/ig-art.js). Validação client-side pra surfar erro
// imediato sem queimar request.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB

export function AiArtStudio() {
  const { user, loading: authLoading } = useAuth();
  const { profile } = useProfile();
  // usePolicyUser combina profile (banco) com JWT metadata — fonte
  // verdade do is_pro/portal_access/etc. Antes era só JWT (vazio).
  const policyUser = usePolicyUser();
  const history = useArtHistory();

  // Form state. Default style=profissional, aspect=square — bate com o
  // vanilla _aiArtReset().
  const [style, setStyle] = useState<ArtStyle>('profissional');
  const [needsTwo, setNeedsTwo] = useState(false);
  const [aspect, setAspect] = useState<ArtAspect>('square');
  const [hint, setHint] = useState('');
  const [genCaptionLoading, setGenCaptionLoading] = useState(false);
  const [photo1, setPhoto1] = useState<string | null>(null);
  const [photo2, setPhoto2] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const ai = useAiArt();

  // Gera legenda + hashtags a partir da foto carregada (photo1). Usa
  // /api/caption (gpt-4o-mini Vision) — mesmo endpoint do Composer.
  // O texto resultante vira a "dica pra IA" + também é reutilizado depois
  // como legenda inicial no ResultActions (após gerar a arte).
  const handleGenerateCaption = useCallback(async () => {
    if (!photo1) {
      showToast('Selecione uma foto primeiro', 'info');
      return;
    }
    setGenCaptionLoading(true);
    try {
      const { caption, hashtags } = await generateCaption([photo1]);
      const tagLine = (hashtags || []).join(' ');
      const combined = [caption, tagLine].filter(Boolean).join('\n\n');
      setHint(combined.slice(0, 300));
      showToast('Legenda gerada!', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao gerar legenda', 'error');
    } finally {
      setGenCaptionLoading(false);
    }
  }, [photo1]);

  const isPro = canSeeProFeature(policyUser);
  const isAdminUser = isAdmin(policyUser);
  // Admin: ilimitado. PRO: 2/dia. Free: 5/dia. canUse=true até estourar.
  const canUse = isAdminUser || !ai.isAtLimit;

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
    // Feedback explícito quando falta foto (antes o botão ficava disabled e o
    // tap não respondia — BUG31).
    if (!photo1) {
      showToast('Selecione uma foto antes de gerar a arte.', 'info');
      return;
    }
    if (needsTwo && !photo2) {
      showToast('O estilo Antes/Depois precisa de 2 fotos.', 'info');
      return;
    }
    ai.generate({
      style,
      aspect,
      photo1: photo1 || '',
      photo2: photo2 || undefined,
      // Prioridade: name primeiro, business_name como fallback. business_name
      // pode conter dirty data legado de testes de logo da camisa (vanilla
      // ai-logo.js gravava label lá). Sem isso, IA personaliza com nome errado.
      bizName: profile?.name || profile?.business_name || '',
      hint: hint.trim(),
    });
  }, [ai, style, aspect, photo1, photo2, hint, profile, needsTwo]);

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

  // Salva no histórico assim que uma arte é gerada com sucesso. Evita perda
  // se user navega/fecha antes de postar, e permite repostar artes anteriores.
  const savedResultIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ai.result || !ai.result.imageDataUrl) return;
    // Idempotente: cada result vira 1 history item. Identificamos via
    // ai.result.imageDataUrl (mesmo blob = mesma arte; novo generate cria
    // outro data URL).
    if (savedResultIdRef.current === ai.result.imageDataUrl) return;
    savedResultIdRef.current = ai.result.imageDataUrl;
    history.add({
      imageDataUrl: ai.result.imageDataUrl,
      caption: ai.result.caption ?? '',
      style,
      aspect,
      bizName: profile?.name || profile?.business_name || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.result?.imageDataUrl]);


  const creditsBadge = useMemo(() => {
    if (isAdminUser) {
      return (
        <span
          className="text-xs font-bold"
          style={{ color: '#0a8a4f' }}
          aria-label="Admin — geração ilimitada"
        >
          ADMIN · ilimitado
        </span>
      );
    }
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
  }, [ai.creditsLeft, ai.creditsLimit, isAdminUser]);

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
          {isPro
            ? 'Você usou as 2 artes incluídas de hoje. Volta amanhã ou compre um pacote pra continuar.'
            : 'Você usou seus 5 créditos grátis de hoje. Volta amanhã, assine PRO ou compre um pacote.'}
        </p>
        <div className="flex flex-col gap-2 items-center">
          <Link
            href="/pro"
            className="inline-block px-5 py-2 bg-gradient-to-br from-[#8338ec] to-[color:var(--color-p1)] text-white rounded-xl font-semibold"
          >
            {isPro ? '🎁 Comprar pacote (R$1/imagem)' : 'Conhecer PRO'}
          </Link>
          <span className="text-xs text-[color:var(--color-muted)]">
            Pacote mínimo R$ 10 (10 imagens)
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Header de créditos */}
      <div className="flex items-center justify-between mb-4 px-3 py-2 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden="true">⚡</span>
          <span className="text-[color:var(--color-muted)]">
            {isAdminUser ? 'Admin:' : isPro ? 'PRO · hoje:' : 'Créditos:'}
          </span>
          {creditsBadge}
        </div>
        {!isAdminUser && ai.creditsLeft <= 1 ? (
          <Link
            href="/pro"
            className="text-xs font-bold text-[color:var(--color-p1)]"
          >
            +Pacote
          </Link>
        ) : null}
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

          {/* Legenda + hashtags — pode ser escrito à mão OU gerado pela IA
              a partir da foto (vision). Vai pro prompt da geração da arte E
              vira a legenda inicial do post. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)]">
                4. Legenda + hashtags
              </h3>
              <button
                type="button"
                onClick={handleGenerateCaption}
                disabled={genCaptionLoading}
                className="text-xs font-bold text-[color:var(--color-p1)] disabled:opacity-50"
                style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: photo1 ? 1 : 0.6 }}
              >
                {genCaptionLoading ? '✨ Gerando…' : '✨ Gerar com IA'}
              </button>
            </div>
            <textarea
              value={hint}
              onChange={(e) => setHint(e.target.value.slice(0, 300))}
              rows={4}
              placeholder={
                photo1
                  ? 'Clique em "Gerar com IA" pra criar a legenda baseada na foto, ou escreva à mão (#hashtags no final)'
                  : 'Suba a foto primeiro pra gerar a legenda automática'
              }
              className="w-full p-2 border border-[color:var(--color-border)] rounded-lg text-sm"
              maxLength={300}
            />
            <p
              className="text-[10px] text-[color:var(--color-muted)] mt-1"
              style={{ lineHeight: 1.4 }}
            >
              IA lê a sua foto e gera legenda + hashtags prontas pro Instagram.
            </p>
          </div>

          {/* Erro da geração */}
          {ai.generateError ? (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-center justify-between gap-2"
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                {/HTTP 502|502|temporariamente|indisponível/i.test(
                  ai.generateError.message || '',
                )
                  ? 'IA temporariamente indisponível. Tente de novo em alguns segundos.'
                  : ai.generateError.message || 'Erro ao gerar arte.'}
              </span>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={ai.isGenerating || !photo1}
                className="text-xs font-bold text-red-800 underline whitespace-nowrap"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Tentar de novo
              </button>
            </div>
          ) : null}

          {/* Botão gerar */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={ai.isGenerating}
            aria-disabled={!photo1 || (needsTwo && !photo2)}
            className="w-full px-4 py-3 bg-gradient-to-br from-[#8338ec] to-[color:var(--color-p1)] text-white rounded-xl text-base font-bold disabled:opacity-60"
            style={{ opacity: !photo1 || (needsTwo && !photo2) ? 0.6 : undefined }}
          >
            {ai.isGenerating ? '✨ Seu Zé tá pintando...' : '✨ Gerar arte com Seu Zé'}
          </button>

          {/* Histórico de artes geradas — salvas em localStorage pra não
              perder se user sai antes do resultado aparecer ou quiser
              repostar/baixar depois. */}
          {history.items.length > 0 ? (
            <div style={{ marginTop: 20 }}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-2 flex items-center justify-between">
                <span>📁 Histórico ({history.items.length})</span>
                {history.items.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => history.clear()}
                    className="text-[10px] normal-case font-bold"
                    style={{
                      color: 'var(--color-muted)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Limpar
                  </button>
                ) : null}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {history.items.map((it) => (
                  <div
                    key={it.id}
                    className="relative bg-white"
                    style={{
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={it.imageDataUrl}
                      alt="Arte anterior"
                      style={{
                        width: '100%',
                        aspectRatio: '1 / 1',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                    <div className="flex" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <a
                        href={it.imageDataUrl}
                        download={`arte-${it.id}.png`}
                        className="flex-1 text-center font-bold text-[10px] py-1.5"
                        style={{
                          color: 'var(--color-ink)',
                          textDecoration: 'none',
                          background: 'rgba(0,0,0,.02)',
                        }}
                      >
                        ⬇️
                      </a>
                      <button
                        type="button"
                        onClick={() => history.remove(it.id)}
                        className="flex-1 text-center font-bold text-[10px] py-1.5"
                        style={{
                          color: 'var(--color-danger)',
                          background: 'rgba(230,57,70,.05)',
                          border: 'none',
                          borderLeft: '1px solid var(--color-border)',
                          cursor: 'pointer',
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[color:var(--color-muted)] mt-2">
                Suas últimas {history.items.length} artes ficam salvas neste celular.
                Baixe pra não perder.
              </p>
            </div>
          ) : null}
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
