// ArtAROverlay — projeta uma arte (imagem) sobre o vídeo da câmera ao
// vivo pra grafiteiro/pintor traçar na parede.
//
// Setup espelha o WallARView (camera ao vivo via getUserMedia, sem
// MediaPipe — não tem segmentação aqui). Imagem é renderizada absoluta
// sobre o vídeo com transform translate/scale/rotate. Touch handlers:
//   - 1 finger: drag (translate)
//   - 2 fingers: pinch (scale) + rotate (twist)
// Slider de opacidade controla o alpha global da imagem. Botões de Espelhar
// (↔ / ↕) e Girar 90° pra ajuste fino — pinça+giro é bom pra alinhar, ruim
// pra "virar do avesso".
// Botão "Capturar" composita vídeo + imagem num canvas e entrega a PNG por
// `shareOrDownloadImage` (share nativo → Filesystem da casca → download).
// Era um `<a download>` de blob: — funciona no navegador do PC e NÃO FAZ NADA
// na WebView do app Android (o mesmo buraco que o Arte pra IG já tinha
// fechado). Visto no aparelho em 2026-09-07.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '@/lib/toast';
import { shareOrDownloadImage } from '@/lib/utils/shareOrDownloadImage';

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
  flipX: boolean;  // espelhado na horizontal
  flipY: boolean;  // espelhado na vertical
  yaw: number;     // giro "em pé", em torno do eixo vertical (graus, 0-360)
  pitch: number;   // inclinação, em torno do eixo horizontal (graus, 0-360)
}

const INITIAL_TRANSFORM: Transform = {
  x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false, yaw: 0, pitch: 0,
};

/**
 * CSS e canvas usam a MESMA ordem: translate → rotate → giro 3D → scale.
 *
 * O giro 3D (yaw/pitch) é ORTOGRÁFICO de propósito — `rotateY` sem
 * `perspective` no CSS é exatamente "largura × cos(ângulo)", que o canvas 2D
 * reproduz com um scale. Com perspectiva a prévia ficaria mais bonita e a
 * captura (canvas 2D não projeta) mentiria sobre ela. É o mesmo "girar em
 * pé 360°" do modo WebXR, que só existe no Chrome Android com ARCore.
 */
function cssTransform(t: Transform): string {
  const sx = t.flipX ? -t.scale : t.scale;
  const sy = t.flipY ? -t.scale : t.scale;
  return `translate(-50%, -50%) translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) rotateY(${t.yaw}deg) rotateX(${t.pitch}deg) scale(${sx}, ${sy})`;
}
/** O que o giro 3D ortográfico faz com largura/altura (o mesmo que o CSS). */
function escala3d(t: Transform): { kx: number; ky: number } {
  return {
    kx: Math.cos((t.yaw * Math.PI) / 180),
    ky: Math.cos((t.pitch * Math.PI) / 180),
  };
}

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
  // Pede a câmera só depois de explicar o motivo (Google Play: rationale antes
  // do prompt do sistema). camStarted=false → mostra a tela de justificativa.
  const [camStarted, setCamStarted] = useState(false);

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
    if (!open || !camStarted) return;
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
  }, [open, camStarted]);

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
        ...g.transform, // preserva flipX/flipY
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

  // ─── capturar: composita vídeo + imagem num canvas e entrega a PNG ───────
  const [capturing, setCapturing] = useState(false);
  async function handleCapture() {
    if (capturing) return;
    setCapturing(true);
    try {
      const status = await capturar();
      if (status === 'shared') showToast('Imagem compartilhada', 'success');
      else if (status === 'downloaded') showToast('Imagem salva no aparelho', 'success');
      else if (status === 'failed') showToast('Não deu para salvar a imagem', 'error');
      // 'cancelled': a pessoa fechou o compartilhar — silêncio.
    } catch (e) {
      showToast((e as Error).message || 'Não deu para capturar', 'error');
    } finally {
      setCapturing(false);
    }
  }

  async function capturar(): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
    if (!videoRef.current || !containerRef.current) return 'failed';
    const video = videoRef.current;
    const cont = containerRef.current;
    const W = video.videoWidth || 1280;
    const H = video.videoHeight || 720;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'failed';
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
    // Mesma ordem do CSS (cssTransform): rotate, giro 3D ortográfico e
    // depois scale com espelho.
    const { kx, ky } = escala3d(transform);
    ctx.scale(
      kx * (transform.flipX ? -transform.scale : transform.scale),
      ky * (transform.flipY ? -transform.scale : transform.scale),
    );
    ctx.globalAlpha = opacity;
    ctx.drawImage(img, -baseW * sx / 2, -baseH * sy / 2, baseW * sx, baseH * sy);
    ctx.restore();

    // toDataURL estoura SecurityError se a imagem taintou o canvas (CORS) —
    // vira toast em vez de silêncio.
    const dataUrl = canvas.toDataURL('image/png');
    const nome = `ar-${(title || 'arte').replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.png`;
    return shareOrDownloadImage(dataUrl, nome);
  }

  function girar90() {
    setTransform((t) => ({ ...t, rotation: (t.rotation + 90) % 360 }));
  }
  function espelharX() {
    setTransform((t) => ({ ...t, flipX: !t.flipX }));
  }
  function espelharY() {
    setTransform((t) => ({ ...t, flipY: !t.flipY }));
  }

  if (!open) return null;

  // Rationale antes de pedir a câmera (Google Play / transparência).
  if (!camStarted) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Permissão de câmera"
        style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      >
        <div className="bg-[color:var(--color-white)] rounded-2xl max-w-sm w-full p-5 text-center">
          <div style={{ fontSize: 40 }} aria-hidden="true">📷</div>
          <h2 className="text-lg font-bold text-[color:var(--color-ink)] mt-1 mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            Usar a câmera
          </h2>
          <p className="text-sm text-[color:var(--color-muted)] mb-4 leading-relaxed">
            Precisamos da câmera para <b>projetar a arte na parede em tempo
            real</b>. A imagem fica só no seu aparelho — nada é enviado ou
            gravado sem você tocar em &quot;Capturar&quot;.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-bold border border-[color:var(--color-border)] text-[color:var(--color-ink)]"
            >
              Agora não
            </button>
            <button
              type="button"
              onClick={() => setCamStarted(true)}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
              style={{ background: 'var(--color-p1)' }}
            >
              Ativar câmera
            </button>
          </div>
        </div>
      </div>
    );
  }

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
              transform: cssTransform(transform),
              transformOrigin: 'center',
              opacity,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : null}
      </div>

      {/* Bottom bar: espelhar/girar + slider opacidade + capturar */}
      <div
        style={{
          padding: '12px 16px calc(14px + env(safe-area-inset-bottom))',
          background: 'rgba(0,0,0,.85)',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <BotaoAjuste onClick={espelharX} ativo={transform.flipX} rotulo="↔ Espelhar" aria="Espelhar na horizontal" />
          <BotaoAjuste onClick={espelharY} ativo={transform.flipY} rotulo="↕ Espelhar" aria="Espelhar na vertical" />
          <BotaoAjuste onClick={girar90} ativo={false} rotulo="↻ Girar 90°" aria="Girar 90 graus" />
        </div>
        <Deslizador
          rotulo="Girar em pé"
          valor={transform.yaw}
          onChange={(v) => setTransform((t) => ({ ...t, yaw: v }))}
          aria="Girar em torno do eixo vertical"
        />
        <Deslizador
          rotulo="Inclinar"
          valor={transform.pitch}
          onChange={(v) => setTransform((t) => ({ ...t, pitch: v }))}
          aria="Inclinar em torno do eixo horizontal"
        />
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
          disabled={status !== 'ready' || capturing}
          style={{
            width: '100%',
            padding: 14,
            background: 'var(--color-p1, #ff6b35)',
            color: '#fff',
            border: 'none',
            borderRadius: 14,
            fontSize: 14,
            fontWeight: 700,
            cursor: capturing ? 'wait' : 'pointer',
            opacity: capturing ? 0.7 : 1,
          }}
        >
          {capturing ? 'Salvando…' : '📸 Capturar'}
        </button>
        <p style={{ fontSize: 10, opacity: 0.7, marginTop: 8, textAlign: 'center' }}>
          1 dedo: mover · 2 dedos: zoom + girar
        </p>
      </div>
    </div>
  );
}

function Deslizador({
  rotulo,
  valor,
  onChange,
  aria,
}: {
  rotulo: string;
  valor: number;
  onChange: (v: number) => void;
  aria: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, minWidth: 64 }}>{rotulo}</span>
      <input
        type="range"
        min={0}
        max={360}
        step={1}
        value={valor}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        onDoubleClick={() => onChange(0)}
        aria-label={aria}
        style={{ flex: 1 }}
      />
      <span style={{ fontSize: 11, minWidth: 36, textAlign: 'right' }}>{valor}°</span>
    </div>
  );
}

function BotaoAjuste({
  onClick,
  ativo,
  rotulo,
  aria,
}: {
  onClick: () => void;
  ativo: boolean;
  rotulo: string;
  aria: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      aria-pressed={ativo}
      style={{
        flex: 1,
        padding: '9px 6px',
        background: ativo ? 'var(--color-p1, #ff6b35)' : 'rgba(255,255,255,.14)',
        color: '#fff',
        border: 'none',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {rotulo}
    </button>
  );
}
