'use client';
// WallARView — visualizador "Ver na parede" com 2 modos:
//
// 🤖 IA (live-ai): câmera ao vivo + segmentação MediaPipe em tempo real.
//   Modelo selfie_multiclass_256x256, categoria 0 = background ≈ parede.
//   Pinta o fundo automaticamente. Capturar congela.
//
// 🎨 Pincel (foto-brush): captura foto da câmera, depois usuário arrasta
//   o dedo na tela pra pintar regiões específicas com a cor do produto.
//   Borracha (destination-out) apaga. Útil quando a IA não cobre certo
//   ou quando o usuário quer pintar uma área específica (parte da parede,
//   um móvel, etc.) sem AI-magia.
//
// Blend: 'multiply' (não 'color'). Pixel resultante = top × bottom / 255.
// Branco × vermelho = vermelho real. Sombra × vermelho = vermelho escuro.
// Comportamento de tinta REAL em parede; o blend 'color' antigo desaturava
// porque preservava a luminância alta da parede branca.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useColorMatch } from '@/lib/hooks/useColorMatch';
import { rgbToHex, type ColorMatch } from '@/lib/services/colorMatch';

const BRL_FMT = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Rótulo qualitativo do ΔE (CIE76) pra leigo: quão perto a tinta está.
function deltaELabel(d: number): string {
  if (d < 2.3) return 'idêntica';
  if (d < 6) return 'bem próxima';
  if (d < 12) return 'próxima';
  return 'parecida';
}

interface Props {
  open: boolean;
  /** Cor hex do produto (ex.: '#a52a2a'). */
  color: string;
  productName: string;
  onClose: () => void;
}

type Mode = 'ai' | 'brush';
type Phase = 'init' | 'live' | 'captured';
type Status = 'loading-model' | 'loading-camera' | 'ready' | 'denied' | 'error';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

const BRUSH_SIZES = [40, 80, 140] as const;

type Segmenter = {
  segmentForVideo: (
    v: HTMLVideoElement,
    ts: number,
    cb: (r: { categoryMask: { getAsUint8Array: () => Uint8Array; width: number; height: number; close: () => void } | null }) => void,
  ) => void;
  close: () => void;
};

export function WallARView({ open, color, productName, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Offscreen pra máscara da IA (alpha = bg pixels) — multiply na main.
  const aiMaskRef = useRef<HTMLCanvasElement | null>(null);
  // Pincel: foto congelada original + máscara de pintura (cor + alpha).
  const capturedRef = useRef<HTMLCanvasElement | null>(null);
  const paintMaskRef = useRef<HTMLCanvasElement | null>(null);
  // Último ponto do pincel pra desenhar linha contínua entre frames.
  const lastBrushPointRef = useRef<{ x: number; y: number } | null>(null);

  const segmenterRef = useRef<Segmenter | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Default 'brush' (jun/2026): o modelo selfie_multiclass não distingue
  // parede de chão/móveis quando não tem pessoa no frame — pintava tudo
  // de uma cor só. Brush manual ficou superior na prática. IA continua
  // disponível pelo toggle pra quem quiser experimentar.
  const [mode, setMode] = useState<Mode>('brush');
  const [phase, setPhase] = useState<Phase>('init');
  const [status, setStatus] = useState<Status>('loading-camera');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [brushSize, setBrushSize] = useState<number>(BRUSH_SIZES[1]);
  const [tool, setTool] = useState<'paint' | 'erase'>('paint');

  // Eyedropper: toca na câmera/parede pra identificar a cor e cruzar com a loja.
  const [eyedropper, setEyedropper] = useState(false);
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  const [matches, setMatches] = useState<ColorMatch[]>([]);
  const [matchOpen, setMatchOpen] = useState(false);
  const { nearest, ready: catalogReady, loading: catalogLoading } = useColorMatch();

  // Refs pra acessar dentro do RAF sem re-trigger.
  const modeRef = useRef<Mode>(mode);
  const phaseRef = useRef<Phase>(phase);
  const colorRef = useRef<string>(color);
  modeRef.current = mode;
  phaseRef.current = phase;
  colorRef.current = color;

  // ─── inicialização: câmera + (se modo ai) modelo ────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let localStream: MediaStream | null = null;

    async function init() {
      try {
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
        if (cancelled) return;

        setStatus('ready');
        setPhase('live');
        startRenderLoop();
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setStatus('denied');
          setErrorMsg('Permissão de câmera negada. Habilite nas configurações do navegador.');
        } else {
          setStatus('error');
          setErrorMsg((err as Error).message || 'Falha ao abrir a câmera.');
        }
      }
    }

    function startRenderLoop() {
      function tick() {
        rafRef.current = requestAnimationFrame(tick);
        const v = videoRef.current;
        const c = canvasRef.current;
        if (!v || !c || v.readyState < 2 || v.videoWidth === 0) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;

        // Ajusta canvas pro tamanho do vídeo.
        if (c.width !== v.videoWidth) c.width = v.videoWidth;
        if (c.height !== v.videoHeight) c.height = v.videoHeight;

        if (phaseRef.current === 'captured') {
          // Render estático já está na tela. Não redesenha (pra não bater
          // em cima do pincel que o usuário tá pintando agora).
          return;
        }

        // ── phase: live ──
        ctx.drawImage(v, 0, 0, c.width, c.height);

        if (modeRef.current === 'ai' && segmenterRef.current) {
          // Roda IA + pinta o fundo.
          segmenterRef.current.segmentForVideo(v, performance.now(), (result) => {
            if (phaseRef.current !== 'live' || modeRef.current !== 'ai') {
              if (result.categoryMask) result.categoryMask.close();
              return;
            }
            const mask = result.categoryMask;
            if (!mask) return;
            paintBackgroundWithAiMask(ctx, c.width, c.height, mask, colorRef.current);
            mask.close();
          });
        }
        // Modo brush em live: só mostra o vídeo cru — pintura só após capturar.
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
        s.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      }
      streamRef.current = null;
    };
  }, [open]);

  // ─── carrega MediaPipe sob demanda quando entra em modo IA ──────────────
  useEffect(() => {
    if (!open || mode !== 'ai' || segmenterRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading-model');
        const vision = await import('@mediapipe/tasks-vision');
        if (cancelled) return;
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;
        const segmenter = (await vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        })) as unknown as Segmenter;
        if (cancelled) {
          segmenter.close();
          return;
        }
        segmenterRef.current = segmenter;
        // Se a câmera já tá pronta, volta pro status ready.
        if (videoRef.current?.readyState && videoRef.current.readyState >= 2) {
          setStatus('ready');
        }
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg((e as Error).message || 'Falha ao carregar modelo de IA.');
      }
    })();
    return () => { cancelled = true; };
  }, [open, mode]);

  // ─── pintura: IA (multiply blend) ───────────────────────────────────────
  const paintBackgroundWithAiMask = useCallback(
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

      // Composição multi-step pra usar 'multiply' SÓ na região de bg:
      //  (1) gera offscreen com `target color` onde mask=0 e BRANCO onde mask≠0
      //      (branco × bottom = bottom; vermelho × bottom = bottom tingido)
      //  (2) globalCompositeOperation='multiply' aplica em toda a main, mas
      //      como as áreas não-bg estão BRANCAS, ficam inalteradas.
      let off = aiMaskRef.current;
      if (!off) {
        off = document.createElement('canvas');
        aiMaskRef.current = off;
      }
      if (off.width !== maskW) off.width = maskW;
      if (off.height !== maskH) off.height = maskH;
      const offCtx = off.getContext('2d');
      if (!offCtx) return;
      const img = offCtx.createImageData(maskW, maskH);
      const data = img.data;
      for (let i = 0; i < maskData.length; i += 1) {
        const j = i * 4;
        if (maskData[i] === 0) {
          // Background → cor do produto.
          data[j] = rgb.r;
          data[j + 1] = rgb.g;
          data[j + 2] = rgb.b;
          data[j + 3] = 255;
        } else {
          // Foreground (pessoa/cabelo/etc) → branco opaco (no-op em multiply).
          data[j] = 255;
          data[j + 1] = 255;
          data[j + 2] = 255;
          data[j + 3] = 255;
        }
      }
      offCtx.putImageData(img, 0, 0);

      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, mainW, mainH);
      ctx.restore();
    },
    [],
  );

  // ─── captura: congela frame ─────────────────────────────────────────────
  const handleCapture = useCallback(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const w = c.width;
    const h = c.height;

    if (mode === 'ai') {
      // Frame da IA já tá renderizado no canvas — só congela.
      setPhase('captured');
      return;
    }

    // Modo pincel: salva o frame original (sem pintura) em capturedRef +
    // inicializa máscara de pintura vazia. Renderiza só o original.
    let cap = capturedRef.current;
    if (!cap) {
      cap = document.createElement('canvas');
      capturedRef.current = cap;
    }
    cap.width = w;
    cap.height = h;
    const capCtx = cap.getContext('2d');
    if (!capCtx) return;
    capCtx.drawImage(v, 0, 0, w, h);

    let pm = paintMaskRef.current;
    if (!pm) {
      pm = document.createElement('canvas');
      paintMaskRef.current = pm;
    }
    pm.width = w;
    pm.height = h;
    const pmCtx = pm.getContext('2d');
    if (pmCtx) pmCtx.clearRect(0, 0, w, h);

    // Desenha frame cru na main.
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(cap, 0, 0, w, h);

    setPhase('captured');
  }, [mode]);

  // ─── pincel: pointer handlers ───────────────────────────────────────────
  const drawBrushStroke = useCallback(
    (fromX: number, fromY: number, toX: number, toY: number) => {
      const pm = paintMaskRef.current;
      const cap = capturedRef.current;
      const c = canvasRef.current;
      if (!pm || !cap || !c) return;
      const pmCtx = pm.getContext('2d');
      const mainCtx = c.getContext('2d');
      if (!pmCtx || !mainCtx) return;

      pmCtx.save();
      pmCtx.lineCap = 'round';
      pmCtx.lineJoin = 'round';
      pmCtx.lineWidth = brushSize;
      if (tool === 'paint') {
        pmCtx.globalCompositeOperation = 'source-over';
        pmCtx.strokeStyle = color;
      } else {
        // Borracha: apaga o que tem na máscara.
        pmCtx.globalCompositeOperation = 'destination-out';
        pmCtx.strokeStyle = 'rgba(0,0,0,1)';
      }
      pmCtx.beginPath();
      pmCtx.moveTo(fromX, fromY);
      pmCtx.lineTo(toX, toY);
      pmCtx.stroke();
      pmCtx.restore();

      // Re-compose: original + multiply paint mask.
      mainCtx.save();
      mainCtx.globalCompositeOperation = 'source-over';
      mainCtx.drawImage(cap, 0, 0);
      mainCtx.globalCompositeOperation = 'multiply';
      mainCtx.drawImage(pm, 0, 0);
      mainCtx.restore();
    },
    [brushSize, color, tool],
  );

  // Converte coords do pointer (CSS) pras coords do canvas (resolução real).
  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    // Object-fit: contain → calcular bounds reais da imagem dentro do rect.
    const canvasRatio = c.width / c.height;
    const rectRatio = rect.width / rect.height;
    let drawW: number, drawH: number, offsetX: number, offsetY: number;
    if (rectRatio > canvasRatio) {
      // Rect mais largo que canvas → pillarbox horizontal.
      drawH = rect.height;
      drawW = drawH * canvasRatio;
      offsetX = (rect.width - drawW) / 2;
      offsetY = 0;
    } else {
      drawW = rect.width;
      drawH = drawW / canvasRatio;
      offsetX = 0;
      offsetY = (rect.height - drawH) / 2;
    }
    const xInDraw = clientX - rect.left - offsetX;
    const yInDraw = clientY - rect.top - offsetY;
    return {
      x: (xInDraw / drawW) * c.width,
      y: (yInDraw / drawH) * c.height,
    };
  }, []);

  // Amostra a cor do pixel tocado no canvas (frame atual da câmera/pintura),
  // converte pra hex e cruza com o catálogo da loja (ΔE em Lab).
  const sampleColorAt = useCallback(
    (clientX: number, clientY: number) => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const p = getCanvasPoint(clientX, clientY);
      const x = Math.max(0, Math.min(c.width - 1, Math.round(p.x)));
      const y = Math.max(0, Math.min(c.height - 1, Math.round(p.y)));
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(x, y, 1, 1).data;
      } catch {
        return; // canvas tainted (não deve ocorrer com getUserMedia same-origin)
      }
      const hex = rgbToHex({ r: data[0]!, g: data[1]!, b: data[2]! });
      setPickedColor(hex);
      setMatches(nearest(hex, 12));
      setMatchOpen(true);
    },
    [getCanvasPoint, nearest],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (eyedropper) {
        e.preventDefault();
        sampleColorAt(e.clientX, e.clientY);
        return;
      }
      if (mode !== 'brush' || phase !== 'captured') return;
      e.preventDefault();
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      const p = getCanvasPoint(e.clientX, e.clientY);
      lastBrushPointRef.current = p;
      // Dot inicial (mover ainda não rolou) — desenha do mesmo ponto.
      drawBrushStroke(p.x, p.y, p.x, p.y);
    },
    [eyedropper, sampleColorAt, mode, phase, drawBrushStroke, getCanvasPoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (eyedropper) return;
      if (mode !== 'brush' || phase !== 'captured') return;
      const last = lastBrushPointRef.current;
      if (!last) return;
      const p = getCanvasPoint(e.clientX, e.clientY);
      drawBrushStroke(last.x, last.y, p.x, p.y);
      lastBrushPointRef.current = p;
    },
    [eyedropper, mode, phase, drawBrushStroke, getCanvasPoint],
  );

  const handlePointerUp = useCallback(() => {
    lastBrushPointRef.current = null;
  }, []);

  // ─── reset: volta pro live ──────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setPhase('live');
    lastBrushPointRef.current = null;
    // Limpa máscara de pintura (não precisa limpar capturedRef — será
    // sobrescrito no próximo capture).
    const pm = paintMaskRef.current;
    if (pm) {
      const pmCtx = pm.getContext('2d');
      if (pmCtx) pmCtx.clearRect(0, 0, pm.width, pm.height);
    }
  }, []);

  // ─── mode toggle ────────────────────────────────────────────────────────
  const handleModeChange = useCallback((next: Mode) => {
    setMode(next);
    // Trocar de modo reseta pro live pra não ficar em estado inconsistente.
    setPhase('live');
    lastBrushPointRef.current = null;
  }, []);

  // ─── salvar/share ───────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const c = canvasRef.current;
    if (!c) return;
    const slug = productName.replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 40) || 'cor';
    const filename = `quc-${slug}-${Date.now()}.png`;
    c.toBlob(async (blob) => {
      if (!blob) return;
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
        } catch { /* user cancelou — cai pro download */ }
      }
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

  const showLoadingOverlay = status !== 'ready' && status !== 'loading-model';
  const aiModeNotReady = mode === 'ai' && (!segmenterRef.current || status === 'loading-model');

  // Render via portal pro document.body. O ProductDetailSheet abre esse
  // overlay de DENTRO do BottomSheet, cujo painel anima com `transform`
  // (slideUp) — e `transform` cria um containing block, então um filho
  // `position: fixed` deixa de ser relativo ao viewport e fica preso/clipado
  // dentro do sheet. Resultado: o botão ✕ (e o resto dos controles) não
  // recebia clique. Portar pro body resolve o posicionamento; o zIndex
  // 1100 garante que o overlay fique ACIMA do backdrop do BottomSheet
  // (z-1000), senão o backdrop cobriria a câmera.
  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizar ${productName} na parede`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
      <canvas
        ref={canvasRef}
        aria-label="Pré-visualização da parede pintada"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#000',
          touchAction: eyedropper || (mode === 'brush' && phase === 'captured') ? 'none' : 'auto',
          cursor: eyedropper || (mode === 'brush' && phase === 'captured') ? 'crosshair' : 'default',
        }}
      />

      {/* Header: swatch + nome + fechar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '14px 16px 6px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,.65), transparent)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          pointerEvents: 'none',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block', width: 28, height: 28, borderRadius: '50%',
            background: color, border: '2px solid #fff',
            boxShadow: '0 1px 6px rgba(0,0,0,.4)', flexShrink: 0,
          }}
        />
        <div
          style={{
            color: '#fff', fontWeight: 700, fontSize: 13, lineHeight: 1.2,
            flex: 1, minWidth: 0, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {productName}
        </div>
        {/* Eyedropper: identifica a cor da parede e cruza com a loja. */}
        <button
          type="button"
          onClick={() => {
            setEyedropper((v) => {
              const next = !v;
              if (next) setMatchOpen(false);
              return next;
            });
          }}
          aria-label="Identificar cor na loja"
          aria-pressed={eyedropper}
          title="Identificar cor na loja"
          style={{
            width: 38, height: 38, borderRadius: 19,
            background: eyedropper ? 'var(--color-p1, #ff6b35)' : 'rgba(0,0,0,.55)',
            border: '1px solid rgba(255,255,255,.2)',
            color: '#fff', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'auto',
          }}
        >
          💧
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          style={{
            width: 38, height: 38, borderRadius: 19,
            background: 'rgba(0,0,0,.55)',
            border: '1px solid rgba(255,255,255,.2)',
            color: '#fff', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'auto',
          }}
        >
          ✕
        </button>
      </div>

      {/* Hint do eyedropper + painel de resultados */}
      {eyedropper && !matchOpen ? (
        <div
          style={{
            position: 'absolute', top: 104, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,.78)', color: '#fff',
            padding: '8px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 3,
          }}
        >
          💧 Toque na parede pra identificar a cor
        </div>
      ) : null}

      {matchOpen && pickedColor ? (
        <ColorMatchPanel
          pickedColor={pickedColor}
          matches={matches}
          loading={catalogLoading || !catalogReady}
          onClose={() => setMatchOpen(false)}
          onCloseAr={onClose}
        />
      ) : null}

      {/* Mode toggle (logo abaixo do header) */}
      <div
        style={{
          position: 'absolute', top: 58, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', padding: '0 16px',
          pointerEvents: 'none',
        }}
      >
        <div
          role="tablist"
          aria-label="Modo de visualização"
          style={{
            display: 'inline-flex',
            background: 'rgba(0,0,0,.6)',
            border: '1px solid rgba(255,255,255,.2)',
            borderRadius: 24, padding: 4, gap: 2,
            pointerEvents: 'auto',
          }}
        >
          <ModeChip
            active={mode === 'ai'}
            onClick={() => handleModeChange('ai')}
            label="🤖 IA"
          />
          <ModeChip
            active={mode === 'brush'}
            onClick={() => handleModeChange('brush')}
            label="🎨 Pincel"
          />
        </div>
      </div>

      {/* Loading model overlay (não-bloqueante — câmera já tá visível) */}
      {aiModeNotReady && status === 'loading-model' && phase === 'live' && (
        <div
          style={{
            position: 'absolute', top: 110, left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,.75)', color: '#fff',
            padding: '8px 14px', borderRadius: 20,
            fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <Spinner small /> Carregando IA…
        </div>
      )}

      {/* Status bloqueante (init camera / denied / error) */}
      {showLoadingOverlay && (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,.85)', color: '#fff',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: 24, textAlign: 'center', gap: 14,
          }}
        >
          {status === 'loading-camera' ? (
            <>
              <Spinner />
              <div style={{ fontSize: 15, fontWeight: 700 }}>Abrindo câmera…</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 40 }} aria-hidden="true">
                {status === 'denied' ? '🔒' : '⚠️'}
              </div>
              <div style={{ fontSize: 14, maxWidth: 320, lineHeight: 1.5 }}>{errorMsg}</div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  marginTop: 8, padding: '10px 20px', borderRadius: 12,
                  background: 'var(--color-p1, #ff6b35)', color: '#fff',
                  border: 'none', fontWeight: 700, cursor: 'pointer',
                }}
              >
                Fechar
              </button>
            </>
          )}
        </div>
      )}

      {/* Bottom controls */}
      {status === 'ready' && (
        <div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            padding: '14px 16px 22px',
            background: 'linear-gradient(to top, rgba(0,0,0,.7), transparent)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 12,
          }}
        >
          {phase === 'live' ? (
            <LiveControls
              mode={mode}
              onCapture={handleCapture}
            />
          ) : (
            <CapturedControls
              mode={mode}
              tool={tool}
              setTool={setTool}
              brushSize={brushSize}
              setBrushSize={setBrushSize}
              onReset={handleReset}
              onSave={handleSave}
              color={color}
            />
          )}
        </div>
      )}
    </div>
  );

  return createPortal(content, document.body);
}

// ── subcomponentes ──────────────────────────────────────────────────────

// Painel de resultados do eyedropper: cor identificada + tintas da loja
// mais próximas (ΔE). Sheet absoluto no rodapé, acima dos controles.
function ColorMatchPanel({
  pickedColor,
  matches,
  loading,
  onClose,
  onCloseAr,
}: {
  pickedColor: string;
  matches: ColorMatch[];
  loading: boolean;
  onClose: () => void;
  onCloseAr: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Tintas parecidas na loja"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        maxHeight: '64%', background: '#fff',
        borderRadius: '18px 18px 0 0',
        boxShadow: '0 -8px 30px rgba(0,0,0,.4)',
        display: 'flex', flexDirection: 'column',
        zIndex: 5, pointerEvents: 'auto',
      }}
    >
      {/* Header: swatch da cor identificada + título + fechar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
        <span
          aria-hidden="true"
          style={{
            width: 34, height: 34, borderRadius: 8, flexShrink: 0,
            background: pickedColor, border: '1.5px solid rgba(0,0,0,.15)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-ink, #1a1a2e)' }}>
            Tintas parecidas na loja
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-muted, #666)' }}>
            Cor identificada: {pickedColor.toUpperCase()}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar resultados"
          style={{
            width: 30, height: 30, borderRadius: 15, border: 'none',
            background: 'rgba(0,0,0,.07)', color: 'var(--color-ink, #1a1a2e)',
            fontSize: 15, cursor: 'pointer', flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Lista */}
      <div style={{ overflowY: 'auto', padding: '0 12px 16px' }}>
        {loading ? (
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-muted, #666)', padding: '20px 0' }}>
            Carregando catálogo de cores…
          </p>
        ) : matches.length === 0 ? (
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-muted, #666)', padding: '20px 0' }}>
            Nenhuma tinta com cor cadastrada bateu. Tente tocar em outra área.
          </p>
        ) : (
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {matches.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/loja/${m.id}`}
                  onClick={onCloseAr}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 8px', borderRadius: 12, textDecoration: 'none',
                    background: 'var(--color-cream, #fffaf0)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                      background: m.hex, border: '1.5px solid rgba(0,0,0,.12)',
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block', fontSize: 13, fontWeight: 700,
                        color: 'var(--color-ink, #1a1a2e)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {m.name}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-muted, #666)' }}>
                      {m.code ? `Cód. ${m.code} · ` : ''}{deltaELabel(m.deltaE)}
                      {m.price != null ? ` · ${BRL_FMT.format(Number(m.price))}` : ''}
                    </span>
                  </span>
                  <span aria-hidden="true" style={{ color: 'var(--color-p1, #ff6b35)', fontSize: 18, fontWeight: 700 }}>
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ModeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '7px 16px', borderRadius: 18,
        background: active ? 'var(--color-p1, #ff6b35)' : 'transparent',
        color: '#fff', fontWeight: 700, fontSize: 13,
        border: 'none', cursor: 'pointer',
        transition: 'background 150ms',
      }}
    >
      {label}
    </button>
  );
}

function LiveControls({ mode, onCapture }: { mode: Mode; onCapture: () => void }) {
  return (
    <>
      <div
        style={{
          color: '#fff', fontSize: 12, opacity: 0.9,
          textAlign: 'center', maxWidth: 320,
          textShadow: '0 1px 4px rgba(0,0,0,.6)',
        }}
      >
        {mode === 'ai'
          ? 'Aponta a câmera pra parede. A IA pinta o fundo na hora.'
          : 'Captura a foto, depois pinta as áreas com o dedo.'}
      </div>
      <button
        type="button"
        onClick={onCapture}
        aria-label="Capturar foto"
        style={{
          width: 68, height: 68, borderRadius: 34,
          background: '#fff',
          border: '4px solid rgba(255,255,255,.45)',
          cursor: 'pointer',
        }}
      />
    </>
  );
}

function CapturedControls({
  mode, tool, setTool, brushSize, setBrushSize, onReset, onSave, color,
}: {
  mode: Mode;
  tool: 'paint' | 'erase';
  setTool: (t: 'paint' | 'erase') => void;
  brushSize: number;
  setBrushSize: (n: number) => void;
  onReset: () => void;
  onSave: () => void;
  color: string;
}) {
  return (
    <>
      {/* Brush controls (só no modo pincel) */}
      {mode === 'brush' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <ToolChip
              active={tool === 'paint'}
              onClick={() => setTool('paint')}
              label={
                <>
                  🎨 Pincel{' '}
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block', width: 12, height: 12,
                      borderRadius: '50%', background: color,
                      verticalAlign: 'middle', marginLeft: 4,
                      border: '1px solid rgba(255,255,255,.5)',
                    }}
                  />
                </>
              }
            />
            <ToolChip
              active={tool === 'erase'}
              onClick={() => setTool('erase')}
              label="🧽 Borracha"
            />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {BRUSH_SIZES.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setBrushSize(s)}
                aria-label={`Tamanho ${i === 0 ? 'pequeno' : i === 1 ? 'médio' : 'grande'}`}
                aria-pressed={brushSize === s}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  background: brushSize === s ? 'var(--color-p1, #ff6b35)' : 'rgba(0,0,0,.5)',
                  border: '1.5px solid rgba(255,255,255,.3)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'block',
                    width: 8 + i * 6, height: 8 + i * 6,
                    borderRadius: '50%', background: '#fff',
                  }}
                />
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: '12px 18px', borderRadius: 12,
            background: 'rgba(0,0,0,.65)',
            border: '1.5px solid rgba(255,255,255,.3)',
            color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}
        >
          🔄 De novo
        </button>
        <button
          type="button"
          onClick={onSave}
          style={{
            padding: '12px 22px', borderRadius: 12,
            background: 'var(--color-p1, #ff6b35)',
            border: 'none', color: '#fff',
            fontWeight: 800, fontSize: 14, cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(255,107,53,.4)',
          }}
        >
          💾 Salvar / Compartilhar
        </button>
      </div>
    </>
  );
}

function ToolChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '8px 14px', borderRadius: 16,
        background: active ? 'var(--color-p1, #ff6b35)' : 'rgba(0,0,0,.55)',
        border: '1.5px solid rgba(255,255,255,.25)',
        color: '#fff', fontWeight: 700, fontSize: 13,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Spinner({ small }: { small?: boolean } = {}) {
  const size = small ? 14 : 36;
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          width: size, height: size, borderRadius: '50%',
          border: `${small ? 2 : 3}px solid rgba(255,255,255,.2)`,
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
