import type { Metadata } from 'next';
import { AuthProvider } from '@/components/AuthProvider';
import { QueryProvider } from '@/components/QueryProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'QueroUmaCor',
  description: 'A plataforma dos pintores profissionais',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        {/* AuthProvider envolve toda a árvore — substitui o `currentUser` global
            do vanilla por React Context. useAuth() é o consumer de qualquer
            client component que precise de session/user.
            QueryProvider fica DENTRO do AuthProvider pra que hooks que
            consomem ambos (useNotifications etc.) tenham acesso ao user no
            queryKey/enabled sem ordem de inicialização ambígua. */}
        <AuthProvider>
          <QueryProvider>{children}</QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
