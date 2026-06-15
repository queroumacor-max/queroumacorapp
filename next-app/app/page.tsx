'use client';
// HomePage — redireciona direto pro /feed (logado OU visitante). Modo
// visitante: o cliente navega feed/loja/perfis sem login; pra interagir, o
// AuthGate abre o cadastro. Antes deslogado caía em /login (gate forçado).

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function HomePage() {
  const router = useRouter();
  const { loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace('/feed');
  }, [loading, router]);

  // Placeholder discreto enquanto auth resolve + redirect dispara
  // (50-200ms na primeira visita).
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-[color:var(--color-muted)] text-sm">Carregando...</div>
    </main>
  );
}
