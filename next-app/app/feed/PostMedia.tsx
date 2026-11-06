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
import { isVideoPost } from '@/lib/utils';
import { cfImg, cfImgSrcSet } from '@/lib/cfImg';
import { reportFailure } from '@/lib/utils/reportFailure';

export interface PostMediaProps {
  url: string;
  mediaType?: string | null;
  // Wave 17 (P4): width/height da mídia capturados no upload. Quando
  // presentes, viram atributo do <img>/<video> e o browser reserva o
  // espaço exato antes da imagem chegar (CLS=0). Posts antigos sem
  // dimensões caem no aspect-ratio CSS 1/1 como hoje.
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  // Proporção IMPOSTA ao quadro (CSS `aspect-ratio`, ex.: "4 / 5"). O
  // carrossel usa pra todas as fotos terem a MESMA altura (a da primeira);
  // sem isto a segunda foto caía no quadrado 1:1 e saía cortada. Post de
  // foto única não passa nada e segue na proporção natural.
  aspectRatio?: string | null;
  // Controle do mute compartilhado entre todos os vídeos do feed (estilo IG:
  // mexeu no mute de um, mexeu em todos). Lifted state — FeedView mantém e
  // passa pra cá.
  muted: boolean;
  onToggleMute: () => void;
}

export function PostMedia({ url, mediaType, mediaWidth, mediaHeight, aspectRatio, muted, onToggleMute }: PostMediaProps) {
  const isVideo = isVideoPost(url, mediaType);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // tocando: dirige o overlay de play. No WebView do wrapper (WebIntoApp) o
  // play() disparado pelo IntersectionObserver NÃO é gesto do usuário e é
  // bloqueado — o vídeo ficava parado mostrando o play cinza gigante do
  // sistema (visto em produção, 2026-09-02). O story nunca sofreu disso
  // porque abre com um toque. Aqui: um seek mínimo pinta o primeiro quadro
  // (mata o placeholder do sistema) e o botão ▶ nosso dá o gesto que
  // destrava o play.
  //
  // fase (2026-11-06): o ▶ aparecia também enquanto o vídeo só estava
  // CARREGANDO — 3-4s de quadro preto com o botão de play, parecendo que
  // era pra tocar. Agora são cinco estados: 'fora' (abaixo), 'parado'
  // (pausado pela pessoa), 'carregando' (entrou na tela e o play foi pedido →
  // spinner discreto), 'tocando' (quadros saindo de verdade, evento
  // `playing`) e 'bloqueado' (o aparelho recusou o autoplay → ▶, que vira o
  // gesto que destrava).
  // 'fora' = fora da tela (ou ainda não sabemos): nada por cima. Sem isso o
  // ▶ aparecia no vídeo entrando na tela até o observer decidir tocar.
  // 'parado' fica só pra quem a PESSOA pausou.
  const [fase, setFase] = useState<'fora' | 'parado' | 'carregando' | 'tocando' | 'bloqueado'>('fora');
  // imgError: idem Avatar — fallback gracioso se a img der erro 403/404 em
  // vez de mostrar o ícone de imagem quebrada do browser.
  const [imgError, setImgError] = useState(false);
  // fallbackToOriginal: se a URL reescrita pelo cfImg (CF Image Resizing)
  // falhar, tenta a URL original do Supabase antes de mostrar placeholder.
  // Cobre o caso onde o toggle "Resize images from any origin" no painel
  // CF ainda está OFF — sem isso, /cdn-cgi/image/.../<supabase-url> 404a.
  const [fallbackToOriginal, setFallbackToOriginal] = useState(false);

  function handleImgError() {
    if (!fallbackToOriginal) {
      setFallbackToOriginal(true);
    } else {
      setImgError(true);
    }
  }

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
    // Sem observer (navegador muito antigo) não há autoplay; tocar no vídeo
    // continua dando play pelo onClick.
    if (typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting && en.intersectionRatio >= 0.55) {
            if (!el.paused) continue;
            setFase('carregando');
            const p = el.play();
            if (p) {
              p.catch(() => {
                // Autoplay recusado: aí sim o ▶ (o toque é o gesto que falta).
                setFase((f) => (f === 'carregando' ? 'bloqueado' : f));
              });
            }
            // Rede de segurança: WebView que recusa o autoplay sem rejeitar a
            // promessa deixaria o spinner girando pra sempre. Se depois de
            // 4s o vídeo segue pausado (buffering de verdade deixa
            // `paused=false`), mostra o ▶.
            window.setTimeout(() => {
              if (el.paused) setFase((f) => (f === 'carregando' ? 'bloqueado' : f));
            }, 4000);
          } else {
            // 'fora' antes do pause: o evento `pause` chega depois e o
            // onPause respeita o 'fora' (não foi a pessoa que pausou).
            setFase('fora');
            el.pause();
          }
        }
      },
      { threshold: [0, 0.55, 1] },
    );
    obs.observe(el);
    // Vídeo chegando perto da tela começa a baixar ANTES de aparecer: com
    // preload="metadata" o buffer só começava no play(), e era daí que vinha
    // a espera. Só os vizinhos da tela trocam pra "auto" — o resto do feed
    // continua baixando só os metadados.
    const perto = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting && el.preload !== 'auto') {
            el.preload = 'auto';
            perto.disconnect();
          }
        }
      },
      { rootMargin: '600px 0px' },
    );
    perto.observe(el);
    return () => {
      obs.disconnect();
      perto.disconnect();
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
          onLoadedMetadata={(e) => {
            // WebView Android não pinta o primeiro quadro de um vídeo parado
            // — fica o play cinza do sistema. Um seek mínimo força a pintura
            // (mesmo truque do extractVideoThumbnail). Se o autoplay rodar,
            // é invisível; se for bloqueado, o post mostra o quadro real.
            const v = e.currentTarget;
            try {
              if (v.currentTime === 0) v.currentTime = 0.001;
            } catch { /* seek indisponível — segue sem poster */ }
          }}
          onPlaying={() => setFase('tocando')}
          onWaiting={(e) => {
            if (!e.currentTarget.paused) setFase('carregando');
          }}
          onPause={() => setFase((f) => (f === 'fora' ? 'fora' : 'parado'))}
          onError={(e) => {
            // Vídeo que não carrega vira caixa preta com play morto — sem
            // isto, a falha morre na tela (foi o que escondeu o bloqueio de
            // media-src da CSP por semanas). Só reporta quando há erro real
            // de mídia (v.error), não em pause/seek. Best-effort.
            const v = e.currentTarget;
            const err = v.error;
            if (err) {
              reportFailure('video-fail', new Error(`media error code ${err.code}`), {
                ctx: url.slice(0, 200),
              });
            }
          }}
          onClick={(e) => {
            const v = e.currentTarget;
            if (v.paused) {
              setFase('carregando');
              const p = v.play();
              if (p) p.catch(() => setFase('bloqueado'));
            } else {
              v.pause();
            }
          }}
          className="w-full h-full object-cover block cursor-pointer"
        />
        {fase === 'carregando' && (
          <span
            role="status"
            aria-label="Carregando vídeo"
            className="video-carregando absolute inset-0 m-auto w-10 h-10 rounded-full pointer-events-none"
          />
        )}
        {(fase === 'parado' || fase === 'bloqueado') && (
          // Overlay ▶ enquanto o vídeo está parado: no wrapper o autoplay é
          // bloqueado, e este toque É um gesto — o play sai na hora. Nos
          // browsers em que o autoplay funciona, o `playing` esconde o botão.
          <button
            type="button"
            aria-label="Tocar vídeo"
            onClick={(e) => {
              e.stopPropagation();
              const v = videoRef.current;
              if (!v) return;
              setFase('carregando');
              const p = v.play();
              if (p) p.catch(() => setFase('bloqueado'));
            }}
            className="absolute inset-0 m-auto w-16 h-16 rounded-full border-0 bg-black/45 text-white flex items-center justify-center cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="#fff" aria-hidden="true">
              <polygon points="8 5 19 12 8 19 8 5" />
            </svg>
          </button>
        )}
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

  // Feed mobile-first: card é max-width 430px (BottomNav container) e ocupa
  // 100% width do viewport até 430. srcset cobre 1x/2x/3x até 430 (DPR=3).
  // sizes="(max-width: 430px) 100vw, 430px" ensina o browser a escolher.
  //
  // Wave 17: quando o post tem W/H reais (upload novo), passa como atributo
  // — o browser reserva espaço com a proporção exata. Sem W/H (posts
  // antigos), cai no aspect-ratio 1/1 do CSS (sem regressão).
  const hasDims = !!mediaWidth && !!mediaHeight && mediaWidth > 0 && mediaHeight > 0;
  return (
    <img
      src={fallbackToOriginal ? url : cfImg(url, { width: 430, fit: 'cover' })}
      srcSet={fallbackToOriginal ? undefined : cfImgSrcSet(url, 430, { fit: 'cover' })}
      sizes="(max-width: 430px) 100vw, 430px"
      alt=""
      width={hasDims ? mediaWidth! : undefined}
      height={hasDims ? mediaHeight! : undefined}
      loading="lazy"
      decoding="async"
      onError={handleImgError}
      className="w-full block object-cover"
      style={{
        // aspectRatio imposto (carrossel) ganha; senão hasDims deixa o
        // browser calcular do W/H; sem dims, fallback 1/1 (posts antigos).
        aspectRatio: aspectRatio ?? (hasDims ? undefined : '1 / 1'),
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
