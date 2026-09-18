// Enquadramento — escolher a proporção do post e o que fica dentro dela.
//
// Motivo (2026-09-07): um pintor publicou um quadro em pé (80×120) e a
// obra apareceu cortada em cima e embaixo, sem ter como escolher. Aqui a
// pessoa vê o QUADRO do jeito que vai sair, arrasta a foto pra decidir o
// que entra (modo "preencher") ou manda a foto inteira com fundo (modo
// "ajustar"). "Original" é o padrão e não mexe em nada — quem não liga
// pra isso publica como sempre publicou.
//
// A prévia e o recorte real usam a MESMA conta (`lib/enquadramento`), por
// isso o que aparece aqui é o que sobe.

'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DESLOCAMENTO_CENTRO,
  PROPORCOES,
  arrastar,
  estiloPreview,
  ratioDe,
  type Deslocamento,
  type Enquadramento as EnquadramentoState,
  type ModoEnquadramento,
  type ProporcaoKey,
} from '@/lib/enquadramento';
import { readImageDimensions } from '@/lib/services/posts';

export interface EnquadramentoProps {
  files: File[];
  value: EnquadramentoState;
  onChange: (next: EnquadramentoState) => void;
  disabled?: boolean;
}

type Dims = { width: number; height: number };

export function Enquadramento({ files, value, onChange, disabled }: EnquadramentoProps) {
  const [atual, setAtual] = useState(0);
  // Dimensões por arquivo (identidade do File como chave — o composer
  // trata a lista como imutável, então a referência é estável).
  const [dims, setDims] = useState<Map<File, Dims>>(() => new Map());
  const quadroRef = useRef<HTMLDivElement | null>(null);
  // Estado (não ref) de propósito: o cursor 'grab'/'grabbing' na linha do
  // JSX abaixo depende disso pra re-renderizar — ref não dispara render.
  // Só muda 2x por gesto de arrasto (down/up), nunca a cada pointermove
  // (que só LÊ o snapshot tirado no down), então o custo é desprezível.
  const [arrasto, setArrasto] = useState<{ x: number; y: number; desloc: Deslocamento } | null>(
    null
  );

  const idx = Math.min(atual, Math.max(0, files.length - 1));
  const file = files[idx];
  const proporcao = ratioDe(value.proporcao);

  // Ajusta `atual` (clamp) DURANTE o render quando `files` encolhe e ele
  // fica fora do intervalo — idiom oficial do React em vez de useEffect com
  // setState síncrono (https://react.dev/learn/you-might-not-need-an-effect
  // #adjusting-some-state-when-a-prop-changes). `idx` já reflete o valor
  // clampado em TODO render (é reusado pra tudo abaixo); isto só existe pra
  // `atual` não ficar preso num índice inválido se `files` encolher de
  // novo depois.
  const [filesLenVisto, setFilesLenVisto] = useState(files.length);
  if (files.length !== filesLenVisto) {
    setFilesLenVisto(files.length);
    if (atual !== idx) setAtual(idx);
  }

  // URL de prévia da foto selecionada.
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => {
    return () => {
      if (url) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      }
    };
  }, [url]);

  useEffect(() => {
    if (!file || dims.has(file)) return;
    let vivo = true;
    readImageDimensions(file).then((d) => {
      if (!vivo || !d) return;
      setDims((prev) => {
        const next = new Map(prev);
        next.set(file, d);
        return next;
      });
    });
    return () => {
      vivo = false;
    };
  }, [file, dims]);

  if (files.length === 0 || !file) return null;

  const d = dims.get(file) ?? null;
  const desloc = value.deslocamentos[idx] ?? DESLOCAMENTO_CENTRO;
  const estilo =
    d && proporcao != null ? estiloPreview(d.width, d.height, proporcao, desloc, value.modo) : null;

  function setProporcao(p: ProporcaoKey) {
    onChange({ ...value, proporcao: p });
  }
  function setModo(m: ModoEnquadramento) {
    onChange({ ...value, modo: m });
  }
  function setDesloc(i: number, nd: Deslocamento) {
    const lista = files.map((_, k) => value.deslocamentos[k] ?? DESLOCAMENTO_CENTRO);
    lista[i] = nd;
    onChange({ ...value, deslocamentos: lista });
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !estilo?.arrastavel) return;
    setArrasto({ x: e.clientX, y: e.clientY, desloc });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const a = arrasto;
    const quadro = quadroRef.current;
    if (!a || !quadro || !estilo || !d || proporcao == null) return;
    e.preventDefault();
    const qw = quadro.clientWidth;
    const qh = quadro.clientHeight;
    // Quanto a foto passa do quadro em cada eixo, em px.
    const sobraX = (parseFloat(estilo.width) / 100) * qw - qw;
    const sobraY = (parseFloat(estilo.height) / 100) * qh - qh;
    const novo = arrastar(
      a.desloc,
      { x: e.clientX - a.x, y: e.clientY - a.y },
      { x: sobraX, y: sobraY },
    );
    setDesloc(idx, novo);
  }
  function onPointerUp() {
    setArrasto(null);
  }

  const semRecorte = proporcao == null;

  return (
    <section
      className="rounded-2xl border border-[color:var(--color-border)] bg-white p-4 flex flex-col gap-3"
      aria-label="Enquadramento da foto"
      data-testid="enquadramento"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Enquadramento</span>
        <span className="text-xs text-[color:var(--color-muted)]">
          {semRecorte ? 'A foto sobe como está' : value.modo === 'preencher' ? 'Arraste pra escolher o que aparece' : 'Foto inteira, sem cortar'}
        </span>
      </div>

      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Proporção">
        {PROPORCOES.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={value.proporcao === p.key}
            onClick={() => setProporcao(p.key)}
            disabled={disabled}
            className={
              'px-3 py-1.5 rounded-xl text-xs font-semibold border ' +
              (value.proporcao === p.key
                ? 'bg-[color:var(--color-ink)] text-white border-[color:var(--color-ink)]'
                : 'bg-white border-[color:var(--color-border)]')
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {!semRecorte ? (
        <div className="flex gap-2" role="radiogroup" aria-label="Modo">
          <button
            type="button"
            role="radio"
            aria-checked={value.modo === 'preencher'}
            onClick={() => setModo('preencher')}
            disabled={disabled}
            className={
              'flex-1 px-3 py-1.5 rounded-xl text-xs font-semibold border ' +
              (value.modo === 'preencher'
                ? 'bg-[color:var(--color-p1)] text-white border-[color:var(--color-p1)]'
                : 'bg-white border-[color:var(--color-border)]')
            }
          >
            Preencher (corta a sobra)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={value.modo === 'ajustar'}
            onClick={() => setModo('ajustar')}
            disabled={disabled}
            className={
              'flex-1 px-3 py-1.5 rounded-xl text-xs font-semibold border ' +
              (value.modo === 'ajustar'
                ? 'bg-[color:var(--color-p1)] text-white border-[color:var(--color-p1)]'
                : 'bg-white border-[color:var(--color-border)]')
            }
          >
            Ajustar (sem cortar)
          </button>
        </div>
      ) : null}

      {/* O quadro: tem a proporção escolhida (ou a da foto, em "original") e
          esconde o que passa da borda — exatamente o que o feed vai mostrar. */}
      <div
        ref={quadroRef}
        data-testid="enquadramento-quadro"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative w-full overflow-hidden rounded-xl bg-[color:var(--color-border)] select-none"
        style={{
          aspectRatio: semRecorte
            ? d
              ? `${d.width} / ${d.height}`
              : '1 / 1'
            : String(proporcao),
          maxHeight: 420,
          margin: '0 auto',
          touchAction: estilo?.arrastavel ? 'none' : 'auto',
          cursor: estilo?.arrastavel ? (arrasto ? 'grabbing' : 'grab') : 'default',
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Foto ${idx + 1} no enquadramento`}
            draggable={false}
            className="absolute block max-w-none pointer-events-none"
            style={
              estilo
                ? { width: estilo.width, height: estilo.height, left: estilo.left, top: estilo.top }
                : { width: '100%', height: '100%', left: 0, top: 0, objectFit: 'contain' }
            }
          />
        ) : null}
      </div>

      {files.length > 1 ? (
        <div className="flex gap-2 flex-wrap" aria-label="Escolher a foto pra enquadrar">
          {files.map((f, i) => (
            <button
              key={`${f.name}-${f.size}-${i}`}
              type="button"
              onClick={() => setAtual(i)}
              disabled={disabled}
              aria-pressed={i === idx}
              className={
                'px-3 py-1 rounded-full text-xs font-semibold border ' +
                (i === idx
                  ? 'bg-[color:var(--color-ink)] text-white border-[color:var(--color-ink)]'
                  : 'bg-white border-[color:var(--color-border)]')
              }
            >
              Foto {i + 1}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
