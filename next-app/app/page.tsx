'use client';
// HomePage — landing pública pra visitantes não-autenticados.
// Usuário com sessão é redirecionado automaticamente pra /feed (replica
// o comportamento do vanilla, que mostrava o feed direto após initAuth).

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // Redireciona usuários autenticados pro feed. Aguarda `loading=false` pra
  // não disparar redirect antes do AuthProvider hidratar a sessão.
  useEffect(() => {
    if (!loading && user) router.replace('/feed');
  }, [user, loading, router]);

  // Enquanto auth resolve (~50-200ms na primeira visita), mostra placeholder
  // mínimo. Sem skeleton elaborado pra não criar flash desnecessário.
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-[color:var(--color-muted)] text-sm">Carregando...</div>
      </main>
    );
  }

  // Não-autenticado: landing pública.
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
        QueroUmaCor
      </h1>
      <p className="text-lg mb-8 text-center max-w-md">
        A plataforma dos pintores profissionais e quem precisa de um serviço de qualidade.
      </p>
      <nav className="flex gap-4">
        <Link href="/login" className="px-6 py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold">
          Login
        </Link>
        <Link href="/info" className="px-6 py-3 border border-[color:var(--color-border)] rounded-xl font-semibold">
          Sobre
        </Link>
      </nav>
    </main>
  );
}
