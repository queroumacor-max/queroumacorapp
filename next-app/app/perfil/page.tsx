// Página /perfil — equivalente à #screen-myprofile do vanilla.
// Estrutura espelha o vanilla: header dark, banner PRO, grid Meu Negócio
// (com Formação/Cursos incluídos), Configurações (com "Ver perfil público"
// como último item), Mais Informações, e botão Sair isolado.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { ProfileHeader } from './ProfileHeader';
import { BusinessGrid } from './BusinessGrid';
import { ProfileFooter } from './ProfileFooter';
import { InviteSection } from './InviteSection';
import { PortfolioSection } from './PortfolioSection';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Perfil | QueroUmaCor',
  description: 'Seu perfil, ferramentas de negócio e configurações.',
};

export default function PerfilPage() {
  return (
    <AppShell>
      <ProfileHeader />

      {/* Meu Negócio — grid 3-col com 16 cards (inclui Formação/Cursos
          no fim, espelhando o vanilla pós-merge `tiles no grid`). */}
      <div className="px-3.5 pt-4 pb-2">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Meu Negócio
        </div>
        <BusinessGrid />
      </div>

      {/* Convidar Amigos — gera código QUC-XXXXX + share */}
      <div className="px-3.5 pt-4 pb-2">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Convidar Amigos
        </div>
        <InviteSection />
      </div>

      {/* Configurações — card branco com rows. "Ver meu perfil público"
          é o último item dentro do card (não em seção separada). */}
      <div className="px-3.5 pt-4 pb-2">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Configurações
        </div>
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <ConfigRow href="/perfil/editar" emoji="✏️" label="Editar Perfil" />
          <ConfigRow href="/notificacoes" emoji="🔔" label="Ver notificações" />
          <ConfigRow href="/perfil/publico" emoji="👁️" label="Ver meu perfil público" last />
        </div>
      </div>

      {/* Mais informações e suporte */}
      <div className="px-3.5 pt-4 pb-2">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Mais Informações e Suporte
        </div>
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <Link
            href="/info"
            className="flex items-center gap-3 px-4 py-3.5"
          >
            <span className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl flex-shrink-0">
              ℹ️
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-[color:var(--color-ink)]">
                Ajuda, privacidade e sobre
              </span>
              <span className="block text-xs text-[color:var(--color-muted)] mt-0.5">
                Central de ajuda, termos, privacidade e contato
              </span>
            </span>
            <span className="text-[color:var(--color-muted)]">›</span>
          </Link>
        </div>
      </div>

      {/* Meu Portfólio — grid 3-col dos posts próprios */}
      <PortfolioSection />

      {/* Sair — botão isolado, full width, estilo vanilla */}
      <ProfileFooter />
    </AppShell>
  );
}

// ─── helper components ─────────────────────────────────────────────────────

interface ConfigRowProps {
  href: string;
  emoji: string;
  label: string;
  last?: boolean;
}

function ConfigRow({ href, emoji, label, last }: ConfigRowProps) {
  return (
    <Link
      href={href}
      className={
        'flex items-center gap-3 px-4 py-3.5 ' +
        (last ? '' : 'border-b border-[color:var(--color-border)]')
      }
    >
      <span className="text-lg">{emoji}</span>
      <span className="flex-1 text-sm font-semibold text-[color:var(--color-ink)]">
        {label}
      </span>
      <span className="text-[color:var(--color-muted)]">›</span>
    </Link>
  );
}
