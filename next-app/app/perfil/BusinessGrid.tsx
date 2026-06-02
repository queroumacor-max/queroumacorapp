// BusinessGrid — replica o grid 3-col "Meu Negócio" do vanilla (index.html
// #screen-myprofile). Cada card: ícone emoji 28px + título + subtítulo.
// Card "Seu Zé" e "Arte IG" usam gradiente PRO (laranja → roxo).
//
// Vanilla abre Checklist / Anotações / Pontos / Calculadora como
// bottom-sheet (overlay+sheet) em vez de navegar pra outra tela.
// Replicamos isso aqui via componente BottomSheet — tile vira <button>
// que dispara state local de qual sheet abrir.
'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { ChecklistView } from '@/app/checklist/ChecklistView';
import { NotesView } from '@/app/notes/NotesView';
import { CalcView } from '@/app/calculadora/CalcView';
import { PontosView } from '@/app/pontos/PontosView';

type SheetKey = 'checklist' | 'notes' | 'calculadora' | 'pontos';

interface Tile {
  href?: string;
  /** Quando setado, click abre o bottom-sheet com o conteúdo dessa key
      em vez de navegar pra href. */
  sheet?: SheetKey;
  emoji?: string;
  icon?: ReactNode;
  title: string;
  subtitle: string;
  gradient?: 'pro' | 'art';
}

// Ordem espelha o vanilla. Seu Zé / Arte IG ficam com gradient PRO.
const TILES: readonly Tile[] = [
  { href: '/pedidos', emoji: '📋', title: 'Meus Pedidos', subtitle: 'Orçamentos' },
  { href: '/orcamento-ia', emoji: '📄', title: 'Orçamento', subtitle: 'Crie e envie' },
  { href: '/orcamentos', emoji: '🗂️', title: 'Orçamentos', subtitle: 'Pipeline e aprovação' },
  { sheet: 'pontos', emoji: '🎁', title: 'Meus Pontos', subtitle: 'Pra ganhar PRO' },
  { href: '/publicar', emoji: '📸', title: 'Meu Portfolio', subtitle: 'Postar trabalhos' },
  { sheet: 'calculadora', emoji: '🧮', title: 'Calculadora', subtitle: 'Tinta e material' },
  { href: '/agenda', emoji: '📅', title: 'Agenda', subtitle: 'Meus projetos' },
  { href: '/crm', emoji: '🔁', title: 'Reativar clientes', subtitle: 'Follow-up · PRO' },
  { sheet: 'checklist', emoji: '✅', title: 'Checklist', subtitle: 'Itens da obra' },
  { href: '/financeiro', emoji: '💰', title: 'Financeiro', subtitle: 'Lucro e comissão' },
  { sheet: 'notes', emoji: '📝', title: 'Anotações', subtitle: 'Notas e lembretes' },
  { href: '/seu-ze', title: 'Seu Zé', subtitle: 'Tira dúvidas · PRO', gradient: 'pro' },
  { href: '/arte-ig', emoji: '🎨', title: 'Arte pra IG', subtitle: 'Foto vira post · PRO', gradient: 'art' },
  { href: '/camisetas', emoji: '👕', title: 'Camisetas', subtitle: 'Com seu logo' },
  { href: '/perfil/formacao', emoji: '🎓', title: 'Formação', subtitle: 'Qualificações' },
  { href: '/perfil/formacao?tab=courses', emoji: '📚', title: 'Cursos', subtitle: 'Workshops e treinos' },
];

export function BusinessGrid() {
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5">
        {TILES.map((t, i) => (
          <BusinessCard
            key={t.href ?? t.sheet ?? i}
            tile={t}
            onOpenSheet={(k) => setOpenSheet(k)}
          />
        ))}
      </div>

      <BottomSheet
        open={openSheet === 'pontos'}
        onClose={() => setOpenSheet(null)}
        ariaLabel="Meus Pontos"
      >
        <PontosView />
      </BottomSheet>
      <BottomSheet
        open={openSheet === 'calculadora'}
        onClose={() => setOpenSheet(null)}
        ariaLabel="Calculadora de Tinta"
      >
        <CalcView />
      </BottomSheet>
      <BottomSheet
        open={openSheet === 'checklist'}
        onClose={() => setOpenSheet(null)}
        ariaLabel="Checklist de Obra"
      >
        <ChecklistView />
      </BottomSheet>
      <BottomSheet
        open={openSheet === 'notes'}
        onClose={() => setOpenSheet(null)}
        ariaLabel="Minhas Anotações"
      >
        <NotesView />
      </BottomSheet>
    </>
  );
}

interface BusinessCardProps {
  tile: Tile;
  onOpenSheet: (key: SheetKey) => void;
}

function BusinessCard({ tile, onOpenSheet }: BusinessCardProps) {
  const isGradient = tile.gradient !== undefined;
  const background = !isGradient
    ? '#fff'
    : tile.gradient === 'pro'
    ? 'linear-gradient(135deg, #2ec4b6, #8338ec)'
    : 'linear-gradient(135deg, #ff6b35, #8338ec)';

  const textColor = isGradient ? '#fff' : 'var(--color-ink)';
  const subColor = isGradient ? 'rgba(255,255,255,.85)' : 'var(--color-muted)';

  const sharedStyle = {
    background,
    boxShadow: isGradient
      ? '0 2px 10px rgba(0,0,0,.1)'
      : '0 2px 10px rgba(0,0,0,.06)',
    minHeight: '92px',
  } as const;

  const inner = (
    <>
      <div className="text-[28px] leading-none mb-1.5" style={{ color: textColor }}>
        {tile.gradient === 'pro' ? (
          // Seu Zé: imagem real do urso em vez do emoji robot.
          // Match vanilla index.html linha 896.
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src="/img/seu-ze.webp"
            alt="Seu Zé"
            width={34}
            height={34}
            loading="lazy"
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              objectFit: 'cover',
              objectPosition: 'center top',
              background: '#1a1a2e',
              margin: '0 auto',
              display: 'block',
            }}
          />
        ) : (
          tile.emoji || '✨'
        )}
      </div>
      <div
        className="text-xs font-bold leading-tight"
        style={{ color: textColor }}
      >
        {tile.title}
      </div>
      <div
        className="text-[10px] mt-0.5 leading-tight"
        style={{ color: subColor }}
      >
        {tile.subtitle}
      </div>
    </>
  );

  if (tile.sheet) {
    return (
      <button
        type="button"
        onClick={() => onOpenSheet(tile.sheet!)}
        className="rounded-2xl p-4 text-center shadow-sm flex flex-col items-center justify-center relative cursor-pointer"
        style={sharedStyle}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={tile.href!}
      className="rounded-2xl p-4 text-center shadow-sm flex flex-col items-center justify-center relative"
      style={sharedStyle}
    >
      {inner}
    </Link>
  );
}
