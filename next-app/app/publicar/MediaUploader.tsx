// MediaUploader — área de drag/drop + botão de selecionar arquivos. Aceita
// múltiplas imagens OU 1 vídeo (espelha a regra do vanilla handlePostFiles
// + as constraints do bucket `posts`).
//
// Não faz upload aqui: emite onFiles(files) — o pai (Composer) decide o que
// fazer (validar count/size, preview, etc). Pattern alinhado com como o
// signup-step3 lida com avatar (file input puro, lógica no pai).
//
// No app empacotado a galeria pode simplesmente não abrir (ver
// `lib/utils/filePickerWatch.ts`). Por isso existem DOIS caminhos aqui: o
// seletor de sempre e o botão "Tirar foto", que passa pela câmera e não
// depende do seletor. Quando o seletor falha, o app oferece os dois de
// novo no `GaleriaBloqueadaSheet` em vez de só avisar.
//
// Desde 2026-09-01 o seletor tem uma SEGUNDA forma de falhar: ele abre, e
// o Android mata o app enquanto a galeria está na frente (ver
// `lib/utils/pickerRecovery.ts`). A pessoa volta no /feed sem foto. Por
// isso o `armarSelecao` cobre os dois casos, e a legenda é gravada ANTES
// de abrir o seletor — o autosave normal é throttled em 5s e quem digita
// e toca em seguida perderia o texto junto com a foto.

'use client';

import { useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { CameraCapture } from '@/components/CameraCapture';
import { useOfereceCamera } from '@/lib/hooks/useOfereceCamera';
import { armarSelecao, consumirEscolhaPendente } from '@/lib/utils/pickerRecovery';
import { reportFailure } from '@/lib/utils/reportFailure';
import { native } from '@/lib/native';

export interface MediaUploaderProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Chamado no gesto que abre o seletor, ANTES dele abrir. O Composer usa
   *  pra gravar o rascunho na hora: se o app morrer com a galeria aberta, a
   *  legenda tem que estar no disco. */
  onAntesDeAbrir?: () => void;
  // accept default `image/*,video/*` — o composer pode restringir (ex.: só
  // image quando já tem um video selecionado).
  accept?: string;
}

export function MediaUploader({
  onFiles,
  disabled,
  onAntesDeAbrir,
  accept = 'image/*,video/*',
}: MediaUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelarAviso = useRef<(() => void) | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reiniciou, setReiniciou] = useState(false);
  const [camAberta, setCamAberta] = useState(false);

  // P7 (01/09/2026): sem isto os ouvintes de visibilidade/foco armados pelo
  // `armarSelecao` ficavam vivos após a tela sair, E a marca de recuperação
  // continuava no localStorage — na abertura seguinte, dentro de 5 min, o
  // app levava a pessoa pro /publicar dizendo "o app reiniciou" sem que
  // nada disso tivesse acontecido.
  useEffect(() => () => cancelarAviso.current?.(), []);

  // Voltamos de um app que morreu com a galeria aberta? Então a foto se
  // perdeu no caminho e ninguém contou pra pessoa. Conta aqui, com as
  // saídas — a câmera não passa pelo seletor, então não repete o problema.
  useEffect(() => {
    // Sincroniza com localStorage (sistema externo) — leitura só existe no
    // browser, no mount, não é derivável no render/SSR.
    if (!consumirEscolhaPendente('publicar')) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    setReiniciou(true);
    reportFailure('picker-restart', new Error('app reiniciou com a galeria aberta'), {
      ctx: 'publicar',
    });
  }, []);

  // Só faz sentido com câmera de verdade (celular) e quando foto é aceita:
  // no modo "só vídeo" a câmera daqui não serve.
  const podeCamera = useOfereceCamera() && accept.includes('image');

  function handleSelect() {
    if (disabled) return;
    cancelarAviso.current?.();
    // A legenda vai pro disco AGORA (o autosave normal só escreve a cada
    // 5s): daqui pra frente o processo pode morrer a qualquer momento.
    onAntesDeAbrir?.();
    cancelarAviso.current = armarSelecao({ rota: '/publicar', ctx: 'publicar' });
    inputRef.current?.click();
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    cancelarAviso.current?.();
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onFiles(files);
    // Reset value pra permitir re-selecionar o mesmo arquivo após remover.
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) onFiles(files);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={handleSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect();
          }
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        aria-disabled={disabled}
        aria-label="Selecionar foto ou vídeo"
        className={[
          'flex flex-col items-center justify-center gap-2',
          'p-8 rounded-2xl border-2 border-dashed transition-colors',
          'cursor-pointer select-none text-center',
          dragOver
            ? 'border-[color:var(--color-p1)] bg-[color:var(--color-p1)]/5'
            : 'border-[color:var(--color-border)] bg-white hover:border-[color:var(--color-p1)]',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
        data-testid="media-uploader"
      >
        <div className="text-4xl" aria-hidden="true">
          📷
        </div>
        <div className="text-sm font-semibold">
          Toque pra escolher ou arraste aqui
        </div>
        <div className="text-xs text-[color:var(--color-muted)]">
          Até 5 fotos ou 1 vídeo · máx 50 MB
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          onChange={handleChange}
          // O clique programático (inputRef.click()) SOBE até a div acima e
          // chamava handleSelect de novo — dois relógios armados, dois
          // avisos idênticos na tela. Foi o que o pintor fotografou.
          onClick={(e) => e.stopPropagation()}
          className="hidden"
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {podeCamera ? (
        <button
          type="button"
          onClick={async () => {
            if (disabled) return;
            // Câmera NATIVA primeiro (@capacitor/camera): abre a câmera do
            // sistema, pede a permissão de verdade (que aparece nos ajustes do
            // app) e corrige orientação/qualidade. 'cancelled' = a pessoa
            // desistiu no prompt nativo, não reabrimos nada. 'unavailable'/
            // erro = fora da casca ou plugin ausente → CameraCapture web.
            const r = await native.camera.takePhoto('CAMERA');
            if (r.status === 'ok') {
              onFiles([r.file]);
              return;
            }
            if (r.status === 'cancelled') return;
            setCamAberta(true);
          }}
          disabled={disabled}
          className={[
            'w-full px-4 py-3 rounded-2xl text-sm font-semibold',
            'bg-white border border-[color:var(--color-border)]',
            disabled ? 'opacity-50' : 'hover:border-[color:var(--color-p1)]',
          ].join(' ')}
          data-testid="media-uploader-camera"
        >
          📷 Tirar foto agora
        </button>
      ) : null}

      <CameraCapture
        open={camAberta}
        onClose={() => setCamAberta(false)}
        onCapture={(f) => onFiles([f])}
        title="Foto do trabalho"
        ctx="publicar"
      />

      {/* O app MORREU com a galeria aberta (o Android mata o processo que
          ficou atrás pra liberar memória). É outro caso, e continua real:
          a foto se perdeu, a legenda não. Aviso em linha, dispensável —
          não é modal, porque aqui não há nada que a pessoa PRECISE decidir,
          só escolher a foto de novo. */}
      {reiniciou && (
        <div
          className="mt-2 px-3 py-2 rounded-xl bg-[color:var(--color-p2-soft,#fff4e5)] text-xs text-[color:var(--color-ink)] flex items-start gap-2"
          role="status"
        >
          <span aria-hidden="true">↻</span>
          <span className="flex-1">
            O app fechou enquanto a galeria estava aberta e a foto se perdeu.
            Sua legenda foi salva — é só escolher a foto de novo.
          </span>
          <button
            type="button"
            onClick={() => setReiniciou(false)}
            className="font-semibold text-[color:var(--color-muted)]"
            aria-label="Dispensar aviso"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
