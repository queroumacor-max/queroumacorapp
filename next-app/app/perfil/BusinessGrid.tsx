// BusinessGrid — grid 3-col "Meu Negócio" do vanilla (#screen-myprofile).
// TODOS os tiles abrem como bottom-sheet (igual vanilla, que mostrava
// cada feature como `.overlay`+`.sheet`). As routes standalone (/pedidos,
// /agenda, /crm, etc) continuam existindo pra deep-link/SEO.
'use client';

import { useState, lazy, Suspense } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { isAdmin } from '@/lib/policies';

// Lazy-load das views pra não inchar o JS inicial do /perfil. Cada modal
// só baixa o chunk quando o user abre. Mesma técnica que vanilla aplicava
// implicitamente (módulo carregava só quando showModal disparava).
const PontosView = lazy(() =>
  import('@/app/pontos/PontosView').then((m) => ({ default: m.PontosView })),
);
const CalcView = lazy(() =>
  import('@/app/calculadora/CalcView').then((m) => ({ default: m.CalcView })),
);
const ChecklistView = lazy(() =>
  import('@/app/checklist/ChecklistView').then((m) => ({ default: m.ChecklistView })),
);
const NotesView = lazy(() =>
  import('@/app/notes/NotesView').then((m) => ({ default: m.NotesView })),
);
const PedidosList = lazy(() =>
  import('@/app/pedidos/PedidosList').then((m) => ({ default: m.PedidosList })),
);
const QuoteWizard = lazy(() =>
  import('@/app/orcamento-ia/QuoteWizard').then((m) => ({ default: m.QuoteWizard })),
);
const PipelineKanban = lazy(() =>
  import('@/app/orcamentos/PipelineKanban').then((m) => ({ default: m.PipelineKanban })),
);
const Composer = lazy(() =>
  import('@/app/publicar/Composer').then((m) => ({ default: m.Composer })),
);
const AgendaCalendar = lazy(() =>
  import('@/app/agenda/AgendaCalendar').then((m) => ({ default: m.AgendaCalendar })),
);
const CrmList = lazy(() =>
  import('@/app/crm/CrmList').then((m) => ({ default: m.CrmList })),
);
const FinanceiroDashboard = lazy(() =>
  import('@/app/financeiro/Dashboard').then((m) => ({ default: m.Dashboard })),
);
const SeuZeChat = lazy(() =>
  import('@/app/seu-ze/SeuZeChat').then((m) => ({ default: m.SeuZeChat })),
);
const AliceChat = lazy(() =>
  import('@/app/alice/AliceChat').then((m) => ({ default: m.AliceChat })),
);
const FeChat = lazy(() =>
  import('@/app/fe/FeChat').then((m) => ({ default: m.FeChat })),
);
const SennaChat = lazy(() =>
  import('@/app/senna/SennaChat').then((m) => ({ default: m.SennaChat })),
);
const AiArtStudio = lazy(() =>
  import('@/app/arte-ig/AiArtStudio').then((m) => ({ default: m.AiArtStudio })),
);
const ShirtCustomizer = lazy(() =>
  import('@/app/camisetas/ShirtCustomizer').then((m) => ({ default: m.ShirtCustomizer })),
);
const QualsSection = lazy(() =>
  import('@/app/perfil/formacao/QualsSection').then((m) => ({ default: m.QualsSection })),
);
const CoursesSection = lazy(() =>
  import('@/app/perfil/formacao/CoursesSection').then((m) => ({ default: m.CoursesSection })),
);
const ArteVendaView = lazy(() =>
  import('@/app/arte-venda/ArteVendaView').then((m) => ({ default: m.ArteVendaView })),
);

type SheetKey =
  | 'pedidos'
  | 'orcamento'
  | 'orcamentos'
  | 'pontos'
  | 'portfolio'
  | 'calculadora'
  | 'agenda'
  | 'crm'
  | 'checklist'
  | 'financeiro'
  | 'notes'
  | 'seu-ze'
  | 'alice'
  | 'fe'
  | 'senna'
  | 'arte-ig'
  | 'camisetas'
  | 'formacao'
  | 'cursos'
  | 'arte-venda';

interface SheetConfig {
  label: string;
  Component: ComponentType<Record<string, unknown>>;
}

const SHEETS: Record<SheetKey, SheetConfig> = {
  pedidos: { label: 'Meus Pedidos', Component: PedidosList as ComponentType },
  orcamento: { label: 'Orçamento', Component: QuoteWizard as ComponentType },
  orcamentos: { label: 'Pipeline de Orçamentos', Component: PipelineKanban as ComponentType },
  pontos: { label: 'Meus Pontos', Component: PontosView as ComponentType },
  portfolio: { label: 'Publicar', Component: Composer as ComponentType },
  calculadora: { label: 'Calculadora', Component: CalcView as ComponentType },
  agenda: { label: 'Agenda', Component: AgendaCalendar as ComponentType },
  crm: { label: 'Reativar Clientes', Component: CrmList as ComponentType },
  checklist: { label: 'Checklist de Obra', Component: ChecklistView as ComponentType },
  financeiro: { label: 'Financeiro', Component: FinanceiroDashboard as ComponentType },
  notes: { label: 'Anotações', Component: NotesView as ComponentType },
  'seu-ze': { label: 'Seu Zé', Component: SeuZeChat as ComponentType },
  alice: { label: 'Alice Codessi', Component: AliceChat as ComponentType },
  fe: { label: 'Fê', Component: FeChat as ComponentType },
  senna: { label: 'Senna', Component: SennaChat as ComponentType },
  'arte-ig': { label: 'Arte pra IG', Component: AiArtStudio as ComponentType },
  camisetas: { label: 'Camisetas', Component: ShirtCustomizer as ComponentType },
  formacao: { label: 'Formação', Component: QualsSection as ComponentType },
  cursos: { label: 'Cursos', Component: CoursesSection as ComponentType },
  'arte-venda': { label: 'Arte pra venda', Component: ArteVendaView as ComponentType },
};

interface Tile {
  sheet: SheetKey;
  emoji?: string;
  icon?: ReactNode;
  title: string;
  subtitle: string;
  gradient?: 'pro' | 'art' | 'designer' | 'graf' | 'auto';
}

const TILES: readonly Tile[] = [
  { sheet: 'pedidos', emoji: '📋', title: 'Meus Pedidos', subtitle: 'Orçamentos' },
  { sheet: 'orcamento', emoji: '📄', title: 'Orçamento', subtitle: 'Crie e envie' },
  { sheet: 'orcamentos', emoji: '🗂️', title: 'Orçamentos', subtitle: 'Pipeline e aprovação' },
  { sheet: 'pontos', emoji: '🎁', title: 'Meus Pontos', subtitle: 'Pra ganhar PRO' },
  { sheet: 'portfolio', emoji: '📸', title: 'Meu Portfolio', subtitle: 'Postar trabalhos' },
  { sheet: 'calculadora', emoji: '🧮', title: 'Calculadora', subtitle: 'Tinta e material' },
  { sheet: 'agenda', emoji: '📅', title: 'Agenda', subtitle: 'Meus projetos' },
  { sheet: 'crm', emoji: '🔁', title: 'Reativar clientes', subtitle: 'Follow-up · PRO' },
  { sheet: 'checklist', emoji: '✅', title: 'Checklist', subtitle: 'Itens da obra' },
  { sheet: 'financeiro', emoji: '💰', title: 'Financeiro', subtitle: 'Lucro e comissão' },
  { sheet: 'notes', emoji: '📝', title: 'Anotações', subtitle: 'Notas e lembretes' },
  { sheet: 'seu-ze', title: 'Seu Zé', subtitle: 'Tira dúvidas · PRO', gradient: 'pro' },
  { sheet: 'alice', title: 'Alice Codessi', subtitle: 'Designer de interiores', gradient: 'designer' },
  { sheet: 'fe', title: 'Fê', subtitle: 'Cena grafite · PRO', gradient: 'graf' },
  { sheet: 'senna', title: 'Senna', subtitle: 'Funilaria/auto · PRO', gradient: 'auto' },
  { sheet: 'arte-ig', emoji: '🎨', title: 'Arte pra IG', subtitle: 'Foto vira post · PRO', gradient: 'art' },
  { sheet: 'camisetas', emoji: '👕', title: 'Camisetas', subtitle: 'Com seu logo' },
  { sheet: 'formacao', emoji: '🎓', title: 'Formação', subtitle: 'Qualificações' },
  { sheet: 'cursos', emoji: '📚', title: 'Cursos', subtitle: 'Workshops e treinos' },
];

// Tiles condicionais ao role do user — só renderizam quando o role bate.
// Mapeia: chave = nome do tile no SHEETS, value = lista de roles que veem.
const ROLE_TILES: ReadonlyArray<{ sheet: SheetKey; emoji: string; title: string; subtitle: string; roles: string[]; gradient?: 'pro' | 'art' }> = [
  {
    sheet: 'arte-venda',
    emoji: '🖼️',
    title: 'Arte pra venda',
    subtitle: 'Catálogo de obras',
    roles: ['grafiteiro'],
    gradient: 'art',
  },
];

// Tiles admin-only: vanilla esconde via `display:none` no HTML e
// applyAdminUI() flipa quando is_portal_admin() retorna true (vide
// index.html linha 920+). Aqui condicionamos via render do isAdmin
// (que aceita portal_access=true). Abrem o /portal (admin React UMD).
interface AdminTile {
  href: string;
  emoji: string;
  title: string;
  subtitle: string;
}
const ADMIN_TILES: readonly AdminTile[] = [
  { href: '/portal/#moderation', emoji: '🛡️', title: 'Moderação', subtitle: 'Fila de revisão' },
  { href: '/portal/#errors', emoji: '🐛', title: 'Erros', subtitle: 'Log do client' },
];

export function BusinessGrid() {
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const activeConfig = openSheet ? SHEETS[openSheet] : null;
  const Active = activeConfig?.Component ?? null;
  const policyUser = usePolicyUser();
  const showAdmin = isAdmin(policyUser);
  const userRole = (policyUser?.role || '').toLowerCase();
  const visibleRoleTiles = ROLE_TILES.filter((t) =>
    t.roles.some((r) => r === userRole),
  );

  // Personas IA são role-específicas (1 persona por role profissional):
  //  - Seu Zé → pintor (e fallback genérico se role vazio)
  //  - Fê    → grafiteiro
  //  - Senna → automotivo / funileiro
  //  - Alice → cliente
  //  - Admin → vê todos os 4 pra testar
  const visibleTiles = TILES.filter((t) => {
    if (t.sheet === 'seu-ze') {
      return showAdmin || userRole === 'pintor' || (!userRole && userRole !== 'cliente');
    }
    if (t.sheet === 'fe') return showAdmin || userRole === 'grafiteiro';
    if (t.sheet === 'senna') return showAdmin || userRole === 'automotivo' || userRole === 'funileiro';
    if (t.sheet === 'alice') return showAdmin || userRole === 'cliente';
    return true;
  });

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5">
        {visibleTiles.map((t) => (
          <BusinessCard
            key={t.sheet}
            tile={t}
            onOpen={() => setOpenSheet(t.sheet)}
          />
        ))}
        {visibleRoleTiles.map((t) => (
          <BusinessCard
            key={t.sheet}
            tile={t}
            onOpen={() => setOpenSheet(t.sheet)}
          />
        ))}
        {showAdmin
          ? ADMIN_TILES.map((t) => (
              <AdminCard key={t.href} tile={t} />
            ))
          : null}
      </div>

      <BottomSheet
        open={!!openSheet}
        onClose={() => setOpenSheet(null)}
        ariaLabel={activeConfig?.label}
      >
        {Active ? (
          <Suspense
            fallback={
              <div className="text-center text-sm text-[color:var(--color-muted)] py-10">
                Carregando…
              </div>
            }
          >
            <Active />
          </Suspense>
        ) : null}
      </BottomSheet>
    </>
  );
}

interface BusinessCardProps {
  tile: Tile;
  onOpen: () => void;
}

function BusinessCard({ tile, onOpen }: BusinessCardProps) {
  const isGradient = tile.gradient !== undefined;
  const background = !isGradient
    ? '#fff'
    : tile.gradient === 'pro'
      ? 'linear-gradient(135deg, #2ec4b6, #8338ec)'
      : tile.gradient === 'designer'
        ? 'linear-gradient(135deg, #a78bfa, #7c3aed)'
        : tile.gradient === 'graf'
          ? 'linear-gradient(135deg, #ff6b35, #e10600)'
          : tile.gradient === 'auto'
            ? 'linear-gradient(135deg, #e10600, #1a1a2e)'
            : 'linear-gradient(135deg, #ff6b35, #8338ec)';

  const textColor = isGradient ? '#fff' : 'var(--color-ink)';
  const subColor = isGradient ? 'rgba(255,255,255,.85)' : 'var(--color-muted)';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-2xl p-4 text-center shadow-sm flex flex-col items-center justify-center relative cursor-pointer"
      style={{
        background,
        boxShadow: isGradient
          ? '0 2px 10px rgba(0,0,0,.1)'
          : '0 2px 10px rgba(0,0,0,.06)',
        minHeight: 92,
        border: 'none',
      }}
    >
      <div className="text-[28px] leading-none mb-1.5" style={{ color: textColor }}>
        {tile.gradient === 'pro' ? (
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
        ) : tile.gradient === 'designer' ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src="/img/alice.webp"
            alt="Alice Codessi"
            width={34}
            height={34}
            loading="lazy"
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              objectFit: 'cover',
              objectPosition: 'center top',
              background: '#f3e8ff',
              margin: '0 auto',
              display: 'block',
              border: '1.5px solid rgba(255,255,255,.7)',
            }}
          />
        ) : tile.gradient === 'graf' ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src="/img/fe.webp"
            alt="Fê"
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
              border: '1.5px solid rgba(255,255,255,.7)',
            }}
          />
        ) : tile.gradient === 'auto' ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src="/img/senna.webp"
            alt="Senna"
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
              border: '1.5px solid rgba(255,255,255,.7)',
            }}
          />
        ) : (
          tile.emoji || '✨'
        )}
      </div>
      <div className="text-xs font-bold leading-tight" style={{ color: textColor }}>
        {tile.title}
      </div>
      <div className="text-[10px] mt-0.5 leading-tight" style={{ color: subColor }}>
        {tile.subtitle}
      </div>
    </button>
  );
}

// AdminCard — tile escuro (ink) usado pra Moderação/Erros. Vanilla
// renderiza com fundo var(--ink) e texto branco pra destacar do
// resto do grid. Click abre /portal/#<hash> em outra aba (admin UMD).
function AdminCard({ tile }: { tile: AdminTile }) {
  return (
    <a
      href={tile.href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-2xl p-4 text-center shadow-sm flex flex-col items-center justify-center relative cursor-pointer"
      style={{
        background: 'var(--color-ink)',
        boxShadow: '0 2px 10px rgba(0,0,0,.1)',
        minHeight: 92,
        textDecoration: 'none',
      }}
    >
      <div className="text-[28px] leading-none mb-1.5" style={{ color: '#fff' }}>
        {tile.emoji}
      </div>
      <div
        className="text-xs font-bold leading-tight"
        style={{ color: '#fff' }}
      >
        {tile.title}
      </div>
      <div
        className="text-[10px] mt-0.5 leading-tight"
        style={{ color: 'rgba(255,255,255,.8)' }}
      >
        {tile.subtitle}
      </div>
    </a>
  );
}
