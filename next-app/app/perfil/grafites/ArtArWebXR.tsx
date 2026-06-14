'use client';
// ArtArWebXR — AR "world-locked" via WebXR (immersive-ar) + Three.js.
//
// Diferente do ArtAROverlay (overlay 2D preso à tela), aqui a arte é um plano
// texturizado ANCORADO num ponto da parede via hit-test: ao mover o celular
// ela continua fixa no mundo e escala natural (chega perto = maior). Só roda
// onde o browser suporta immersive-ar (Android Chrome/ARCore). iOS Safari e
// desktop não suportam — por isso o caller só mostra o botão quando
// useWebXrSupport === 'supported' (senão, cai no overlay 2D).
//
// three é importado dinamicamente pra não pesar o bundle inicial — só baixa
// quando o user abre o AR.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  imageUrl: string;
  title?: string | null;
  onClose: () => void;
}

type Phase = 'idle' | 'starting' | 'placing' | 'placed' | 'error';

// Tipos mínimos das APIs WebXR (lib.dom não inclui XRSystem por padrão).
interface XrSessionLike {
  end: () => Promise<void>;
  addEventListener: (t: string, cb: () => void) => void;
  requestReferenceSpace: (t: string) => Promise<unknown>;
  requestHitTestSource?: (opt: { space: unknown }) => Promise<unknown>;
}
interface XrSystemLike {
  isSessionSupported?: (m: string) => Promise<boolean>;
  requestSession: (m: string, opts: unknown) => Promise<XrSessionLike>;
}

export function ArtArWebXR({ open, imageUrl, title, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [opacity, setOpacity] = useState(0.85);
  const [scale, setScale] = useState(1); // largura em metros

  // Refs vivos pro render loop / callbacks sem recriar a sessão.
  const opacityRef = useRef(opacity);
  const scaleRef = useRef(scale);
  opacityRef.current = opacity;
  scaleRef.current = scale;

  // Handles do three/sessão pra cleanup. `any` aqui é deliberado — o objeto
  // carrega refs de three (importado dinâmico) + WebXR (sem types em lib.dom).
  const ctxRef = useRef<{
    cleanup: () => void;
    placedRef: { current: boolean };
    artRef: { current: { material: { opacity: number }; scale: { setScalar: (n: number) => void }; visible: boolean } | null };
    replace: () => void;
  } | null>(null);

  const stop = useCallback(() => {
    try {
      ctxRef.current?.cleanup();
    } catch {
      /* ignore */
    }
    ctxRef.current = null;
  }, []);

  // Aplica opacity/scale ao vivo na arte já colocada.
  useEffect(() => {
    const art = ctxRef.current?.artRef.current;
    if (art) {
      art.material.opacity = opacity;
      art.scale.setScalar(scale);
    }
  }, [opacity, scale]);

  const start = useCallback(async () => {
    setErrorMsg('');
    setPhase('starting');
    try {
      const THREE = await import('three');
      const xr = (navigator as unknown as { xr?: XrSystemLike }).xr;
      if (!xr) throw new Error('WebXR indisponível neste navegador.');

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;
      containerRef.current?.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbbb, 1));

      // Reticle (anel) que segue o hit-test até o user tocar pra fixar.
      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff6b35 }),
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);

      // Plano da arte (criado escondido; aparece ao fixar).
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      let tex: import('three').Texture;
      try {
        tex = await loader.loadAsync(imageUrl);
      } catch {
        throw new Error('Não consegui carregar a imagem (CORS do bucket?).');
      }
      const imgW = tex.image?.width || 1;
      const imgH = tex.image?.height || 1;
      const aspect = imgW / imgH || 1;
      const baseW = 1; // 1 metro de largura base; scale ajusta
      const geo = new THREE.PlaneGeometry(baseW, baseW / aspect).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: opacityRef.current,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const art = new THREE.Mesh(geo, mat);
      art.visible = false;
      art.renderOrder = 999;
      scene.add(art);

      const placedRef = { current: false };
      const artRef = { current: art as unknown as { material: { opacity: number }; scale: { setScalar: (n: number) => void }; visible: boolean } };

      // Inicia a sessão immersive-ar com hit-test + dom-overlay pros controles.
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: overlayRef.current ? { root: overlayRef.current } : undefined,
      });

      renderer.xr.setReferenceSpaceType('local');
      // setSession aceita XRSession; cast por causa da falta de types.
      await (renderer.xr as unknown as { setSession: (s: unknown) => Promise<void> }).setSession(session);

      const viewerSpace = await session.requestReferenceSpace('viewer');
      const localSpace = await session.requestReferenceSpace('local');
      const hitSource = session.requestHitTestSource
        ? await session.requestHitTestSource({ space: viewerSpace })
        : null;

      setPhase('placing');

      const place = () => {
        if (placedRef.current || !reticle.visible) return;
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        reticle.matrix.decompose(pos, quat, scl);
        art.position.copy(pos);
        art.quaternion.copy(quat);
        art.scale.setScalar(scaleRef.current);
        art.material.opacity = opacityRef.current;
        art.visible = true;
        placedRef.current = true;
        reticle.visible = false;
        setPhase('placed');
      };
      // Tap em qualquer lugar (controller "select") fixa a arte.
      session.addEventListener('select', place);

      renderer.setAnimationLoop((_t: number, frame?: unknown) => {
        if (frame && hitSource && !placedRef.current) {
          const f = frame as { getHitTestResults: (s: unknown) => Array<{ getPose: (sp: unknown) => { transform: { matrix: number[] } } | null }> };
          const results = f.getHitTestResults(hitSource);
          if (results.length > 0) {
            const pose = results[0]!.getPose(localSpace);
            if (pose) {
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);
            }
          } else {
            reticle.visible = false;
          }
        }
        renderer.render(scene, camera);
      });

      const onSessionEnd = () => {
        renderer.setAnimationLoop(null);
        onClose();
      };
      session.addEventListener('end', onSessionEnd);

      const replace = () => {
        placedRef.current = false;
        art.visible = false;
        setPhase('placing');
      };

      ctxRef.current = {
        placedRef,
        artRef,
        replace,
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

  // Cleanup ao fechar/desmontar.
  useEffect(() => {
    if (!open) stop();
    return () => stop();
  }, [open, stop]);

  if (!open) return null;

  const content = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1200, background: '#000' }}
      aria-label={`AR — ${title || 'arte'}`}
    >
      {/* Mount do canvas WebGL */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* dom-overlay (HTML por cima do AR durante a sessão) + telas idle/error */}
      <div ref={overlayRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* Topo: fechar */}
        <div style={{ position: 'absolute', top: 14, right: 14, pointerEvents: 'auto' }}>
          <button
            type="button"
            onClick={() => { stop(); onClose(); }}
            aria-label="Sair do AR"
            style={{
              width: 40, height: 40, borderRadius: 20, border: '1px solid rgba(255,255,255,.25)',
              background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 18, cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {phase === 'idle' ? (
          <div style={overlayCenter}>
            <div style={{ fontSize: 44 }} aria-hidden="true">📌</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>Fixar na parede (AR)</div>
            <p style={{ fontSize: 13, opacity: 0.85, maxWidth: 300, marginTop: 6, lineHeight: 1.5 }}>
              A arte fica ancorada no ponto que você tocar — ande em volta e ela
              continua fixa, escala natural ao chegar perto/longe.
            </p>
            <button type="button" onClick={start} style={primaryBtn}>Iniciar AR</button>
          </div>
        ) : null}

        {phase === 'starting' ? (
          <div style={overlayCenter}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Iniciando AR…</div>
          </div>
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
            <div style={hintChip}>Aponte pra parede e toque pra fixar</div>
          </div>
        ) : null}

        {/* Controles quando colocada: opacidade + tamanho + refazer */}
        {phase === 'placed' ? (
          <div style={bottomBar}>
            <SliderRow label="Opacidade" value={opacity} min={0.1} max={1} step={0.05}
              onChange={setOpacity} display={`${Math.round(opacity * 100)}%`} />
            <SliderRow label="Tamanho" value={scale} min={0.3} max={3} step={0.05}
              onChange={setScale} display={`${scale.toFixed(1)} m`} />
            <button
              type="button"
              onClick={() => ctxRef.current?.replace()}
              style={{ ...primaryBtn, marginTop: 6, background: 'rgba(255,255,255,.16)' }}
            >
              🔄 Reposicionar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function SliderRow({
  label, value, min, max, step, onChange, display,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void; display: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
      <span style={{ fontSize: 11, fontWeight: 700, minWidth: 64, color: '#fff' }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        style={{ flex: 1, accentColor: '#ff6b35' }}
      />
      <span style={{ fontSize: 11, fontWeight: 700, minWidth: 44, textAlign: 'right', color: '#fff' }}>{display}</span>
    </div>
  );
}

const overlayCenter: React.CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'auto',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  textAlign: 'center', padding: 24, color: '#fff',
  background: 'rgba(0,0,0,.6)',
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
