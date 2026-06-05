'use client';
// WallARView — visualizador AR de cor de tinta na parede.
//
// Tecnologia: MediaPipe Image Segmenter com modelo `selfie_multiclass_256x256`
// (~2MB, GPU-accelerated WASM). O modelo segmenta a imagem em 6 classes:
// 0=background, 1=hair, 2=body-skin, 3=face-skin, 4=clothes, 5=others.
// "background" cobre o que NÃO é pessoa — em quartos vazios = parede.
//
// Render loop: cada frame do <video> → segmentForVideo() → categoryMask.
// Pinta os pixels da máscara (cat=0) com a cor do produto via canvas
// `globalCompositeOperation = 'color'` (mantém luminância do original, troca
// matiz+saturação) — GPU, sem laço por-pixel em JS.
//
// Carregamento: MediaPipe é dynamic-imported só quando o modal abre, pra não
// inflar o bundle inicial. WASM + modelo vêm de cdn.jsdelivr/storage.googleapis
// (liberados no CSP).

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  /** Cor hex do produto (ex.: '#a52a2a'). */
  color: string;
  productName: string;
  onClose: () => void;
}

type Status = 'loading-model' | 'loading-camera' | 'ready' | 'denied' | 'error';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

export function WallARView({ open, color, productName, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Offscreen canvas pra desenhar a máscara colorida (alpha = bg pixels).
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const segmenterRef = useRef<{
    segmentForVideo: (
      v: HTMLVideoElement,
      ts: number,
      cb: (r: { categoryMask: { getAsUint8Array: () => Uint8Array; width: number; height: number; close: () => void } | null }) => void,
    ) => void;
    close: () => void;
  } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [status, setStatus] = useState<Status>('loading-model');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);
  frozenRef.current = frozen;
  const colorRef = useRef(color);
  colorRef.current = color;

  // Faz tudo: carrega modelo, abre câmera, inicia loop. Cleanup completo
  // no return.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let localStream: MediaStream | null = null;

    async function init() {
      try {
        setStatus('loading-model');
        const vision = await import('@mediapipe/tasks-vision');
        if (cancelled) return;
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;
        const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
        if (cancelled) {
          segmenter.close();
          return;
        }
        segmenterRef.current = segmenter as unknown as typeof segmenterRef.current;

        setStatus('loading-camera');
        localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = localStream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = localStream;
        await v.play();
        setStatus('ready');
        startRenderLoop();
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setStatus('denied');
          setErrorMsg('Permissão de câmera negada. Habilite nas configurações do navegador.');
        } else {
          setStatus('error');
          setErrorMsg(
            (err as Error).message ||
              'Falha ao carregar IA ou câmera. Tenta de novo em instantes.',
          );
        }
      }
    }

    function startRenderLoop() {
      function tick() {
        rafRef.current = requestAnimationFrame(tick);
        if (frozenRef.current) return;
        const v = videoRef.current;
        const c = canvasRef.current;
        const seg = segmenterRef.current;
        if (!v || !c || !seg || v.readyState < 2 || v.videoWidth === 0) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;

        // Ajusta canvas pro tamanho do vídeo (1x).
        if (c.width !== v.videoWidth) c.width = v.videoWidth;
        if (c.height !== v.videoHeight) c.height = v.videoHeight;

        // 1) Frame original.
        ctx.drawImage(v, 0, 0, c.width, c.height);

        // 2) Segmentação → máscara categórica.
        seg.segmentForVideo(v, performance.now(), (result) => {
          if (frozenRef.current) {
            if (result.categoryMask) result.categoryMask.close();
            return;
          }
          const mask = result.categoryMask;
          if (!mask) return;
          paintBackground(ctx, c.width, c.height, mask, colorRef.current);
          mask.close();
        });
      }
      tick();
    }

    init();
    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (segmenterRef.current) {
        try { segmenterRef.current.close(); } catch { /* ignore */ }
        segmenterRef.current = null;
      }
      const v = videoRef.current;
      if (v) {
        try { v.pause(); } catch { /* ignore */ }
        v.srcObject = null;
      }
      const s = streamRef.current ?? localStream;
      if (s) {
        s.getTracks().forEach((t) => {
          try { t.stop(); } catch { /* ignore */ }
        });
      }
      streamRef.current = null;
    };
  }, [open]);

  const paintBackground = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      mainW: number,
      mainH: number,
      mask: { getAsUint8Array: () => Uint8Array; width: number; height: number },
      hex: string,
    ) => {
      const rgb = hexToRgb(hex);
      if (!rgb) return;
      const maskW = mask.width;
      const maskH = mask.height;
      const maskData = mask.getAsUint8Array();

      // Reutiliza offscreen canvas (alocar por frame = jank).
      let off = maskCanvasRef.current;
      if (!off) {
        off = document.createElement('canvas');
        maskCanvasRef.current = off;
      }
      if (off.width !== maskW) off.width = maskW;
      if (off.height !== maskH) off.height = maskH;
      const offCtx = off.getContext('2d');
      if (!offCtx) return;
      const img = offCtx.createImageData(maskW, maskH);
      const data = img.data;
      // Categoria 0 = background → pinta com a cor (alpha 255). Resto = alpha 0.
      for (let i = 0; i < maskData.length; i += 1) {
        const j = i * 4;
        if (maskData[i] === 0) {
          data[j] = rgb.r;
          data[j + 1] = rgb.g;
          data[j + 2] = rgb.b;
          data[j + 3] = 255;
        } else {
          data[j + 3] = 0;
        }
      }
      offCtx.putImageData(img, 0, 0);

      // Blend 'color' = luminância do bottom + matiz+saturação do top.
      // Pinta só onde alpha > 0 (regiões de background).
      ctx.save();
      ctx.globalCompositeOperation = 'color';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, mainW, mainH);
      ctx.restore();
    },
    [],
  );

  const handleCapture = useCallback(() => {
    setFrozen((f) => !f);
  }, []);

  const handleSave = useCallback(async () => {
    const c = canvasRef.current;
    if (!c) return;
    const slug = productName.replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 40) || 'cor';
    const filename = `quc-${slug}-${Date.now()}.png`;
    c.toBlob(async (blob) => {
      if (!blob) return;
      // Tenta Web Share API (mobile) primeiro — abre planilha de share nativa.
      const file = new File([blob], filename, { type: 'image/png' });
      const navAny = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (navAny.canShare && navAny.canShare({ files: [file] }) && navAny.share) {
        try {
          await navAny.share({
            files: [file],
            title: 'Cor escolhida no QueroUmaCor',
            text: `Olha como fica essa parede com ${productName}!`,
          });
          return;
        } catch {
          /* user cancelou — cai pro download */
        }
      }
      // Fallback: download direto.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }, [productName]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizar ${productName} na parede`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Video element: escondido — só fonte do frame. Canvas é a saída visível. */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ display: 'none' }}
      />
      <canvas
        ref={canvasRef}
        aria-label="Pré-visualização da parede pintada"
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#000',
        }}
      />

      {/* Header: nome do produto + swatch da cor + fechar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '14px 16px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,.55), transparent)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: color,
            border: '2px solid #fff',
            boxShadow: '0 1px 6px rgba(0,0,0,.4)',
            flexShrink: 0,
          }}
        />
        <div
          style={{
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            lineHeight: 1.2,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {productName}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            background: 'rgba(0,0,0,.55)',
            border: '1px solid rgba(255,255,255,.2)',
            color: '#fff',
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      {/* Status overlay (loading / error / denied) */}
      {status !== 'ready' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,.85)',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
            gap: 14,
          }}
        >
          {status === 'loading-model' ? (
            <>
              <Spinner />
              <div style={{ fontSize: 15, fontWeight: 700 }}>Carregando IA…</div>
              <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 280 }}>
                Primeira vez leva uns segundos pra baixar o modelo (~2MB).
              </div>
            </>
          ) : status === 'loading-camera' ? (
            <>
              <Spinner />
              <div style={{ fontSize: 15, fontWeight: 700 }}>Abrindo câmera…</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 40 }} aria-hidden="true">
                {status === 'denied' ? '🔒' : '⚠️'}
              </div>
              <div style={{ fontSize: 14, maxWidth: 320, lineHeight: 1.5 }}>
                {errorMsg}
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  marginTop: 8,
                  padding: '10px 20px',
                  borderRadius: 12,
                  background: 'var(--color-p1, #ff6b35)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Fechar
              </button>
            </>
          )}
        </div>
      )}

      {/* Footer: hint + botões */}
      {status === 'ready' && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '14px 16px 22px',
            background: 'linear-gradient(to top, rgba(0,0,0,.65), transparent)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {!frozen ? (
            <>
              <div
                style={{
                  color: '#fff',
                  fontSize: 12,
                  opacity: 0.9,
                  textAlign: 'center',
                  maxWidth: 320,
                  textShadow: '0 1px 4px rgba(0,0,0,.6)',
                }}
              >
                Aponta a câmera pra parede. A IA pinta o fundo na hora.
              </div>
              <button
                type="button"
                onClick={handleCapture}
                aria-label="Capturar foto"
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: 34,
                  background: '#fff',
                  border: '4px solid rgba(255,255,255,.45)',
                  cursor: 'pointer',
                }}
              />
            </>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setFrozen(false)}
                style={{
                  padding: '12px 18px',
                  borderRadius: 12,
                  background: 'rgba(0,0,0,.65)',
                  border: '1.5px solid rgba(255,255,255,.3)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                🔄 De novo
              </button>
              <button
                type="button"
                onClick={handleSave}
                style={{
                  padding: '12px 22px',
                  borderRadius: 12,
                  background: 'var(--color-p1, #ff6b35)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(255,107,53,.4)',
                }}
              >
                💾 Salvar / Compartilhar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '3px solid rgba(255,255,255,.2)',
          borderTopColor: '#fff',
          animation: 'wallar-spin 800ms linear infinite',
        }}
      />
      <style>{`
        @keyframes wallar-spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) {
    // 3-char form
    const m3 = hex.trim().match(/^#?([0-9a-f]{3})$/i);
    if (!m3) return null;
    const v = m3[1];
    return {
      r: parseInt(v[0] + v[0], 16),
      g: parseInt(v[1] + v[1], 16),
      b: parseInt(v[2] + v[2], 16),
    };
  }
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}
