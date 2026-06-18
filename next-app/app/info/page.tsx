// Página Info — porta `modules/info.js` + tela `#screen-info` do vanilla
// (`index.html` linhas 1109-1288). Mudanças vs vanilla:
//  - vanilla mantém todas as 6 sub-páginas (menu, ajuda, contato, privacidade,
//    termos, conta, sobre) num único DOM trocando display:none/block;
//    aqui usamos cards no menu + links pra sub-rotas (`/info/ajuda`, etc).
//    PoC só renderiza o menu — sub-páginas viram TODO até serem portadas;
//  - `requestAccountDeletion()` (RPC do Supabase) e `baixarMeusDados()`
//    (download de /api/me-export) precisam de auth/session — viram client
//    components em `/info/conta` quando portados;
//  - links externos (WhatsApp/email) ficam aqui como hrefs puros, exatamente
//    como `supportWhatsApp()` / `supportEmail()` fazem via window.open/location.
import type { Metadata } from 'next';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { DeleteAccountSection } from './DeleteAccountSection';

export const metadata: Metadata = {
  title: 'Informações | QueroUmaCor',
  description:
    'Central de ajuda, contato, política de privacidade e termos de uso do QueroUmaCor.',
};

// Espelha SUPPORT do `modules/info.js`. Em algum momento isso vira
// `lib/config.ts` (compartilhado com outras features que usam o contato).
const SUPPORT = {
  email: 'loja@calicolors.com.br',
  whatsapp: '5511959765031', // DDI+DDD+número, formato wa.me
  whatsappDisplay: '(11) 95976-5031',
};

const waHelpHref =
  `https://wa.me/${SUPPORT.whatsapp}?text=` +
  encodeURIComponent('Olá! Preciso de ajuda com o app QueroUmaCor.');

const mailtoHref =
  `mailto:${SUPPORT.email}` +
  `?subject=${encodeURIComponent('Suporte QueroUmaCor')}` +
  `&body=${encodeURIComponent('Descreva sua dúvida ou problema:\n\n')}`;

// waDeleteHref movido pra DeleteAccountSection.tsx (LGPD M3).

interface InfoItem {
  icon: string;
  title: string;
  body: string;
  actions: { label: string; href: string; variant?: 'primary' | 'secondary' }[];
  danger?: boolean;
}

const ITEMS: InfoItem[] = [
  {
    icon: '🆘',
    title: 'Central de Ajuda',
    body: 'Dúvidas frequentes sobre o app: cadastro, orçamentos, portfólio e mais.',
    actions: [{ label: 'Ver perguntas', href: '/info/ajuda' }],
  },
  {
    icon: '💬',
    title: 'Fale Conosco',
    body: `Atendimento de segunda a sexta, das 9h às 18h. WhatsApp ${SUPPORT.whatsappDisplay} ou ${SUPPORT.email}.`,
    actions: [
      { label: 'WhatsApp', href: waHelpHref, variant: 'primary' },
      { label: 'Email', href: mailtoHref, variant: 'secondary' },
    ],
  },
  {
    icon: '🔒',
    title: 'Política de Privacidade (LGPD)',
    body: 'Como coletamos, usamos e protegemos seus dados pessoais.',
    actions: [{ label: 'Ler', href: '/info/privacidade' }],
  },
  {
    icon: '📄',
    title: 'Termos de Uso',
    body: 'Regras de uso da plataforma e responsabilidades das partes.',
    actions: [{ label: 'Ler', href: '/info/termos' }],
  },
  {
    icon: '🧑‍🔧',
    title: 'Termos de Uso — Profissional',
    body: 'Regras e responsabilidades específicas de quem presta serviços na plataforma.',
    actions: [{ label: 'Ler', href: '/info/termos-profissional' }],
  },
  {
    icon: '🙋',
    title: 'Termos de Uso — Cliente',
    body: 'Regras e direitos de quem contrata serviços na plataforma.',
    actions: [{ label: 'Ler', href: '/info/termos-cliente' }],
  },
  {
    icon: '🛡️',
    title: 'Política Anti-Fraude',
    body: 'Condutas proibidas, uso aceitável e consequências para quem descumpre.',
    actions: [{ label: 'Ler', href: '/info/antifraude' }],
  },
  {
    icon: '©️',
    title: 'Direitos Autorais',
    body: 'Titularidade do conteúdo, canal DMCA e uso da marca QueroUmaCor.',
    actions: [{ label: 'Ler', href: '/info/copyright' }],
  },
  {
    icon: '⚖️',
    title: 'Como Resolver Disputas',
    body: 'Passo a passo para resolver problemas entre clientes e profissionais.',
    actions: [{ label: 'Ler', href: '/info/disputas' }],
  },
  {
    icon: 'ℹ️',
    title: 'Sobre o QueroUmaCor',
    body: 'Conectamos clientes aos melhores profissionais de pintura — pintores, grafiteiros, muralistas, pintores automotivos e funileiros.',
    actions: [{ label: 'Saiba mais', href: '/info/sobre' }],
  },
  // Card "Excluir minha conta" agora é o componente client
  // DeleteAccountSection (renderizado no JSX abaixo), que chama o
  // endpoint /api/delete-account com confirmação dupla.
];

export default function InfoPage() {
  // requireAuth=false: acessível deslogado (links do rodapé do login), mas com
  // TopNav + BottomNav globais como o resto do app.
  return (
    <AppShell requireAuth={false}>
      <header className="bg-white border-b border-[color:var(--color-border)] px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <Link
          href="/"
          aria-label="Voltar"
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[color:var(--color-bg)] text-[color:var(--color-ink)] text-xl"
        >
          ‹
        </Link>
        <h1
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Mais informações e suporte
        </h1>
      </header>

      <div className="max-w-2xl mx-auto p-4 space-y-3">
        {ITEMS.map((item) => (
          <InfoCard key={item.title} item={item} />
        ))}

        <DeleteAccountSection />

        <p className="text-center text-xs text-[color:var(--color-muted)] pt-4">
          QueroUmaCor • Versão 1.0
        </p>
      </div>
    </AppShell>
  );
}

function InfoCard({ item }: { item: InfoItem }) {
  return (
    <article className="bg-white rounded-2xl p-5 shadow-sm">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl" aria-hidden="true">
          {item.icon}
        </span>
        <div className="flex-1">
          <h2
            className={
              'font-bold text-base mb-1 ' +
              (item.danger ? 'text-[color:var(--color-danger)]' : '')
            }
          >
            {item.title}
          </h2>
          <p className="text-sm text-[color:var(--color-muted)] leading-relaxed">
            {item.body}
          </p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {item.actions.map((a) => {
          const external = a.href.startsWith('http') || a.href.startsWith('mailto:');
          const variant = a.variant ?? 'primary';
          const cls =
            variant === 'primary'
              ? 'bg-[color:var(--color-p1)] text-white'
              : 'bg-[color:var(--color-bg)] text-[color:var(--color-ink)] border border-[color:var(--color-border)]';
          return external ? (
            <a
              key={a.label}
              href={a.href}
              target={a.href.startsWith('mailto:') ? undefined : '_blank'}
              rel={a.href.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
              className={`${cls} px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity`}
            >
              {a.label}
            </a>
          ) : (
            <Link
              key={a.label}
              href={a.href}
              className={`${cls} px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity`}
            >
              {a.label}
            </Link>
          );
        })}
      </div>
    </article>
  );
}
