// CameraCapture — tira a foto DENTRO do app e devolve um File, sem passar
// pelo seletor de arquivos.
//
// Motivo (2026-08-30): a WebView do wrapper (WebIntoApp) não abre a
// galeria — `<input type="file">` não faz nada, sem erro (ver
// `lib/utils/filePickerWatch.ts`). Câmera é outro caminho: `getUserMedia`
// entrega o vídeo, o canvas vira JPEG e o JPEG vira File. Quem chama nem
// percebe a diferença — recebe um File igual ao da galeria.
//
// Detalhes que só aparecem no celular:
//  - `playsInline` + `muted`: sem isso o iOS abre o vídeo em tela cheia
//    nativa e o Android recusa o autoplay.
//  - TETO DE TEMPO no getUserMedia: em WebView promessa pendurada não
//    rejeita (mesma lição do `getSession`). Sem o teto, a tela ficaria em
//    "Abrindo a câmera…" pra sempre.
//  - A foto sai no máximo com 1600px no lado maior: foto crua de celular
//    passa dos 5MB do avatar.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { erroDeCamera, nomeDaFoto, tamanhoDeSaida, temCamera } from '@/lib/utils/camera';
import { reportFailure } from '@/lib/utils/reportFailure';

export interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  /** 'user' = frontal (foto de perfil), 'environment' = traseira (trabalho). */
  facing?: 'user' | 'environment';
  title?: string;
  /** Vai pro /admin/errors junto com a falha, pra saber QUAL tela era. */
  ctx?: string;
  userId?: string | null;
}

/** Teto pro getUserMedia — em WebView ele pode nunca resolver. */
const ABERTURA_TIMEOUT_MS = 12000;

export function CameraCapture({
  open,
  onClose,
  onCapture,
  facing = 'environment',
  title = 'Tirar foto',
  ctx,
  userId,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [lado, setLado] = useState<'user' | 'environment'>(facing);
  const [status, setStatus] = useState<'abrindo' | 'pronta' | 'falhou'>('abrindo');
  const [erro, setErro] = useState('');
  const [tirando, setTirando] = useState(false);

  // Ajuste DURANTE o render (idiom oficial) — puramente derivado de
  // `open`/`facing`, sem trabalho assíncrono/DOM.
  const [aberturaVista, setAberturaVista] = useState({ open, facing });
  if (open !== aberturaVista.open || facing !== aberturaVista.facing) {
    setAberturaVista({ open, facing });
    if (open) setLado(facing);
  }

  // ─── liga a câmera ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    let local: MediaStream | null = null;

    (async () => {
      setStatus('abrindo');
      setErro('');
      if (!temCamera()) {
        setStatus('falhou');
        setErro('Este app não conseguiu abrir a câmera.');
        return;
      }
      try {
        const pedido = navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: lado }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        });
        // Se o teto vencer a corrida, o stream ainda pode chegar DEPOIS —
        // este `then` fica de plantão pra desligar, senão a luzinha da
        // câmera continua acesa com a tela já fechada.
        let desistiu = false;
        pedido
          .then((s) => {
            if (desistiu || cancelado) s.getTracks().forEach((t) => t.stop());
          })
          .catch(() => {});
        let timer: ReturnType<typeof setTimeout> | undefined;
        const teto = new Promise<never>((_, rej) => {
          timer = setTimeout(() => {
            desistiu = true;
            rej(Object.assign(new Error('getUserMedia nao respondeu'), { name: 'TimeoutError' }));
          }, ABERTURA_TIMEOUT_MS);
        });
        let stream: MediaStream;
        try {
          stream = await Promise.race([pedido, teto]);
        } finally {
          clearTimeout(timer);
        }
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        local = stream;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus('pronta');
      } catch (e) {
        if (cancelado) return;
        const { msg } = erroDeCamera(e);
        setStatus('falhou');
        setErro(msg);
        // Sem isto, "a câmera também não abre" continua sendo relato.
        reportFailure('camera-fail', e, { userId, ctx });
      }
    })();

    return () => {
      cancelado = true;
      if (local) local.getTracks().forEach((t) => t.stop());
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [open, lado, ctx, userId]);

  // Esc fecha.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const tirar = useCallback(async () => {
    const video = videoRef.current;
    if (!video || status !== 'pronta' || tirando) return;
    setTirando(true);
    try {
      const { w, h } = tamanhoDeSaida(video.videoWidth, video.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) throw new Error('canvas indisponível');
      ctx2d.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), 'image/jpeg', 0.9),
      );
      if (!blob) throw new Error('não consegui gerar a imagem');
      onCapture(new File([blob], nomeDaFoto(), { type: 'image/jpeg' }));
      onClose();
    } catch (e) {
      setErro((e as Error).message || 'Não consegui tirar a foto.');
      reportFailure('camera-fail', e, { userId, ctx });
    } finally {
      setTirando(false);
    }
  }, [status, tirando, onCapture, onClose, ctx, userId]);

  if (!open) return null;

  const botaoRedondo: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 999,
    background: 'rgba(0,0,0,.55)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,.35)',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="camera-capture"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* cabeçalho */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 12,
          gap: 8,
          color: '#fff',
        }}
      >
        <button type="button" onClick={onClose} aria-label="Fechar câmera" style={botaoRedondo}>
          ✕
        </button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <button
          type="button"
          onClick={() => setLado((l) => (l === 'user' ? 'environment' : 'user'))}
          aria-label="Virar câmera"
          style={botaoRedondo}
        >
          🔄
        </button>
      </div>

      {/* visor */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
            transform: lado === 'user' ? 'scaleX(-1)' : undefined,
          }}
        />
        {status !== 'pronta' ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 24,
              textAlign: 'center',
              color: '#fff',
            }}
          >
            {status === 'abrindo' ? (
              <div style={{ fontSize: 14 }}>Abrindo a câmera…</div>
            ) : (
              <>
                <div style={{ fontSize: 34 }} aria-hidden="true">
                  📷
                </div>
                <div role="alert" style={{ fontSize: 14, lineHeight: 1.45, maxWidth: 320 }}>
                  {erro}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    marginTop: 8,
                    padding: '10px 18px',
                    borderRadius: 999,
                    background: '#fff',
                    color: '#111',
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  Voltar
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* disparo */}
      <div style={{ padding: 20, display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={tirar}
          disabled={status !== 'pronta' || tirando}
          aria-label="Tirar foto"
          style={{
            width: 74,
            height: 74,
            borderRadius: 999,
            background: '#fff',
            border: '5px solid rgba(255,255,255,.45)',
            opacity: status === 'pronta' && !tirando ? 1 : 0.4,
          }}
        />
      </div>
    </div>
  );
}
