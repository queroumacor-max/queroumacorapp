// ClickRuaView — banca da revista Click Rua dentro do app: um card por
// edição, e a edição pronta abre num leitor de tela cheia que vira a página
// como revista de papel.
//
// Três decisões que valem registro:
//
//  1. O LEITOR FICA ACIMA DO BOTTOM-SHEET (z-[1100]). Ele é aberto de DENTRO
//     do sheet, e o sheet é z-[1000] — com o z-[400] do StoryViewer o leitor
//     abria atrás dele: no desktop dava pra ver o leitor no fundo, no celular
//     o sheet cobria a tela inteira e parecia que nada acontecia.
//
//  2. A VIRADA É UMA FOLHA GIRANDO NA LOMBADA, não scroll horizontal. A folha
//     acompanha o dedo (0° a -180° em torno da borda esquerda) e, ao soltar,
//     completa ou desiste conforme passou da metade. A conta vive em
//     `lib/clickRua.ts` e é testada — gesto é o tipo de código que quebra
//     calado.
//
//  3. TEM ZOOM PORQUE A REVISTA TEM LETRA MIÚDA. Página de entrevista com
//     texto corrido a 1483px encolhida pra 390px de celular é ilegível. Com
//     zoom ligado o dedo passa a mover a página, não a virar — senão não
//     daria pra ler o canto direito de nada.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ANGULO_DEITADO,
  ANGULO_VIRADO,
  anguloDaVirada,
  CLICK_RUA_TAG,
  confirmaVirada,
  paginasDe,
  rotuloEdicao,
  type Edicao,
  type EdicaoPronta,
  type SentidoVirada,
} from '@/lib/clickRua';
import { useClickRua } from '@/lib/hooks/useClickRua';

export function ClickRuaView() {
  const [lendo, setLendo] = useState<EdicaoPronta | null>(null);
  const { edicoes, loading, error } = useClickRua();

  return (
    <div className="px-3.5 pt-4 pb-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/click-rua/logo.webp"
        alt="Click Rua"
        width={600}
        height={295}
        style={{ width: '100%', maxWidth: 260, height: 'auto', display: 'block' }}
      />
      <p style={{ fontSize: 13, color: 'var(--color-ink)', marginTop: 10, lineHeight: 1.5 }}>
        Revista digital de graffiti do Brasil inteiro — onde quem faz é você.
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 16 }}>
        {CLICK_RUA_TAG}
      </p>

      {loading ? (
        <p className="text-center text-sm py-8" style={{ color: 'var(--color-muted)' }}>
          Carregando as edições…
        </p>
      ) : error ? (
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--color-danger)',
            border: '1px solid var(--color-danger)',
            borderRadius: 14,
            padding: 13,
          }}
        >
          Não deu para carregar as edições agora. Verifique a conexão e tente de novo.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {edicoes.map((ed) => (
            <CardEdicao
              key={ed.numero}
              edicao={ed}
              onAbrir={() => ed.status === 'pronta' && setLendo(ed)}
            />
          ))}
        </div>
      )}

      {lendo ? <Leitor edicao={lendo} onFechar={() => setLendo(null)} /> : null}
    </div>
  );
}

function CardEdicao({ edicao, onAbrir }: { edicao: Edicao; onAbrir: () => void }) {
  const pronta = edicao.status === 'pronta';

  return (
    <button
      type="button"
      onClick={onAbrir}
      disabled={!pronta}
      aria-label={
        pronta ? `Ler ${rotuloEdicao(edicao.numero)}` : `${rotuloEdicao(edicao.numero)} em breve`
      }
      className="text-left"
      style={{
        background: 'var(--color-white)',
        border: '1px solid var(--color-border)',
        borderRadius: 14,
        overflow: 'hidden',
        padding: 0,
        cursor: pronta ? 'pointer' : 'default',
        opacity: pronta ? 1 : 0.65,
      }}
    >
      <div style={{ aspectRatio: '1 / 1', background: '#1a1a2e', position: 'relative' }}>
        {pronta ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={edicao.capa ?? ''}
            alt={`Capa da ${rotuloEdicao(edicao.numero)} da Click Rua`}
            width={560}
            height={560}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            className="flex items-center justify-center h-full"
            style={{
              background: 'linear-gradient(135deg, #ff6b35, #1a1a2e)',
              color: 'rgba(255,255,255,.9)',
              fontFamily: 'var(--font-display)',
              fontSize: 30,
              fontWeight: 800,
            }}
          >
            #{String(edicao.numero).padStart(2, '0')}
          </div>
        )}
      </div>
      <div style={{ padding: '9px 10px 11px' }}>
        <div className="font-bold" style={{ fontSize: 12, color: 'var(--color-ink)' }}>
          {rotuloEdicao(edicao.numero)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 2, lineHeight: 1.4 }}>
          {pronta
            ? [edicao.quando, `${edicao.paginas.length} páginas`].filter(Boolean).join(' · ')
            : 'Em breve'}
        </div>
        {pronta && edicao.destaque ? (
          <div
            style={{
              fontSize: 10,
              color: 'var(--color-p1)',
              marginTop: 4,
              fontWeight: 700,
              lineHeight: 1.35,
            }}
          >
            {edicao.destaque}
          </div>
        ) : null}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const ZOOM = 2.5;
/** Duração da virada quando ela é completada sozinha (ms). */
const DURACAO_VIRADA = 420;

interface Virada {
  sentido: SentidoVirada;
  angulo: number;
  /** true enquanto a CSS transition está levando a folha até o fim. */
  soltando: boolean;
}

function Leitor({ edicao, onFechar }: { edicao: EdicaoPronta; onFechar: () => void }) {
  const paginas = paginasDe(edicao);
  const ultima = paginas.length - 1;

  const [montado, setMontado] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [virada, setVirada] = useState<Virada | null>(null);
  const [zoom, setZoom] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const palcoRef = useRef<HTMLDivElement | null>(null);
  const gesto = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Já passamos pelo commit inicial?" não tem como ser sabido de forma
  // síncrona durante o render — não existe alternativa sem efeito pra esse
  // idioma (mount detection pra portal SSR-safe).
  useEffect(() => setMontado(true), []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Botão VOLTAR do Android fecha o leitor em vez de sair da tela. Mesmo
  // mecanismo do StoryViewer: empurra uma entrada no histórico ao abrir, o
  // "voltar" consome ela e o popstate fecha. `onFechar` fica numa ref pra o
  // efeito não rearmar a cada render e empilhar entradas fantasma.
  const fecharRef = useRef(onFechar);
  useEffect(() => {
    fecharRef.current = onFechar;
  }, [onFechar]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let consumido = false;
    window.history.pushState({ qucClickRua: true }, '');
    function aoVoltar() {
      consumido = true;
      fecharRef.current();
    }
    window.addEventListener('popstate', aoVoltar);
    return () => {
      window.removeEventListener('popstate', aoVoltar);
      // Fechou pelo X ou pelo Esc: desfaz a entrada, senão o próximo
      // "voltar" não sairia da tela — só apagaria essa sobra.
      if (!consumido) window.history.back();
    };
  }, []);

  /** Completa (ou desfaz) a virada com animação e ajusta a página. */
  const finalizar = useCallback(
    (sentido: SentidoVirada, confirma: boolean) => {
      const alvo = sentido === 'frente'
        ? (confirma ? ANGULO_VIRADO : ANGULO_DEITADO)
        : (confirma ? ANGULO_DEITADO : ANGULO_VIRADO);
      setVirada({ sentido, angulo: alvo, soltando: true });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (confirma) setPagina((p) => (sentido === 'frente' ? p + 1 : p - 1));
        setVirada(null);
      }, DURACAO_VIRADA);
    },
    [],
  );

  /** Vira por toque nas laterais, teclado ou botão — sem arrastar. */
  const virarPara = useCallback(
    (sentido: SentidoVirada) => {
      if (virada || zoom) return;
      if (sentido === 'frente' && pagina >= ultima) return;
      if (sentido === 'tras' && pagina <= 0) return;
      finalizar(sentido, true);
    },
    [virada, zoom, pagina, ultima, finalizar],
  );

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') fecharRef.current();
      if (e.key === 'ArrowRight') virarPara('frente');
      if (e.key === 'ArrowLeft') virarPara('tras');
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [virarPara]);

  function aoTocarInicio(e: React.TouchEvent) {
    if (e.touches.length !== 1 || (virada && virada.soltando)) return;
    const t = e.touches[0]!;
    gesto.current = { x: t.clientX, y: t.clientY, px: pan.x, py: pan.y };
  }

  function aoTocarMover(e: React.TouchEvent) {
    const g = gesto.current;
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const dx = t.clientX - g.x;

    // Com zoom o dedo move a PÁGINA. Sem isto o gesto viraria a folha e não
    // daria pra ler o canto direito de nada.
    if (zoom) {
      setPan({ x: g.px + dx, y: g.py + (t.clientY - g.y) });
      return;
    }

    const largura = palcoRef.current?.clientWidth ?? 0;
    if (largura === 0) return;

    let sentido = virada?.sentido ?? null;
    if (!sentido) {
      if (Math.abs(dx) < 8) return; // ruído do toque
      sentido = dx < 0 ? 'frente' : 'tras';
      // Não há folha pra virar nas pontas: na última página arrastar pra
      // esquerda não faz nada, na capa arrastar pra direita também não.
      if (sentido === 'frente' && pagina >= ultima) return;
      if (sentido === 'tras' && pagina <= 0) return;
    }
    setVirada({ sentido, angulo: anguloDaVirada(dx, largura, sentido), soltando: false });
  }

  function aoTocarFim() {
    gesto.current = null;
    if (!virada || virada.soltando) return;
    finalizar(virada.sentido, confirmaVirada(virada.angulo, virada.sentido));
  }

  function alternarZoom() {
    setZoom((z) => {
      if (z) setPan({ x: 0, y: 0 });
      return !z;
    });
  }

  if (!montado) return null;

  // Quem está na folha que gira e quem aparece por baixo dela.
  //  - avançando: a folha é a página atual saindo; por baixo, a próxima.
  //  - voltando:  a folha é a anterior voltando; por baixo, a atual.
  const idxFolha = virada ? (virada.sentido === 'frente' ? pagina : pagina - 1) : -1;
  const idxFundo = virada ? (virada.sentido === 'frente' ? pagina + 1 : pagina) : pagina;
  const sombra = virada ? Math.min(1, Math.abs(virada.angulo) / 180) : 0;

  const conteudo = (
    <div
      // z-[1100]: o BottomSheet é z-[1000] e este leitor é aberto de dentro
      // dele. Com z-[400] (o do StoryViewer) o leitor abre ATRÁS do sheet.
      className="fixed inset-0 z-[1100] bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={`${rotuloEdicao(edicao.numero)} da Click Rua`}
    >
      <div
        ref={palcoRef}
        className="absolute inset-0 flex items-center justify-center"
        style={{
          perspective: 1800,
          touchAction: 'none',
          overflow: 'hidden',
        }}
        onTouchStart={aoTocarInicio}
        onTouchMove={aoTocarMover}
        onTouchEnd={aoTocarFim}
        onTouchCancel={aoTocarFim}
        onDoubleClick={alternarZoom}
      >
        {/* Página de baixo — a que está sendo revelada (ou a atual, parada). */}
        <Folha
          src={paginas[idxFundo]}
          numero={idxFundo + 1}
          total={paginas.length}
          zoom={zoom && !virada}
          pan={pan}
        />

        {/* A folha que gira. Some ao passar dos 90° porque o verso está
            escondido — é o que revela a página de baixo. */}
        {virada && idxFolha >= 0 ? (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transformOrigin: 'left center',
              transform: `rotateY(${virada.angulo}deg)`,
              transition: virada.soltando ? `transform ${DURACAO_VIRADA}ms ease-in-out` : 'none',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              willChange: 'transform',
            }}
          >
            <Folha
              src={paginas[idxFolha]}
              numero={idxFolha + 1}
              total={paginas.length}
              zoom={false}
              pan={{ x: 0, y: 0 }}
            />
            {/* Sombra que escurece a folha conforme ela levanta — é o que
                dá volume ao movimento em vez de parecer um slide. */}
            <div
              className="absolute inset-0"
              style={{
                pointerEvents: 'none',
                background: 'linear-gradient(90deg, rgba(0,0,0,.45), rgba(0,0,0,0) 55%)',
                opacity: sombra,
              }}
            />
          </div>
        ) : null}

        {/* Zonas de toque pra virar sem arrastar (e pra quem usa mouse). */}
        {!zoom ? (
          <>
            <button
              type="button"
              aria-label="Página anterior"
              onClick={() => virarPara('tras')}
              disabled={pagina <= 0}
              className="absolute top-0 bottom-0 left-0"
              style={{ width: '22%', background: 'transparent', border: 'none', cursor: 'pointer' }}
            />
            <button
              type="button"
              aria-label="Próxima página"
              onClick={() => virarPara('frente')}
              disabled={pagina >= ultima}
              className="absolute top-0 bottom-0 right-0"
              style={{ width: '22%', background: 'transparent', border: 'none', cursor: 'pointer' }}
            />
          </>
        ) : null}
      </div>

      <div
        className="absolute left-0 right-0 flex items-center justify-between px-3"
        style={{ top: 'calc(8px + env(safe-area-inset-top))' }}
      >
        <span
          className="rounded-full font-bold"
          style={{
            padding: '6px 12px',
            fontSize: 12,
            background: 'rgba(0,0,0,.55)',
            color: '#fff',
          }}
        >
          {pagina + 1} / {paginas.length}
        </span>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar a revista"
          className="rounded-full flex items-center justify-center"
          style={{
            width: 40,
            height: 40,
            background: 'rgba(0,0,0,.55)',
            color: '#fff',
            border: 'none',
            fontSize: 22,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>

      <p
        className="absolute left-0 right-0 text-center"
        style={{
          bottom: 'calc(10px + env(safe-area-inset-bottom))',
          fontSize: 11,
          color: 'rgba(255,255,255,.6)',
          pointerEvents: 'none',
        }}
      >
        {zoom
          ? 'Arraste para mover · toque duas vezes para afastar'
          : 'Arraste para virar a página · toque duas vezes para aproximar'}
      </p>
    </div>
  );

  return createPortal(conteudo, document.body);
}

function Folha({
  src,
  numero,
  total,
  zoom,
  pan,
}: {
  src: string | undefined;
  numero: number;
  total: number;
  zoom: boolean;
  pan: { x: number; y: number };
}) {
  if (!src) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Página ${numero} de ${total}`}
        width={1483}
        height={1483}
        draggable={false}
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: '100%',
          objectFit: 'contain',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom ? ZOOM : 1})`,
          transition: 'transform .18s ease-out',
          userSelect: 'none',
        }}
      />
    </div>
  );
}
