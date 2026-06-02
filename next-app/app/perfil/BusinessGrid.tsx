// BusinessGrid — replica o grid 3-col "Meu Negócio" do vanilla (index.html
// #screen-myprofile). Cada card: ícone emoji 28px + título + subtítulo.
// Card "Seu Zé" e "Arte IG" usam gradiente PRO (laranja → roxo).

import Link from 'next/link';
import type { ReactNode } from 'react';

interface Tile {
  href: string;
  emoji?: string;
  icon?: ReactNode;
  title: string;
  subtitle: string;
  /** Gradient card (Seu Zé / Arte IG estilo PRO). */
  gradient?: 'pro' | 'art';
}

// Ordem espelha o vanilla (index.html #screen-myprofile "Meu Negócio" grid)
// — pedidos, orçamento/pipeline, pontos/portfolio, calc/agenda/crm,
// checklist/financeiro/anotações, Seu Zé+Arte IG (gradient PRO), camisetas,
// formação, cursos. Logo IA fica acessível via /ai-logo direto (sem tile).
const TILES: readonly Tile[] = [
  { href: '/pedidos', emoji: '📋', title: 'Meus Pedidos', subtitle: 'Orçamentos' },
  { href: '/orcamento-ia', emoji: '📄', title: 'Orçamento', subtitle: 'Crie e envie' },
  { href: '/orcamentos', emoji: '🗂️', title: 'Orçamentos', subtitle: 'Pipeline e aprovação' },
  { href: '/pontos', emoji: '🎁', title: 'Meus Pontos', subtitle: 'Pra ganhar PRO' },
  { href: '/publicar', emoji: '📸', title: 'Meu Portfolio', subtitle: 'Postar trabalhos' },
  { href: '/calculadora', emoji: '🧮', title: 'Calculadora', subtitle: 'Tinta e material' },
  { href: '/agenda', emoji: '📅', title: 'Agenda', subtitle: 'Meus projetos' },
  { href: '/crm', emoji: '🔁', title: 'Reativar clientes', subtitle: 'Follow-up · PRO' },
  { href: '/checklist', emoji: '✅', title: 'Checklist', subtitle: 'Itens da obra' },
  { href: '/financeiro', emoji: '💰', title: 'Financeiro', subtitle: 'Lucro e comissão' },
  { href: '/notes', emoji: '📝', title: 'Anotações', subtitle: 'Notas e lembretes' },
  { href: '/seu-ze', title: 'Seu Zé', subtitle: 'Tira dúvidas · PRO', gradient: 'pro' },
  { href: '/arte-ig', emoji: '🎨', title: 'Arte pra IG', subtitle: 'Foto vira post · PRO', gradient: 'art' },
  { href: '/camisetas', emoji: '👕', title: 'Camisetas', subtitle: 'Com seu logo' },
  { href: '/perfil/formacao', emoji: '🎓', title: 'Formação', subtitle: 'Qualificações' },
  { href: '/perfil/formacao?tab=courses', emoji: '📚', title: 'Cursos', subtitle: 'Workshops e treinos' },
];

export function BusinessGrid() {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {TILES.map((t) => (
        <BusinessCard key={t.href} tile={t} />
      ))}
    </div>
  );
}

function BusinessCard({ tile }: { tile: Tile }) {
  const isGradient = tile.gradient !== undefined;
  const background = !isGradient
    ? '#fff'
    : tile.gradient === 'pro'
    ? 'linear-gradient(135deg, #2ec4b6, #8338ec)'
    : 'linear-gradient(135deg, #ff6b35, #8338ec)';

  const textColor = isGradient ? '#fff' : 'var(--color-ink)';
  const subColor = isGradient ? 'rgba(255,255,255,.85)' : 'var(--color-muted)';

  return (
    <Link
      href={tile.href}
      className="rounded-2xl p-4 text-center shadow-sm flex flex-col items-center justify-center relative"
      style={{
        background,
        boxShadow: isGradient
          ? '0 2px 10px rgba(0,0,0,.1)'
          : '0 2px 10px rgba(0,0,0,.06)',
        minHeight: '92px',
      }}
    >
      <div className="text-[28px] leading-none mb-1.5" style={{ color: textColor }}>
        {tile.emoji || (tile.gradient === 'pro' ? '🤖' : '✨')}
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
    </Link>
  );
}
