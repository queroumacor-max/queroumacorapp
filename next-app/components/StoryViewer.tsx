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
import { createPortal } from 'react-dom';
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

  // Detecção de vídeo é por EXTENSÃO da URL (isVideoUrl) porque `media_type` é
  // sempre 'story' — o campo marca que o post é um story, NÃO se a mídia é foto
  // ou vídeo. Então story antigo cuja media_url não termina em extensão de
  // vídeo conhecida (upload legado, id sem extensão, URL assinada) caía no
  // <img> e não tinha como tocar. Este override deixa o viewer se autocorrigir
  // UMA vez por story: se o <img> falha carregando o que é vídeo (ou o <video>
  // falha no que é imagem), troca o elemento. `triedFlipRef` evita loop
  // (ex.: imagem 404 viraria vídeo, falharia, voltaria pra imagem…).
  const [kindOverride, setKindOverride] = useState<'video' | 'image' | null>(null);
  const triedFlipRef = useRef(false);

  // Portal no <body>. O z-[400] sozinho JÁ deveria bastar (a BottomNav é
  // z-[300]), mas o viewer nasce dentro do <main> — basta um ancestral
  // ganhar `transform`/`filter`/`will-change` um dia pra ele virar o
  // containing block e o `fixed inset-0` parar de cobrir a tela. No body
  // não há o que dar errado, e o story é justamente a tela que precisa ser
  // imersiva.
  const [montado, setMontado] = useState(false);
  // "Já passamos pelo commit inicial?" não tem como ser sabido de forma
  // síncrona durante o render — é exatamente isso que o sinal significa.
  // Não existe alternativa sem efeito pra esse idioma específico (mount
  // detection pra portal SSR-safe).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
  useEffect(() => setMontado(true), []);

  // Story COM SOM por padrão (01/09/2026). Antes o `<video muted>` era fixo:
  // `muted` é o que a WebView exige pra tocar sem gesto, então o story
  // rodava sempre mudo — vídeo de obra sem o áudio que a pessoa gravou.
  // Aqui existe gesto (foi um toque que abriu o viewer), então dá pra
  // tentar com som e só cair pra mudo se o navegador recusar.
  const [mudo, setMudo] = useState(false);
  // `onClose` costuma ser uma função nova a cada render do pai; guardar numa
  // ref evita que o efeito do botão VOLTAR (abaixo) rearme e empilhe uma
  // entrada de histórico por render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // BOTÃO VOLTAR DO ANDROID fecha o story, como no Instagram (pedido do
  // usuário, 01/09/2026). Sem isto o "voltar" saía da TELA inteira — a
  // pessoa perdia o feed pra fechar um story.
  //
  // A mecânica: ao abrir, empurramos uma entrada no histórico; o "voltar"
  // consome ESSA entrada e dispara `popstate`, que fecha o viewer sem
  // navegar. Se o story for fechado pelo X ou pelo arrasto, a entrada
  // fantasma é desfeita na limpeza — senão o próximo "voltar" não sairia da
  // tela, só apagaria a entrada que sobrou.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let fechouPeloVoltar = false;
    window.history.pushState({ qucStory: true }, '');
    const aoVoltar = () => {
      fechouPeloVoltar = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', aoVoltar);
    return () => {
      window.removeEventListener('popstate', aoVoltar);
      if (!fechouPeloVoltar) window.history.back();
    };
  }, []);

  // Autoplay no Android: a WebView bloqueia `autoPlay` até haver gesto
  // (`setMediaPlaybackRequiresUserGesture` é true por padrão no wrapper) — e
  // o vídeo bloqueado exibe o PLAY gigante do player nativo, que foi o que o
  // usuário fotografou. Chamar `play()` na hora em que o story entra em cena
  // aproveita o gesto que abriu o viewer; se ainda assim falhar, o `poster`
  // transparente abaixo evita a arte feia.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = mudo;
    const p = v.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Recusou com som: a política de autoplay do aparelho é mais
        // rígida. Em vez de deixar o story parado (com o PLAY gigante do
        // player nativo), toca mudo e acende o botão pra pessoa ligar o som
        // — um toque dela é gesto suficiente pro navegador liberar.
        if (mudo) return;
        setMudo(true);
        const v2 = videoRef.current;
        if (!v2) return;
        v2.muted = true;
        const p2 = v2.play();
        if (p2 && typeof p2.catch === 'function') p2.catch(() => {});
      });
    }
    // `montado` nas deps porque o portal faz o 1º render devolver null: sem
    // ele o efeito rodava com `videoRef.current` ainda nulo e nunca mais —
    // o vídeo voltava a depender do `autoPlay`, que é o que a WebView
    // bloqueia. Foi o teste que pegou.
  }, [storyIdx, groupIdx, montado, mudo]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // `useRef(Date.now())` chamaria `Date.now()` em TODO render (só o
  // resultado do 1º é usado, mas o impuro roda de qualquer forma) — o
  // padrão pra inicializar um ref uma vez só com valor impuro é conferir
  // `current == null` e atribuir dentro do corpo do render.
  const startTsRef = useRef<number | null>(null);
  if (startTsRef.current === null) {
    // É exatamente o padrão que a própria mensagem de erro do
    // react-hooks/refs recomenda pra inicializar um ref uma vez só com
    // valor impuro; não há initializer preguiçoso pra useRef (diferente de
    // useState) que evite isso.
    // eslint-disable-next-line react-hooks/purity -- ver comentário acima
    startTsRef.current = Date.now();
  }

  const currentGroup: StoryGroup | undefined = groups[groupIdx];
  const currentStory: StoryRow | undefined = currentGroup?.stories[storyIdx];
  const isVideo = !!currentStory && (
    currentStory.media_type === 'video' ||
    isVideoUrl(currentStory.media_url)
  );
  // O que efetivamente é renderizado: a detecção por extensão, salvo quando o
  // próprio carregamento provou o contrário (kindOverride).
  const showVideo = kindOverride ? kindOverride === 'video' : isVideo;

  // Zera o override a cada story (o próximo pode ser do outro tipo). Mistura
  // reset de STATE com reset de REF no mesmo ponto de sincronização — dividir
  // em "state ajustado durante o render" + "ref resetada no efeito"
  // introduziria uma janela onde os dois ficam temporariamente inconsistentes
  // (o ref só zera depois do commit); manter os dois juntos no efeito garante
  // que o story novo sempre começa com AMBOS zerados no mesmo instante.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    setKindOverride(null);
    triedFlipRef.current = false;
  }, [currentStory?.id]);

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
    if (showVideo) return; // vídeo controla via onTimeUpdate/onEnded
    if (paused) return;

    startTsRef.current = Date.now();
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - (startTsRef.current ?? Date.now());
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
  }, [currentStory, showVideo, paused, goNext, storyIdx, groupIdx]);

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

  if (!montado) return null;

  const conteudo = (
    <div
      // z-[400]: a BottomNav é z-[300] e a TopNav z-50 — com z-50 o viewer
      // ficava POR BAIXO das duas, escondendo justamente as barras de
      // progresso (top-2) e o botão de fechar (top-6). Era por isso que o
      // story parecia não ter como fechar.
      className="fixed inset-0 z-[400] bg-black flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Stories de ${displayName}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Progress bars: uma por story do grupo atual. */}
      <div
        className="absolute left-2 right-2 flex gap-1 z-10"
        style={{ top: 'calc(8px + env(safe-area-inset-top))' }}
      >
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
      <div
        className="absolute left-2 right-2 flex items-center gap-2 z-10 text-white"
        style={{ top: 'calc(18px + env(safe-area-inset-top))' }}
      >
        <img
          src={
            profile.avatar_url ||
            `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.name || 'U')}`
          }
          alt=""
          className="w-8 h-8 rounded-full object-cover"
        />
        <span className="text-sm font-semibold">{displayName}</span>
        {/* Som: só aparece em vídeo. O story nasce COM áudio; este botão
            existe pra silenciar (ou pra religar quando a política de
            autoplay do aparelho obrigou o mudo). */}
        {showVideo ? (
          <button
            type="button"
            onClick={() => setMudo((m) => !m)}
            className="ml-auto flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-white"
            style={{
              width: 40,
              height: 40,
              fontSize: 18,
              lineHeight: 1,
              background: 'rgba(0,0,0,.45)',
              flexShrink: 0,
            }}
            aria-label={mudo ? 'Ligar o som' : 'Desligar o som'}
            data-testid="story-som"
          >
            {mudo ? '🔇' : '🔊'}
          </button>
        ) : null}
        {/* Alvo de 40px com fundo próprio: o × antes era texto solto sobre
            a foto — sumia em story claro e era difícil de acertar com o
            dedo. */}
        <button
          type="button"
          onClick={onClose}
          className={`${showVideo ? 'ml-1' : 'ml-auto'} flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-white`}
          style={{
            width: 40,
            height: 40,
            fontSize: 26,
            lineHeight: 1,
            background: 'rgba(0,0,0,.45)',
            flexShrink: 0,
          }}
          aria-label="Fechar stories"
        >
          ×
        </button>
      </div>

      {/* Media */}
      <div className="w-full h-full flex items-center justify-center">
        {showVideo ? (
          <video
            ref={videoRef}
            key={currentStory.id}
            src={currentStory.media_url ?? undefined}
            className="max-w-full max-h-full"
            autoPlay
            playsInline
            // 1×1 transparente: sem `poster`, o player nativo da WebView
            // desenha o PLAY gigante enquanto o primeiro quadro não chega.
            // Com um poster vazio, o intervalo fica preto e o vídeo entra
            // sem aquele salto visual.
            poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            preload="auto"
            onTimeUpdate={onVideoTimeUpdate}
            onEnded={goNext}
            // Detectado como vídeo mas o arquivo não é (ou o codec não abre):
            // cai pra <img> uma vez. Sem isto, um story marcado errado ficaria
            // num vídeo preto travado.
            onError={() => {
              if (triedFlipRef.current) return;
              triedFlipRef.current = true;
              setKindOverride('image');
            }}
          />
        ) : (
          <img
            src={currentStory.media_url ?? ''}
            alt=""
            className="max-w-full max-h-full object-contain"
            // <img> apontando pra um VÍDEO não decodifica e dispara onError —
            // é o caso do story de vídeo antigo cuja URL não tem extensão
            // reconhecível. Troca pra <video> uma vez, e aí ele toca.
            onError={() => {
              if (triedFlipRef.current) return;
              triedFlipRef.current = true;
              setKindOverride('video');
            }}
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

  return createPortal(conteudo, document.body);
}
