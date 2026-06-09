// ProfileFooter — botão "Sair da conta" isolado no fim da página /perfil.
// Vanilla mostra esse botão como elemento standalone (não dentro de card)
// em laranja/vermelho com border. Replica.
'use client';

import { useAuth } from '@/components/AuthProvider';
import { useDialog } from '@/components/Dialog';
import { ThemeToggle } from '@/components/ThemeToggle';

export function ProfileFooter() {
  const { signOut } = useAuth();
  const dialog = useDialog();

  async function handleLogout() {
    const ok = await dialog.confirm('Deseja sair da conta?', {
      title: 'Sair',
      okLabel: 'Sair',
      danger: true,
    });
    if (!ok) return;
    await signOut();
    window.location.href = '/login';
  }

  return (
    <div className="px-3.5 pt-5 pb-8 space-y-3">
      <ThemeToggle withLabel />
      <button
        type="button"
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-bold text-[color:var(--color-danger)]"
        style={{
          background: 'rgba(230,57,70,.05)',
          border: '1.5px solid rgba(230,57,70,.25)',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Sair da conta
      </button>
    </div>
  );
}
