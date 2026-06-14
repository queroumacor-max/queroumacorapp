'use client';
// ArtArWebXR — AR "world-locked" via WebXR (immersive-ar) + Three.js.
//
// Diferente do ArtAROverlay (overlay 2D preso à tela), aqui a arte e um plano
// texturizado ANCORADO no mundo: ao mover o celular ela continua fixa e escala
// natural. Depois de fixar, da pra MANIPULAR com gestos (estilo Scene Viewer do
// GLB): 1 dedo arrasta (frente/tras + lados, no plano horizontal), 2 dedos =
// pinca pra redimensionar. Mais opacidade + reposicionar.
//
// So roda onde o browser suporta immersive-ar (Android Chrome/ARCore). iOS
// Safari/desktop nao suportam — o caller so mostra o botao quando
// useWebXrSupport === 'supported' (senao, cai no overlay 2D).
//
// three e importado dinamicamente pra nao pesar o bundle inicial.

import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  imageUrl: string;
  title?: string | null;
  onClose: () => void;
}

type Phase = 'idle' | 'starting' | 'placing' | 'placed' | 'error';

interface XrSessionLike {
  end: () => Promise<void>;
  addEventListener: (t: string, cb: () => void) => void;
  requestReferenceSpace: (t: string) => Promise<unknown>;
  requestHitTestSource?: (opt: { space: unknown }) => Promise<unknown>;
}
interface XrSystemLike {
  requestSession: (m: string, opts: unknown) => Promise<XrSessionLike>;
}

// Handle vivo pros gestos manipularem a cena three (no closure de start()).
interface ArHandle {
  cleanup: () => void;
  replace: () => void;
  moveBy: (dxPx: number, dyPx: number) => void;
  rotateBy: (dxPx: number, dyPx: number) => void;
  setScale: (v: number) => void;
  getScale: () => number;
  setOpacity: (v: number) => void;
}

const SCALE_MIN = 0.1;
const SCALE_MAX = 5;

function touchDist(a: React.Touch, b: React.Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function ArtArWebXR({ open, imageUrl, title, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [opacity, setOpacity] = useState(0.85);
  // Modo do arraste de 1 dedo: mover no plano OU girar (yaw+pitch 360).
  const [tool, setTool] = useState<'move' | 'rotate'>('move');

  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const handleRef = useRef<ArHandle | null>(null);
  // Estado do gesto de toque (drag/pinch).
  const gesture = useRef<{ mode: 'none' | 'drag' | 'pinch'; x: number; y: number; dist: number; startScale: number }>({
    mode: 'none', x: 0, y: 0, dist: 0, startScale: 1,
  });

  const stop = useCallback(() => {
    try { handleRef.current?.cleanup(); } catch { /* ignore */ }
    handleRef.current = null;
  }, []);

  // Opacidade ao vivo.
  useEffect(() => {
    handleRef.current?.setOpacity(opacity);
  }, [opacity]);

  const start = useCallback(async () => {
    setErrorMsg('');
    setPhase('starting');
    try {
      const THREE = await import('three');
      const xr = (navigator as unknown as { xr?: XrSystemLike }).xr;
      if (!xr) throw new Error('WebXR indisponivel neste navegador.');

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;
      containerRef.current?.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 1));

      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff6b35 }),
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);

      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      let tex: import('three').Texture;
      try {
        tex = await loader.loadAsync(imageUrl);
      } catch {
        throw new Error('Nao consegui carregar a imagem (CORS do bucket?).');
      }
      const aspect = (tex.image?.width || 1) / (tex.image?.height || 1) || 1;
      const geo = new THREE.PlaneGeometry(1, 1 / aspect);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: opacityRef.current,
        side: THREE.DoubleSide, depthTest: false,
      });
      const art = new THREE.Mesh(geo, mat);
      art.visible = false;
      art.renderOrder = 999;
      // Nunca descartar por frustum culling — o movimento da camera AR faz o
      // culling falhar e a arte "some" mesmo estando na frente. So 1 objeto,
      // custo zero. (fix do "ao mover a camera ele some".)
      art.frustumCulled = false;
      scene.add(art);

      const placedRef = { current: false };

      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: overlayRef.current ? { root: overlayRef.current } : undefined,
      });
      renderer.xr.setReferenceSpaceType('local');
      await (renderer.xr as unknown as { setSession: (s: unknown) => Promise<void> }).setSession(session);

      const viewerSpace = await session.requestReferenceSpace('viewer');
      const localSpace = await session.requestReferenceSpace('local');
      const hitSource = session.requestHitTestSource
        ? await session.requestHitTestSource({ space: viewerSpace })
        : null;

      setPhase('placing');

      const xrCam = () => (renderer.xr as unknown as { getCamera: () => import('three').Object3D }).getCamera();

      const place = () => {
        if (placedRef.current) return;
        const cam = xrCam();
        const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        const target = new THREE.Vector3();
        if (reticle.visible) {
          target.setFromMatrixPosition(reticle.matrix);
        } else {
          const q = new THREE.Quaternion().setFromRotationMatrix(cam.matrixWorld);
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
          target.copy(camPos).add(fwd.multiplyScalar(1.5));
        }
        art.position.copy(target);
        art.lookAt(camPos);
        art.material.opacity = opacityRef.current;
        art.visible = true;
        placedRef.current = true;
        reticle.visible = false;
        setPhase('placed');
      };
      session.addEventListener('select', place);

      renderer.setAnimationLoop((_t: number, frame?: unknown) => {
        if (frame && hitSource && !placedRef.current) {
          const f = frame as { getHitTestResults: (s: unknown) => Array<{ getPose: (sp: unknown) => { transform: { matrix: number[] } } | null }> };
          const results = f.getHitTestResults(hitSource);
          if (results.length > 0) {
            const pose = results[0]!.getPose(localSpace);
            if (pose) { reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
          } else {
            reticle.visible = false;
          }
        }
        renderer.render(scene, camera);
      });

      session.addEventListener('end', () => { renderer.setAnimationLoop(null); onClose(); });

      handleRef.current = {
        replace: () => { placedRef.current = false; art.visible = false; setPhase('placing'); },
        moveBy: (dxPx, dyPx) => {
          const m = xrCam().matrixWorld;
          // base horizontal da camera (Y zerado) — mover no plano do chao,
          // estilo Scene Viewer: 1 dedo => frente/tras + lados.
          const right = new THREE.Vector3().setFromMatrixColumn(m, 0).setY(0);
          if (right.lengthSq() > 0) right.normalize();
          const fwd = new THREE.Vector3().setFromMatrixColumn(m, 2).multiplyScalar(-1).setY(0);
          if (fwd.lengthSq() > 0) fwd.normalize();
          const K = 0.004; // metros por pixel
          art.position.addScaledVector(right, dxPx * K);
          art.position.addScaledVector(fwd, -dyPx * K); // arrastar pra cima => afasta
        },
        rotateBy: (dxPx, dyPx) => {
          const KR = 0.008; // rad por pixel
          // horizontal (dx) gira em torno do eixo vertical do mundo (yaw 360).
          art.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dxPx * KR);
          // vertical (dy) gira em torno do eixo horizontal da camera (pitch 360).
          const right = new THREE.Vector3().setFromMatrixColumn(xrCam().matrixWorld, 0);
          if (right.lengthSq() > 0) right.normalize();
          art.rotateOnWorldAxis(right, dyPx * KR);
        },
        setScale: (v) => { art.scale.setScalar(Math.max(SCALE_MIN, Math.min(SCALE_MAX, v))); },
        getScale: () => art.scale.x,
        setOpacity: (v) => { art.material.opacity = v; },
        cleanup: () => {
          try { renderer.setAnimationLoop(null); } catch { /* */ }
          try { session.end(); } catch { /* */ }
          try { tex.dispose(); geo.dispose(); mat.dispose(); renderer.dispose(); } catch { /* */ }
          try { renderer.domElement.remove(); } catch { /* */ }
        },
      };
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Falha ao iniciar o AR.');
      setPhase('error');
      stop();
    }
  }, [imageUrl, onClose, stop]);

  useEffect(() => {
    if (!open) stop();
    return () => stop();
  }, [open, stop]);

  // ─── gestos de toque (so quando 'placed') ──────────────────────────────
  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    const t = e.touches;
    if (t.length >= 2) {
      gesture.current = { mode: 'pinch', x: 0, y: 0, dist: touchDist(t[0]!, t[1]!), startScale: handleRef.current?.getScale() ?? 1 };
    } else if (t.length === 1) {
      gesture.current = { mode: 'drag', x: t[0]!.clientX, y: t[0]!.clientY, dist: 0, startScale: 0 };
    }
  }, []);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const h = handleRef.current;
    if (!h) return;
    const t = e.touches;
    const g = gesture.current;
    if (t.length >= 2) {
      if (g.mode !== 'pinch') {
        gesture.current = { mode: 'pinch', x: 0, y: 0, dist: touchDist(t[0]!, t[1]!), startScale: h.getScale() };
        return;
      }
      const d = touchDist(t[0]!, t[1]!);
      if (g.dist > 0) h.setScale(g.startScale * (d / g.dist));
    } else if (t.length === 1 && g.mode === 'drag') {
      const dx = t[0]!.clientX - g.x;
      const dy = t[0]!.clientY - g.y;
      if (toolRef.current === 'rotate') h.rotateBy(dx, dy);
      else h.moveBy(dx, dy);
      g.x = t[0]!.clientX;
      g.y = t[0]!.clientY;
    }
  }, []);

  const onTouchEnd = useCallback((e: ReactTouchEvent) => {
    if (e.touches.length === 0) {
      gesture.current.mode = 'none';
    } else if (e.touches.length === 1) {
      gesture.current = { mode: 'drag', x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, dist: 0, startScale: 0 };
    }
  }, []);

  if (!open) return null;

  const content = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: '#000' }} aria-label={`AR — ${title || 'arte'}`}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      <div ref={overlayRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* Camada de gesto (atras dos controles) — so quando colocada */}
        {phase === 'placed' ? (
          <div
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', touchAction: 'none' }}
          />
        ) : null}

        {/* Fechar */}
        <div style={{ position: 'absolute', top: 14, right: 14, pointerEvents: 'auto' }}>
          <button
            type="button" onClick={() => { stop(); onClose(); }} aria-label="Sair do AR"
            style={{ width: 40, height: 40, borderRadius: 20, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 18, cursor: 'pointer' }}
          >✕</button>
        </div>

        {phase === 'idle' ? (
          <div style={overlayCenter}>
            <div style={{ fontSize: 44 }} aria-hidden="true">📌</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>Fixar na parede (AR)</div>
            <p style={{ fontSize: 13, opacity: 0.85, maxWidth: 300, marginTop: 6, lineHeight: 1.5 }}>
              A arte fica ancorada no mundo. Depois de fixar: arraste pra mover,
              pinca pra redimensionar.
            </p>
            <button type="button" onClick={start} style={primaryBtn}>Iniciar AR</button>
          </div>
        ) : null}

        {phase === 'starting' ? (
          <div style={overlayCenter}><div style={{ fontSize: 14, fontWeight: 700 }}>Iniciando AR…</div></div>
        ) : null}

        {phase === 'error' ? (
          <div style={overlayCenter}>
            <div style={{ fontSize: 40 }} aria-hidden="true">⚠️</div>
            <p style={{ fontSize: 13, maxWidth: 300, marginTop: 8, lineHeight: 1.5 }}>{errorMsg}</p>
            <button type="button" onClick={() => { stop(); onClose(); }} style={primaryBtn}>Fechar</button>
          </div>
        ) : null}

        {phase === 'placing' ? (
          <div style={{ position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
            <div style={hintChip}>Toque pra fixar a arte (parede lisa fixa a sua frente)</div>
          </div>
        ) : null}

        {phase === 'placed' ? (
          <div style={bottomBar}>
            {/* Toggle: arraste de 1 dedo move OU gira */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', pointerEvents: 'auto' }}>
              <ToolChip active={tool === 'move'} onClick={() => setTool('move')} label="✋ Mover" />
              <ToolChip active={tool === 'rotate'} onClick={() => setTool('rotate')} label="🔄 Girar" />
            </div>
            <div style={{ ...hintChip, alignSelf: 'center', marginBottom: 2 }}>
              {tool === 'move'
                ? '✋ Arraste pra mover · 🤏 pinca pra redimensionar'
                : '🔄 Arraste: ↔ gira horizontal · ↕ gira vertical'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
              <span style={{ fontSize: 11, fontWeight: 700, minWidth: 64, color: '#fff' }}>Opacidade</span>
              <input
                type="range" min={0.1} max={1} step={0.05} value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                aria-label="Opacidade" style={{ flex: 1, accentColor: '#ff6b35' }}
              />
              <span style={{ fontSize: 11, fontWeight: 700, minWidth: 44, textAlign: 'right', color: '#fff' }}>{Math.round(opacity * 100)}%</span>
            </div>
            <button
              type="button" onClick={() => handleRef.current?.replace()}
              style={{ ...primaryBtn, marginTop: 4, background: 'rgba(255,255,255,.16)', pointerEvents: 'auto' }}
            >🔄 Reposicionar</button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function ToolChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '8px 16px', borderRadius: 18, border: '1.5px solid rgba(255,255,255,.25)',
        background: active ? 'var(--color-p1, #ff6b35)' : 'rgba(0,0,0,.55)',
        color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

const overlayCenter: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'auto',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  textAlign: 'center', padding: 24, color: '#fff', background: 'rgba(0,0,0,.6)',
};
const primaryBtn: React.CSSProperties = {
  marginTop: 16, padding: '12px 24px', borderRadius: 14, border: 'none',
  background: 'var(--color-p1, #ff6b35)', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer',
};
const hintChip: React.CSSProperties = {
  background: 'rgba(0,0,0,.78)', color: '#fff', padding: '8px 14px', borderRadius: 20,
  fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
};
const bottomBar: React.CSSProperties = {
  position: 'absolute', bottom: 0, left: 0, right: 0,
  padding: '14px 16px calc(18px + env(safe-area-inset-bottom))',
  background: 'linear-gradient(to top, rgba(0,0,0,.8), transparent)',
  display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none',
};
