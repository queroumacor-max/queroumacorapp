'use client';
// HomePage — porta de entrada. Acesso sem conta foi REMOVIDO: logado vai pro
// /feed; deslogado vai pro /login. (Antes mandava todo mundo pro /feed em
// modo visitante.)

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/feed' : '/login');
  }, [loading, user, router]);

  // Placeholder discreto enquanto auth resolve + redirect dispara
  // (50-200ms na primeira visita).
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-[color:var(--color-muted)] text-sm">Carregando...</div>
    </main>
  );
}
