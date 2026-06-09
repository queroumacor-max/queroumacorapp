import type { Metadata, Viewport } from 'next';
import { Syne, DM_Sans } from 'next/font/google';
import { Suspense } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { QueryProvider } from '@/components/QueryProvider';
import { ToastViewport } from '@/components/ToastViewport';
import { StagingBanner } from '@/components/StagingBanner';
import { ReferralCapture } from '@/components/ReferralCapture';
import { DialogProvider } from '@/components/Dialog';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import './globals.css';

// Domínio do Supabase pra preconnect — economiza 100-300ms no primeiro request
// a cada nova sessão (DNS + TLS handshake feito eagerly).
const SUPABASE_HOST =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

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
  manifest: '/manifest.webmanifest',
  // Ícones servidos como assets estáticos em /public — `app/icon.png` virou
  // route dinâmica pro @cloudflare/next-on-pages e estourava build sem
  // `export const runtime = 'edge'`. Manter em /public evita o problema.
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'QueroUmaCor',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#ff6b35',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${syne.variable} ${dmSans.variable}`}>
      <head>
        {/* Preconnect ao Supabase — DNS + TCP + TLS handshake antecipado.
            Economiza 100-300ms na primeira requisição (Auth, RLS query). */}
        {SUPABASE_HOST ? (
          <>
            <link rel="preconnect" href={`https://${SUPABASE_HOST}`} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={`https://${SUPABASE_HOST}`} />
          </>
        ) : null}
        {/* Setar tema ANTES do hydrate pra evitar FOUC (flash de tema
            claro). Lê localStorage 'theme' ('light'|'dark'); se ausente,
            cai no prefers-color-scheme do sistema. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('theme');var t=s||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {/* AuthProvider envolve toda a árvore — substitui o `currentUser` global
            do vanilla por React Context. useAuth() é o consumer de qualquer
            client component que precise de session/user.
            QueryProvider fica DENTRO do AuthProvider pra que hooks que
            consomem ambos (useNotifications etc.) tenham acesso ao user no
            queryKey/enabled sem ordem de inicialização ambígua. */}
        <ServiceWorkerRegister />
        <AuthProvider>
          <QueryProvider>
            <DialogProvider>
              <StagingBanner />
              {/* Suspense exigido por useSearchParams() em ReferralCapture
                  quando renderiza em rotas dinâmicas. */}
              <Suspense fallback={null}>
                <ReferralCapture />
              </Suspense>
              {children}
              <ToastViewport />
            </DialogProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
