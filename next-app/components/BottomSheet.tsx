// BottomSheet — modal "janela que sobe" estilo vanilla (`.overlay` +
// `.sheet`). Fecha por: X, clique no fundo, tecla Esc e arrastar pra baixo.
//
// Três detalhes que só aparecem no celular e que este componente resolve:
//
//  1. ROLAGEM VAZANDO PRO FUNDO. `document.body.style.overflow = 'hidden'`
//     não segura nada aqui: quem rola no app não é o body, é o `<main>` do
//     AppShell. Então arrastar o dedo dentro do sheet rolava a tela de trás.
//     A trava agora é por evento: `touchmove` fora do corpo rolável é
//     cancelado, e o corpo ganha `overscroll-behavior: contain` pra não
//     encadear a rolagem no `<main>` quando chega no fim.
//
//  2. A BARRINHA NÃO ARRASTAVA. Ela é o convite universal de "puxa pra
//     baixo pra fechar", mas era só enfeite. Agora o cabeçalho responde ao
//     toque: o sheet acompanha o dedo e fecha se passar do meio do caminho
//     (ou num movimento rápido); senão volta pro lugar.
//
//  3. O X ERA PEQUENO DEMAIS. 28px fica abaixo do mínimo de toque
//     confortável (~44px). Virou 40px com área de toque de 44.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /**
   * Largura máxima no desktop (px). Default 430 — o sheet é uma tela de
   * celular. Telas que precisam de área (o Kanban de orçamentos, com 6
   * colunas) pedem mais; no celular não muda nada, é `w-full` de todo jeito.
   */
  maxWidth?: number;
}

/** Quanto o dedo precisa descer pra fechar (px). */
const CLOSE_DISTANCE = 110;
/** Velocidade que fecha mesmo sem chegar na distância (px/ms). */
const CLOSE_VELOCITY = 0.5;

export function BottomSheet({ open, onClose, children, ariaLabel, maxWidth = 430 }: BottomSheetProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ y: number; t: number } | null>(null);

  // Deslocamento do arrasto (px). 0 = parado no lugar.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  // A animação de entrada roda UMA vez; sem isso, cada arrasto que não fecha
  // fazia o sheet subir de novo do zero ao soltar o dedo.
  const [entered, setEntered] = useState(false);

  // Mistura reset síncrono (fechou) com timer de DOM (animação de entrada) —
  // não dá pra separar sem um efeito extra que reintroduziria a mesma
  // corrida que isto evita (sheet "subindo de novo" a cada re-render).
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
      setEntered(false);
      return;
    }
    const t = setTimeout(() => setEntered(true), 260);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Trava de rolagem do fundo — ver comentário (1) no topo do arquivo.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const onTouchMove = (e: TouchEvent) => {
      const body = bodyRef.current;
      const inBody = !!body && !!e.target && body.contains(e.target as Node);
      // Fora do corpo rolável (fundo, cabeçalho) nada rola.
      if (!inBody) {
        e.preventDefault();
        return;
      }
      // Dentro do corpo, mas sem conteúdo pra rolar: também segura, senão o
      // gesto atravessa pro `<main>` do app.
      if (body && body.scrollHeight <= body.clientHeight) e.preventDefault();
    };
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => root.removeEventListener('touchmove', onTouchMove);
  }, [open]);

  // Zera o arrasto sempre que fecha. Mistura reset de ref (dragStart, que
  // precisa ficar num efeito) com reset de state — não é puro reset
  // derivado isolável em render.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
      setDragY(0);
      setDragging(false);
      dragStart.current = null;
    }
  }, [open]);

  // ── arrastar pra baixo pra fechar ────────────────────────────────────────

  const onHeaderTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    dragStart.current = { y: t.clientY, t: Date.now() };
    setDragging(true);
    setDragY(0);
  }, []);

  const onHeaderTouchMove = useCallback((e: React.TouchEvent) => {
    const start = dragStart.current;
    const t = e.touches[0];
    if (!start || !t) return;
    // Só pra baixo: puxar pra cima não estica o sheet.
    setDragY(Math.max(0, t.clientY - start.y));
  }, []);

  const onHeaderTouchEnd = useCallback(() => {
    const start = dragStart.current;
    const distance = dragY;
    dragStart.current = null;
    setDragging(false);
    if (start) {
      const elapsed = Math.max(1, Date.now() - start.t);
      const velocity = distance / elapsed;
      if (distance > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) {
        setDragY(0);
        onClose();
        return;
      }
    }
    setDragY(0); // não passou do ponto: volta pro lugar, animado
  }, [dragY, onClose]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-end justify-center"
      style={{
        background: 'rgba(0,0,0,.55)',
        animation: 'bsFade 160ms ease-out',
        touchAction: 'none',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full mx-auto bg-white flex flex-col"
        style={{
          maxWidth,
          // `dvh` e não `vh`: no Safari do iPhone o `vh` inclui a área atrás
          // das barras do navegador, então o rodapé do sheet (o botão de
          // ação) nascia fora da vista.
          maxHeight: '92dvh',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 30px rgba(0,0,0,.3)',
          // Enquanto o dedo está na tela o sheet acompanha sem transição
          // (senão fica borrachudo); ao soltar, volta animado.
          transform: `translateY(${dragY}px)`,
          transition: dragging ? 'none' : 'transform 220ms cubic-bezier(.32,.72,0,1)',
          animation: entered ? undefined : 'bsSlideUp 220ms cubic-bezier(.32,.72,0,1)',
        }}
      >
        {/* Cabeçalho FIXO (handle + X). Antes o X era `absolute` dentro do
            container que rolava: em sheet com conteúdo longo (Publicar,
            Orçamento) ele subia junto com o conteúdo e sumia da tela — não
            dava pra fechar sem Esc/backdrop. Agora o cabeçalho é um irmão
            do corpo rolável, então o X fica sempre visível.

            É também a área de arrasto: `touch-action: none` porque o gesto
            vertical aqui é nosso, não do scroller. */}
        <div
          className="relative flex-shrink-0 flex items-center justify-center"
          style={{
            background: 'var(--color-white)',
            padding: '12px 14px 8px',
            borderRadius: '20px 20px 0 0',
            touchAction: 'none',
            cursor: 'grab',
          }}
          onTouchStart={onHeaderTouchStart}
          onTouchMove={onHeaderTouchMove}
          onTouchEnd={onHeaderTouchEnd}
          onTouchCancel={onHeaderTouchEnd}
        >
          {/* Área de toque generosa em volta da barrinha — o alvo de arrasto
              é a faixa inteira do cabeçalho, não os 4px do risquinho. */}
          <span
            aria-hidden="true"
            className="rounded-full"
            style={{
              width: 44,
              height: 5,
              background: 'rgba(0,0,0,.22)',
            }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="absolute flex items-center justify-center"
            style={{
              top: 4,
              right: 6,
              // 44x44 de alvo com um círculo de 40 desenhado dentro — abaixo
              // disso o dedo erra (mínimo recomendado pela Apple é 44).
              width: 44,
              height: 44,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <span
              aria-hidden="true"
              className="flex items-center justify-center rounded-full"
              style={{
                width: 40,
                height: 40,
                background: 'rgba(0,0,0,.08)',
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--color-ink)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </span>
          </button>
        </div>

        {/* Corpo rolável. `flex: 1` garante que o body cresce pra preencher
            o espaço disponível entre o cabeçalho fixo e o limite de altura
            do sheet. `overscroll-behavior: contain` impede que, ao chegar no
            fim, a rolagem continue no `<main>` atrás.

            O padding de baixo garante que o último botão de ação não fica
            atrás do BottomNav (que tem ~60px + safe area). Fórmula:
            - 16px espaço mínimo de conforto
            - 60px altura do BottomNav
            - env(safe-area-inset-bottom) notch/home bar do iPhone
            = 76px + safe-area. Aumentado pra 100px pra margem extra. */}
        <div
          ref={bodyRef}
          className="hide-scrollbar"
          style={{
            flex: 1,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            padding: '4px 18px 24px',
            paddingBottom: 'calc(100px + env(safe-area-inset-bottom))',
          }}
        >
          {children}
        </div>
      </div>
      <style>{`
        @keyframes bsFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bsSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
