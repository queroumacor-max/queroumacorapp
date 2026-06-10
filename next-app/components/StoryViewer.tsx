// StoryViewer — modal fullscreen pra visualizar stories estilo IG.
// Recebe a lista de groups + índice inicial; gerencia internamente:
//   - currentGroupIdx / currentStoryIdx (índices dentro da matriz);
//   - progressPct: barra de progresso animada via setInterval (50ms) que
//     atualiza um state e re-renderiza a barra. Mais barato que rAF aqui
//     porque a UI já estaria re-renderizando o restante do viewer no avanço;
//   - auto-advance: quando progressPct chega a 100%, chama next();
//   - tap zones: clique na metade esquerda = prev, direita = next;
//   - swipe down / Escape / botão X = close.
//
// Body scroll lock via useEffect quando o viewer abre — restaurado no cleanup.
// Marca grupo como visto ao sair (chamando onMarkSeen pra que o caller decida
// — neste port o caller é o StoriesCarousel que delega pro useStories).
//
// Diferenças vs vanilla:
//   - O vanilla usa requestAnimationFrame com `performance.now()` pra um
//     progresso suave; aqui usamos setInterval de 50ms (20fps) que é
//     suficiente pra animar a barra sem custo de CPU em background tab
//     (clearInterval no cleanup garante que nada vaze).
//   - Vídeo: usa `onTimeUpdate` no <video> pra avançar a barra no ritmo real
//     do vídeo (não no STORY_DURATION). `onEnded` dispara next.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Config } from '@/lib/config';
import { isVideoUrl } from '@/lib/utils';
import { useStories } from '@/lib/hooks/useStories';
import type { StoryGroup, StoryRow } from '@/lib/services/stories';

export interface StoryViewerProps {
  groups: StoryGroup[];
  initialGroupIndex: number;
  onClose: () => void;
}

const STORY_DURATION_MS = Config.stories.DURATION_MS;
const TICK_MS = 50; // 20fps — suficiente pra animar a barra; ~1% de CPU.

export function StoryViewer({
  groups,
  initialGroupIndex,
  onClose,
}: StoryViewerProps) {
  // Hook de stories — usamos só o `markSeen` aqui. `followingIds` vazio
  // porque o caller já passou os groups via prop e não queremos refetch
  // do hook duplicar dados; o markSeen mutation funciona independente do
  // estado da query.
  const { markSeen } = useStories([]);

  const [groupIdx, setGroupIdx] = useState(initialGroupIndex);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [paused, setPaused] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTsRef = useRef<number>(Date.now());

  const currentGroup: StoryGroup | undefined = groups[groupIdx];
  const currentStory: StoryRow | undefined = currentGroup?.stories[storyIdx];
  const isVideo = !!currentStory && (
    currentStory.media_type === 'video' ||
    isVideoUrl(currentStory.media_url)
  );

  // ─── Navegação ───────────────────────────────────────────────────────────
  // Definidas como useCallback porque entram em deps de useEffect (auto-advance,
  // keyboard listener). Sem useCallback, o effect re-monta a cada render.

  const goNext = useCallback(() => {
    if (!currentGroup) {
      onClose();
      return;
    }
    if (storyIdx < currentGroup.stories.length - 1) {
      setStoryIdx((i) => i + 1);
      setProgressPct(0);
      startTsRef.current = Date.now();
    } else if (groupIdx < groups.length - 1) {
      // Marca grupo atual como visto ao sair pro próximo grupo. lastStoryId
      // = id do último story do grupo (analytics-friendly).
      const lastId = currentGroup.stories[currentGroup.stories.length - 1]?.id;
      markSeen({ ownerId: currentGroup.user_id, lastStoryId: lastId });
      setGroupIdx((i) => i + 1);
      setStoryIdx(0);
      setProgressPct(0);
      startTsRef.current = Date.now();
    } else {
      // Fim do último grupo — marca visto e fecha.
      const lastId = currentGroup.stories[currentGroup.stories.length - 1]?.id;
      markSeen({ ownerId: currentGroup.user_id, lastStoryId: lastId });
      onClose();
    }
  }, [currentGroup, groupIdx, storyIdx, groups.length, markSeen, onClose]);

  const goPrev = useCallback(() => {
    if (storyIdx > 0) {
      setStoryIdx((i) => i - 1);
      setProgressPct(0);
      startTsRef.current = Date.now();
    } else if (groupIdx > 0) {
      const prev = groups[groupIdx - 1];
      if (!prev) return;
      setGroupIdx((i) => i - 1);
      setStoryIdx(prev.stories.length - 1);
      setProgressPct(0);
      startTsRef.current = Date.now();
    }
    // Se já está no primeiro story do primeiro grupo, no-op (não fecha).
  }, [groupIdx, storyIdx, groups]);

  // ─── Auto-advance (imagem) ───────────────────────────────────────────────
  // Pra video, o avanço é via onEnded; pra imagem, usamos interval.

  useEffect(() => {
    if (!currentStory) return;
    if (isVideo) return; // vídeo controla via onTimeUpdate/onEnded
    if (paused) return;

    startTsRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTsRef.current;
      const pct = Math.min(100, (elapsed / STORY_DURATION_MS) * 100);
      setProgressPct(pct);
      if (elapsed >= STORY_DURATION_MS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        goNext();
      }
    }, TICK_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [currentStory, isVideo, paused, goNext, storyIdx, groupIdx]);

  // ─── Body scroll lock ────────────────────────────────────────────────────
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ─── Keyboard nav + swipe down ───────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, onClose]);

  // ─── Touch handlers (swipe down to close) ────────────────────────────────
  const touchStartY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const startY = touchStartY.current;
    touchStartY.current = null;
    if (startY == null) return;
    const endY = e.changedTouches[0]?.clientY ?? startY;
    if (endY - startY > 100) {
      onClose();
    }
  };

  // ─── Video event handlers ────────────────────────────────────────────────
  // Mantém a barra sincronizada com a duração real do vídeo (não com
  // STORY_DURATION). Em vídeos curtos (5s) parece igual; em vídeos longos
  // (até 60s) garante que a barra só chega a 100% quando o vídeo terminar.
  const onVideoTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration || Number.isNaN(v.duration)) return;
    setProgressPct((v.currentTime / v.duration) * 100);
  };

  if (!currentGroup || !currentStory) {
    return null;
  }

  const profile = currentGroup.profile;
  const displayName = profile.tag
    ? '@' + profile.tag
    : profile.name || 'Usuário';

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Stories de ${displayName}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Progress bars: uma por story do grupo atual. */}
      <div className="absolute top-2 left-2 right-2 flex gap-1 z-10">
        {currentGroup.stories.map((_, i) => {
          const fill =
            i < storyIdx ? 100 : i === storyIdx ? progressPct : 0;
          return (
            <div
              key={i}
              className="flex-1 h-[2.5px] rounded bg-white/30 overflow-hidden"
            >
              <div
                className="h-full bg-white"
                style={{ width: `${fill}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Header: avatar + nome + close. */}
      <div className="absolute top-6 left-2 right-2 flex items-center gap-2 z-10 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            profile.avatar_url ||
            `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.name || 'U')}`
          }
          alt=""
          className="w-8 h-8 rounded-full object-cover"
        />
        <span className="text-sm font-semibold">{displayName}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-2xl leading-none px-2 focus:outline-none focus:ring-2 focus:ring-white rounded"
          aria-label="Fechar viewer"
        >
          ×
        </button>
      </div>

      {/* Media */}
      <div className="w-full h-full flex items-center justify-center">
        {isVideo ? (
          <video
            ref={videoRef}
            key={currentStory.id}
            src={currentStory.media_url ?? undefined}
            className="max-w-full max-h-full"
            autoPlay
            muted
            playsInline
            onTimeUpdate={onVideoTimeUpdate}
            onEnded={goNext}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentStory.media_url ?? ''}
            alt=""
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>

      {/* Tap zones: esquerda 1/3 = prev, direita 2/3 = next. Pause-on-hold
          fica no center via mousedown/up no wrapper inteiro (best-effort —
          IG faz isso em mobile via long press; aqui usamos pointer down). */}
      <button
        type="button"
        onClick={goPrev}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
        className="absolute top-0 left-0 h-full w-1/3 bg-transparent focus:outline-none"
        aria-label="Story anterior"
      />
      <button
        type="button"
        onClick={goNext}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
        className="absolute top-0 right-0 h-full w-2/3 bg-transparent focus:outline-none"
        aria-label="Próximo story"
      />

      {/* S5: CTA "ver mais" quando o story tem link_url. Fica acima das
          tap zones (z-10) e impede que o clique propague pra goNext.
          Pause-on-hold continua via outras tap zones.
          B4 fix: valida http/https antes de renderizar — Composer não
          valida client-side e dado pode chegar de qualquer origem. */}
      {currentStory.link_url && /^https?:\/\//i.test(currentStory.link_url) ? (
        <a
          href={currentStory.link_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/95 text-[color:var(--color-ink)] text-sm font-bold shadow-lg"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Ver mais
        </a>
      ) : null}
    </div>
  );
}
