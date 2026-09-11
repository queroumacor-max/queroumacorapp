import type { Metadata, Viewport } from 'next';
import { Syne, DM_Sans } from 'next/font/google';
import { Suspense } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { QueryProvider } from '@/components/QueryProvider';
import { ToastViewport } from '@/components/ToastViewport';
import { StagingBanner } from '@/components/StagingBanner';
import { ReferralCapture } from '@/components/ReferralCapture';
import { DialogProvider } from '@/components/Dialog';
import { AuthGateProvider } from '@/components/AuthGate';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { AndroidWebViewScrollPin } from '@/components/AndroidWebViewScrollPin';
import { EmailVerifyBanner } from '@/components/EmailVerifyBanner';
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
  // Default explícito: páginas são indexáveis. Páginas autenticadas
  // (chat, perfil próprio, dashboards, admin) sobrescrevem com
  // `robots: { index: false }` no próprio page.tsx. Obs.: preview deploys
  // (*.pages.dev) ganham `X-Robots-Tag: noindex` do Cloudflare Pages —
  // isso é infra, não vem daqui, e não afeta queroumacor.com.br.
  robots: { index: true, follow: true },
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
  // `viewport-fit: cover` (2026-08-29). O app inteiro já reserva espaço com
  // `env(safe-area-inset-*)` — TopNav, BottomNav, AppShell, bottom sheets,
  // toasts. Só que no Android esses valores voltam ZERO enquanto a página
  // não declara `cover`: a reserva existia no código e não valia nada.
  //
  // Isso deixou de ser detalhe: a partir do targetSdk 35 (Android 15) o
  // sistema desenha o app DE BORDA A BORDA por padrão — a WebView passa por
  // baixo da barra de status e da barra de navegação. Sem `cover`, o
  // cabeçalho fica embaixo do relógio e a barra de baixo embaixo dos botões
  // do sistema. Com `cover`, os `env()` que já estão no código passam a
  // devolver a medida real e cada barra se afasta sozinha.
  //
  // No iPhone o efeito é o mesmo que o `black-translucent` do PWA já pedia,
  // agora consistente entre os dois sistemas.
  viewportFit: 'cover',
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
        {/* Tema: claro por padrão, escuro opcional (opt-in pelo usuário via
            ThemeToggle). Lê localStorage.theme antes do paint pra evitar flash.
            Só ativa dark se a preferência salva for explicitamente 'dark' —
            não seguimos prefers-color-scheme pra manter o claro como default. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`,
          }}
        />
        {/* REGRA DO QUEROUMACOR (2026-08-28): todo horário exibido é o de
            BRASÍLIA (America/Sao_Paulo), independente do fuso do aparelho.
            Patch na raiz: injeta timeZone default em toLocale{Date,Time,}String
            de Date — cobre todas as telas atuais e futuras sem editar cada
            chamada. Quem passar timeZone explícito continua mandando. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var TZ='America/Sao_Paulo';['toLocaleDateString','toLocaleTimeString','toLocaleString'].forEach(function(fn){var orig=Date.prototype[fn];Date.prototype[fn]=function(loc,opts){return orig.call(this,loc||'pt-BR',Object.assign({timeZone:TZ},opts||{}));};});}catch(e){}})();`,
          }}
        />
        {/* Pin pré-hidratação do Android (camada 1 da trava do
            pull-to-refresh nativo — ver useAndroidWebViewScrollPin.ts).
            Sem isso, do primeiro byte até o React hidratar o documento fica
            em scrollY 0 e o SwipeRefreshLayout do wrapper segue armado
            justamente durante o boot. Roda no <head>: estica o <html> (que
            já existe) e prende o scroll assim que possível, com re-pin no
            DOMContentLoaded/load. Espelha a detecção e as constantes do
            hook (qualquer Android; 4px de folga em dvh com fallback vh;
            pin em 2) — mudou lá, mudar aqui. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(!/Android/i.test(navigator.userAgent||''))return;var s=document.documentElement.style;s.minHeight='calc(100vh + 4px)';s.minHeight='calc(100dvh + 4px)';var pin=function(){if(window.scrollY<2)window.scrollTo(0,2);};pin();document.addEventListener('DOMContentLoaded',pin);window.addEventListener('load',pin);}catch(e){}})();`,
          }}
        />
        {/* Eruda: console de DevTools mobile pra depurar a WebView da casca.
            SÓ com `NEXT_PUBLIC_ERUDA=1` no build (preview/staging): em
            produção isso injetava um script de CDN SEM versão fixada dentro
            do app das lojas, com acesso ao localStorage onde mora a sessão
            — supply chain + console aberto pra quem tiver o aparelho na mão
            (auditoria de autenticação, 2026-09-11). A CSP já libera o
            jsdelivr, então a única trava era esta. */}
        {process.env.NEXT_PUBLIC_ERUDA === '1' ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){function loadEruda(){if(window.__erudaLoaded)return;window.__erudaLoaded=true;var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/eruda@3';s.onload=function(){window.eruda&&window.eruda.init();};document.body.appendChild(s);}function check(){if(window.Capacitor){loadEruda();}}check();document.addEventListener('DOMContentLoaded',check);window.addEventListener('load',check);setTimeout(check,1000);})();`,
            }}
          />
        ) : null}
      </head>
      <body>
        {/* AuthProvider envolve toda a árvore — substitui o `currentUser` global
            do vanilla por React Context. useAuth() é o consumer de qualquer
            client component que precise de session/user.
            QueryProvider fica DENTRO do AuthProvider pra que hooks que
            consomem ambos (useNotifications etc.) tenham acesso ao user no
            queryKey/enabled sem ordem de inicialização ambígua. */}
        <ServiceWorkerRegister />
        {/* Trava do pull-to-refresh nativo do wrapper Android (WebIntoApp):
            prende o documento em scrollY=1 pra que o SwipeRefreshLayout
            nunca arme o reload. No-op fora do WebView Android. */}
        <AndroidWebViewScrollPin />
        <AuthProvider>
          <QueryProvider>
            <DialogProvider>
              <AuthGateProvider>
                <StagingBanner />
                <EmailVerifyBanner />
                {/* Suspense exigido por useSearchParams() em ReferralCapture
                    quando renderiza em rotas dinâmicas. */}
                <Suspense fallback={null}>
                  <ReferralCapture />
                </Suspense>
                {children}
                <ToastViewport />
              </AuthGateProvider>
            </DialogProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
