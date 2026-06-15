'use client';
// AuthGate — modo visitante. Deixa o cliente navegar sem login, mas QUALQUER
// interação (curtir, comentar, seguir, salvar, publicar, comprar, mandar
// mensagem, orçar) passa por `requireAuth(label)`: se logado, segue; se
// visitante, abre um bottom-sheet "Crie sua conta" com Cadastrar/Entrar.
//
// Uso no componente:
//   const { requireAuth } = useAuthGate();
//   onClick={() => { if (!requireAuth('curtir')) return; toggleLike(); }}

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { BottomSheet } from '@/components/BottomSheet';

interface AuthGateContextValue {
  /** True se logado (a ação segue). Se visitante, abre o prompt e retorna false. */
  requireAuth: (actionLabel?: string) => boolean;
  /** True quando NÃO há sessão (pra UI mostrar CTA de login etc.). */
  isGuest: boolean;
}

const Ctx = createContext<AuthGateContextValue | null>(null);

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<string | null>(null);

  const requireAuth = useCallback(
    (actionLabel?: string): boolean => {
      if (user) return true;
      setAction(actionLabel ?? null);
      setOpen(true);
      return false;
    },
    [user],
  );

  // Preserva onde o visitante estava pra voltar depois do cadastro/login.
  const nextParam = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
  const go = (path: string) => {
    setOpen(false);
    router.push(`${path}${nextParam}`);
  };

  return (
    <Ctx.Provider value={{ requireAuth, isGuest: !user && !loading }}>
      {children}
      <BottomSheet open={open} onClose={() => setOpen(false)} ariaLabel="Criar conta">
        <div className="text-center" style={{ padding: '4px 4px 10px' }}>
          <div style={{ fontSize: 44 }} aria-hidden="true">👋</div>
          <h2
            className="font-extrabold"
            style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginTop: 6, color: 'var(--color-ink)' }}
          >
            Crie sua conta {action ? `pra ${action}` : ''}
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-muted)', marginTop: 6, lineHeight: 1.5 }}>
            É grátis. Você pode ver tudo sem conta, mas pra interagir precisa de um
            cadastro rapidinho.
          </p>
          <button
            type="button"
            onClick={() => go('/signup')}
            className="w-full text-white font-extrabold"
            style={{ marginTop: 16, padding: 13, borderRadius: 12, background: 'var(--color-p1)', border: 'none', fontSize: 15, cursor: 'pointer' }}
          >
            Cadastrar grátis
          </button>
          <button
            type="button"
            onClick={() => go('/login')}
            className="w-full font-bold"
            style={{ marginTop: 8, padding: 12, borderRadius: 12, background: '#fff', color: 'var(--color-ink)', border: '1.5px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}
          >
            Já tenho conta · Entrar
          </button>
        </div>
      </BottomSheet>
    </Ctx.Provider>
  );
}

export function useAuthGate(): AuthGateContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback defensivo: sem provider (ex.: teste isolado), trata como logado
    // pra não quebrar — o gate real só vale com o provider montado no layout.
    return { requireAuth: () => true, isGuest: false };
  }
  return ctx;
}
