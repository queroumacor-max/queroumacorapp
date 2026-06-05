// PostMedia — renderiza a mídia (imagem ou vídeo) de um post do feed.
// Equivalente ao bloco `imgHtml` do vanilla buildFeedPostHTML (modules/feed.js
// linha 422), portado pra JSX com hook de autoplay-on-view.
//
// Comportamentos:
//   - imagem: <img> com aspect-ratio 1/1 e object-fit cover (mesmo do vanilla);
//   - vídeo: <video muted loop playsinline preload="metadata"> que dá play
//     quando entra em vista (IntersectionObserver, threshold 0.55) e pause
//     quando sai. Click no vídeo alterna play/pause. Botão de mute no canto.
//
// Não usamos `next/image` porque mídia vem do Supabase Storage (URL externa
// sem otimização Next disponível em static export). Quando ligar CF Image
// Resizing, refatoramos pra um <img> com srcset.

'use client';

import { useEffect, useRef, useState } from 'react';
import { isVideoUrl } from '@/lib/utils';

export interface PostMediaProps {
  url: string;
  mediaType?: string | null;
  // Controle do mute compartilhado entre todos os vídeos do feed (estilo IG:
  // mexeu no mute de um, mexeu em todos). Lifted state — FeedView mantém e
  // passa pra cá.
  muted: boolean;
  onToggleMute: () => void;
}

export function PostMedia({ url, mediaType, muted, onToggleMute }: PostMediaProps) {
  const isVideo = !!url && (isVideoUrl(url) || mediaType === 'video');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // imgError: idem Avatar — fallback gracioso se a img der erro 403/404 em
  // vez de mostrar o ícone de imagem quebrada do browser.
  const [imgError, setImgError] = useState(false);

  // Sincroniza prop `muted` com o estado real do <video> (toggle do botão
  // muda o estado no pai, propaga pra cá via prop).
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Autoplay quando o vídeo entra em vista — equivalente a observeFeedVideos
  // do vanilla. Threshold 0.55 é mesmo valor do vanilla pra dar a sensação
  // de "passou da metade na tela, começa a tocar". Cleanup desconecta o
  // observer pra evitar leak quando o componente desmonta.
  useEffect(() => {
    if (!isVideo) return;
    const el = videoRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return; // SSR / older
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting && en.intersectionRatio >= 0.55) {
            const p = el.play();
            if (p) p.catch(() => { /* autoplay bloqueado pelo browser — ok */ });
          } else {
            el.pause();
          }
        }
      },
      { threshold: [0, 0.55, 1] },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      // Pause no unmount pra não vazar áudio quando navegar (especialmente
      // se o user vier do feed muted=false e mudar de página).
      el.pause();
    };
  }, [isVideo, url]);

  if (!url) return null;

  if (isVideo) {
    return (
      <div
        className="relative w-full bg-black"
        style={{ aspectRatio: '1 / 1' }}
      >
        <video
          ref={videoRef}
          src={url}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          onClick={(e) => {
            const v = e.currentTarget;
            if (v.paused) {
              const p = v.play();
              if (p) p.catch(() => { /* autoplay bloqueado — ignora */ });
            } else {
              v.pause();
            }
          }}
          className="w-full h-full object-cover block cursor-pointer"
        />
        <button
          type="button"
          aria-label={muted ? 'Ativar som' : 'Desativar som'}
          onClick={(e) => {
            // stopPropagation pro click no botão não disparar play/pause do video.
            e.stopPropagation();
            onToggleMute();
          }}
          className="absolute right-2.5 bottom-2.5 w-8 h-8 rounded-full border-0 bg-black/55 text-white flex items-center justify-center cursor-pointer"
        >
          <MuteIcon muted={muted} />
        </button>
      </div>
    );
  }

  if (imgError) {
    return (
      <div
        className="w-full bg-[color:var(--color-border)] flex items-center justify-center text-[color:var(--color-muted)] text-sm"
        style={{ aspectRatio: '1 / 1' }}
      >
        Imagem indisponível
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setImgError(true)}
      className="w-full block object-cover"
      style={{
        aspectRatio: '1 / 1',
        // Placeholder com cor cream do brand enquanto image carrega — evita
        // flash branco e dá sensação de "tá vindo" em vez de "broken".
        background: 'linear-gradient(135deg, #f5e8da 0%, #e8d6c0 100%)',
      }}
    />
  );
}

// Ícone SVG inline (mesmas formas do vanilla _feedVolIcon). Inline em vez de
// arquivo separado porque é tiny e usado só aqui.
function MuteIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}
