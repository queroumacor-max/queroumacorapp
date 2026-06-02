// Página /perfil — equivalente à #screen-myprofile do vanilla.
// Header dark com avatar + nome + stats, banner PRO, grid "Meu Negócio"
// com 9 cards (Pedidos/Orçamentos/Pipeline/Pontos/Portfolio/Calculadora/
// Agenda/CRM/Checklist) + Seu Zé + Financeiro/Anotações + Camisetas.
//
// Cards usam o mesmo padrão visual do vanilla: fundo branco, radius 16,
// ícone emoji 28px + título 12px bold + subtítulo 10px muted.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { ProfileHeader } from './ProfileHeader';
import { BusinessGrid } from './BusinessGrid';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Perfil | QueroUmaCor',
  description: 'Seu perfil, ferramentas de negócio e configurações.',
};

export default function PerfilPage() {
  return (
    <AppShell>
      <ProfileHeader />

      {/* Banner PRO — só pra quem não é PRO. ProfileHeader checa e esconde. */}

      <div className="px-3.5 pt-4 pb-2">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Meu Negócio
        </div>
        <BusinessGrid />
      </div>

      {/* Configurações */}
      <div className="px-3.5 pt-4 pb-2">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Configurações
        </div>
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <ConfigRow href="/perfil/editar" emoji="✏️" label="Editar Perfil" />
          <ConfigRow href="/perfil/editar?tab=specs" emoji="🎨" label="Especialidades" />
          <ConfigRow href="/perfil/editar?tab=raio" emoji="📍" label="Raio de Atendimento" />
          <ConfigRow href="/notificacoes" emoji="🔔" label="Notificações" last />
        </div>
      </div>

      {/* Perfil público — 2 tiles */}
      <div className="px-3.5 pt-4 pb-2">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Perfil Público
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Tile href="/perfil/formacao" emoji="🎓" title="Formação" subtitle="Qualificações" />
          <Tile href="/perfil/formacao?tab=courses" emoji="📚" title="Cursos" subtitle="Workshops e treinos" />
        </div>
      </div>

      <div className="px-3.5 pt-6 pb-6">
        <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
          Conta
        </div>
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <ConfigRow href="/info" emoji="ℹ️" label="Sobre / Fale Conosco" />
          <ConfigRow href="/logout" emoji="🚪" label="Sair" last danger />
        </div>
      </div>
    </AppShell>
  );
}

// ─── helper components (server-rendered, leves) ─────────────────────────────

interface ConfigRowProps {
  href: string;
  emoji: string;
  label: string;
  last?: boolean;
  danger?: boolean;
}

function ConfigRow({ href, emoji, label, last, danger }: ConfigRowProps) {
  return (
    <Link
      href={href}
      className={
        'flex items-center gap-3 px-4 py-3.5 cursor-pointer ' +
        (last ? '' : 'border-b border-[color:var(--color-border)]')
      }
    >
      <span className="text-lg">{emoji}</span>
      <span
        className={
          'flex-1 text-sm font-semibold ' +
          (danger ? 'text-[color:var(--color-danger)]' : 'text-[color:var(--color-ink)]')
        }
      >
        {label}
      </span>
      <span className="text-[color:var(--color-muted)]">›</span>
    </Link>
  );
}

interface TileProps {
  href: string;
  emoji: string;
  title: string;
  subtitle: string;
}

function Tile({ href, emoji, title, subtitle }: TileProps) {
  return (
    <Link
      href={href}
      className="bg-white rounded-2xl p-5 text-center shadow-sm flex flex-col items-center justify-center min-h-[110px]"
    >
      <span className="text-3xl mb-2">{emoji}</span>
      <span className="text-[13px] font-bold text-[color:var(--color-ink)] leading-tight">
        {title}
      </span>
      <span className="text-[10px] text-[color:var(--color-muted)] mt-0.5">
        {subtitle}
      </span>
    </Link>
  );
}
