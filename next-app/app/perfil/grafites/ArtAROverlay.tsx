// ArtAROverlay — projeta uma arte (imagem) sobre o vídeo da câmera ao
// vivo pra grafiteiro/pintor traçar na parede.
//
// Setup espelha o WallARView (camera ao vivo via getUserMedia, sem
// MediaPipe — não tem segmentação aqui). Imagem é renderizada absoluta
// sobre o vídeo com transform translate/scale/rotate. Touch handlers:
//   - 1 finger: drag (translate)
//   - 2 fingers: pinch (scale) + rotate (twist)
// Slider de opacidade controla o alpha global da imagem.
// Botão "Capturar" composita vídeo + imagem num canvas e dispara
// download da PNG.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  imageUrl: string;
  title?: string | null;
  onClose: () => void;
}

interface Transform {
  x: number;       // translate X (px relativo ao centro do container)
  y: number;       // translate Y
  scale: number;   // multiplicador (1 = tamanho natural responsivo)
  rotation: number; // graus
}

const INITIAL_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0 };

// Type comum entre React.Touch e DOM Touch — só usamos clientX/clientY.
interface XYTouch {
  clientX: number;
  clientY: number;
}

function distance(t1: XYTouch, t2: XYTouch): number {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}

function angle(t1: XYTouch, t2: XYTouch): number {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);
}

export function ArtAROverlay({ open, imageUrl, title, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [transform, setTransform] = useState<Transform>(INITIAL_TRANSFORM);
  const [opacity, setOpacity] = useState(0.55);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Snapshot inicial do gesto (1 ou 2 dedos) pra calcular delta.
  const gestureRef = useRef<{
    transform: Transform;
    dist?: number;
    angle?: number;
    cx?: number;  // centro dos 2 dedos (pra drag combinado com pinch)
    cy?: number;
  } | null>(null);

  // ─── câmera (back camera quando disponível) ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let localStream: MediaStream | null = null;

    (async () => {
      try {
        setStatus('loading');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStream = stream;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus('ready');
      } catch (e) {
        const name = (e as { name?: string })?.name ?? '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setStatus('denied');
          setErrorMsg('Permissão de câmera negada.');
        } else {
          setStatus('error');
          setErrorMsg(e instanceof Error ? e.message : 'Erro ao acessar câmera.');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [open]);

  // ─── touch handlers no container ─────────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      gestureRef.current = { transform: { ...transform } };
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0]!;
      const t2 = e.touches[1]!;
      gestureRef.current = {
        transform: { ...transform },
        dist: distance(t1, t2),
        angle: angle(t1, t2),
        cx: (t1.clientX + t2.clientX) / 2,
        cy: (t1.clientY + t2.clientY) / 2,
      };
    }
  }, [transform]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    e.preventDefault();

    if (e.touches.length === 1) {
      // Drag puro: delta = pos atual - pos inicial guardada implicitamente.
      // Usamos changedTouches[0] direto: calculamos delta vs primeiro touch
      // do gesto (que está em g.transform; precisamos da pos do touch inicial
      // pra calcular delta). Como não guardamos a pos inicial do touch,
      // re-snapshotamos a cada move: ajustamos delta in-place.
      const t = e.touches[0]!;
      const startX = (g as { startX?: number }).startX;
      const startY = (g as { startY?: number }).startY;
      if (startX === undefined || startY === undefined) {
        (g as { startX?: number; startY?: number }).startX = t.clientX;
        (g as { startX?: number; startY?: number }).startY = t.clientY;
        return;
      }
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      setTransform({ ...g.transform, x: g.transform.x + dx, y: g.transform.y + dy });
    } else if (e.touches.length === 2 && g.dist !== undefined && g.angle !== undefined && g.cx !== undefined && g.cy !== undefined) {
      const t1 = e.touches[0]!;
      const t2 = e.touches[1]!;
      const newDist = distance(t1, t2);
      const newAngle = angle(t1, t2);
      const newCx = (t1.clientX + t2.clientX) / 2;
      const newCy = (t1.clientY + t2.clientY) / 2;
      const scaleDelta = newDist / g.dist;
      const rotDelta = newAngle - g.angle;
      const cxDelta = newCx - g.cx;
      const cyDelta = newCy - g.cy;
      setTransform({
        x: g.transform.x + cxDelta,
        y: g.transform.y + cyDelta,
        // Cap pra não inverter ou ficar gigante: [0.2, 8]
        scale: Math.max(0.2, Math.min(8, g.transform.scale * scaleDelta)),
        rotation: g.transform.rotation + rotDelta,
      });
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 0) {
      gestureRef.current = null;
    } else if (e.touches.length === 1) {
      // Saiu de 2 dedos pra 1: re-snapshot pra drag continuar sem pulo.
      gestureRef.current = { transform: { ...transform } };
    }
  }, [transform]);

  // ─── capturar: composita vídeo + imagem num canvas e baixa PNG ────────────
  async function handleCapture() {
    if (!videoRef.current || !containerRef.current) return;
    const video = videoRef.current;
    const cont = containerRef.current;
    const W = video.videoWidth || 1280;
    const H = video.videoHeight || 720;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, W, H);

    // Renderiza a imagem com o MESMO transform mas em coords do video.
    // Container/viewport pode ser menor que video — escala proporcional.
    const contRect = cont.getBoundingClientRect();
    const sx = W / contRect.width;
    const sy = H / contRect.height;
    // Carrega a imagem (crossOrigin pra não taintar canvas).
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Falha ao carregar imagem pra captura'));
      img.src = imageUrl;
    });

    // Tamanho base da imagem na viewport: 60% da largura, mantendo aspect.
    const baseW = contRect.width * 0.6;
    const aspect = img.naturalWidth / img.naturalHeight || 1;
    const baseH = baseW / aspect;
    const cx = contRect.width / 2 + transform.x;
    const cy = contRect.height / 2 + transform.y;

    ctx.save();
    ctx.translate(cx * sx, cy * sy);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale, transform.scale);
    ctx.globalAlpha = opacity;
    ctx.drawImage(img, -baseW * sx / 2, -baseH * sy / 2, baseW * sx, baseH * sy);
    ctx.restore();

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ar-${(title || 'arte').replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AR — projetar arte na parede"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header com X */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          background: 'rgba(0,0,0,.55)',
          color: '#fff',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          style={{
            background: 'rgba(255,255,255,.18)',
            border: 'none',
            color: '#fff',
            width: 36,
            height: 36,
            borderRadius: 18,
            fontSize: 20,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title || 'Projetar arte'}</div>
        <button
          type="button"
          onClick={() => setTransform(INITIAL_TRANSFORM)}
          aria-label="Resetar posição"
          style={{
            background: 'rgba(255,255,255,.18)',
            border: 'none',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Resetar
        </button>
      </div>

      {/* Container do vídeo + imagem (touch-area) */}
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        {status === 'loading' ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <div>Carregando câmera…</div>
          </div>
        ) : status !== 'ready' ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 20, color: '#fff', textAlign: 'center' }}>
            <div style={{ fontSize: 32 }} aria-hidden="true">📷</div>
            <div>{errorMsg || 'Câmera indisponível'}</div>
          </div>
        ) : null}

        {/* Imagem overlay */}
        {status === 'ready' ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl}
            alt={title ?? 'Arte'}
            crossOrigin="anonymous"
            draggable={false}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '60%',  // base — pinch escala daqui
              transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
              transformOrigin: 'center',
              opacity,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : null}
      </div>

      {/* Bottom bar: slider opacidade + capturar */}
      <div
        style={{
          padding: '14px 16px calc(14px + env(safe-area-inset-bottom))',
          background: 'rgba(0,0,0,.85)',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, minWidth: 64 }}>Opacidade</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            aria-label="Opacidade da imagem"
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 11, minWidth: 36, textAlign: 'right' }}>
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <button
          type="button"
          onClick={handleCapture}
          disabled={status !== 'ready'}
          style={{
            width: '100%',
            padding: 14,
            background: 'var(--color-p1, #ff6b35)',
            color: '#fff',
            border: 'none',
            borderRadius: 14,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          📸 Capturar
        </button>
        <p style={{ fontSize: 10, opacity: 0.7, marginTop: 8, textAlign: 'center' }}>
          1 dedo: mover · 2 dedos: zoom + girar
        </p>
      </div>
    </div>
  );
}
