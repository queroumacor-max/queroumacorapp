import type { Metadata } from 'next';
import { Syne, DM_Sans } from 'next/font/google';
import { AuthProvider } from '@/components/AuthProvider';
import { OnboardingModal } from '@/components/OnboardingModal';
import { QueryProvider } from '@/components/QueryProvider';
import { ToastViewport } from '@/components/ToastViewport';
import './globals.css';

// Self-host de Syne (display/marca) + DM Sans (body) via next/font/google.
// Vanilla usa as mesmas duas fontes — Syne auto-hospedada via @font-face
// em styles.css e DM Sans do Google. Next/font inliniza tudo no bundle,
// sem network call externo, e expõe CSS var pra usar nos `var(--font-*)`
// declarados em globals.css.
const syne = Syne({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-syne',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'QueroUmaCor',
  description: 'A plataforma dos pintores profissionais',
  // Ícones servidos como assets estáticos em /public — `app/icon.png` virou
  // route dinâmica pro @cloudflare/next-on-pages e estourava build sem
  // `export const runtime = 'edge'`. Manter em /public evita o problema.
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${syne.variable} ${dmSans.variable}`}>
      <body>
        {/* AuthProvider envolve toda a árvore — substitui o `currentUser` global
            do vanilla por React Context. useAuth() é o consumer de qualquer
            client component que precise de session/user.
            QueryProvider fica DENTRO do AuthProvider pra que hooks que
            consomem ambos (useNotifications etc.) tenham acesso ao user no
            queryKey/enabled sem ordem de inicialização ambígua. */}
        <AuthProvider>
          <QueryProvider>
            {children}
            {/* Tutorial inicial — render condicional via useOnboarding;
                aparece 1x por navegador (flag `onboarding_seen_v1` em
                localStorage) pra todos os usuários, autenticados ou não. */}
            <OnboardingModal />
            <ToastViewport />
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
