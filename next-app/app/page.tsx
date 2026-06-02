'use client';
// HomePage — redireciona direto: autenticado → /feed, deslogado → /login.
// Sem landing page intermediária e sem onboarding modal (UX que o user
// pediu — entrar no app já cai no login se não tem sessão).

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/feed' : '/login');
  }, [user, loading, router]);

  // Placeholder discreto enquanto auth resolve + redirect dispara
  // (50-200ms na primeira visita).
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-[color:var(--color-muted)] text-sm">Carregando...</div>
    </main>
  );
}
