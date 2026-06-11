// /delete-account — URL pública pra exclusão de conta (Google Play Policy
// 2023). Atende usuários que desinstalaram o app e querem solicitar a
// exclusão dos dados sem reinstalar.
//
// Fluxo:
//   - Se logado: renderiza o card DeleteAccountSection direto (mesma UI de
//     /info), elimina sem fricção adicional.
//   - Se deslogado: explica o procedimento + CTA pra login (retornando
//     pra cá após autenticar) ou WhatsApp pro suporte (canal alternativo
//     LGPD).
//
// Endpoint backend já existe (`/api/delete-account`) e é idempotente. A
// página é client-component pra ler estado de auth em runtime.

'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { DeleteAccountSection } from '@/app/info/DeleteAccountSection';

const SUPPORT_PHONE = '5511959765031';
const waHref =
  `https://wa.me/${SUPPORT_PHONE}?text=` +
  encodeURIComponent(
    'Olá! Quero solicitar a exclusão da minha conta no QueroUmaCor (LGPD).',
  );

export default function DeleteAccountPage() {
  const { user, loading } = useAuth();

  return (
    <main className="max-w-md mx-auto px-4 py-8 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Excluir minha conta
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] leading-relaxed">
          Atende ao direito de exclusão da LGPD (Art. 18 VI) e à política
          de exclusão de conta do Google Play e Apple App Store.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-[color:var(--color-muted)]">Carregando…</p>
      ) : user ? (
        <DeleteAccountSection />
      ) : (
        <article className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <p className="text-sm text-[color:var(--color-ink)] leading-relaxed">
            Para excluir a conta, é necessário fazer login primeiro (pra
            garantir que só o dono solicite a exclusão). Depois de entrar,
            você volta pra esta página e o botão de excluir fica disponível.
          </p>
          <p className="text-sm text-[color:var(--color-muted)] leading-relaxed">
            Se você não consegue mais acessar a conta (perdeu o email ou a
            senha), fale com a equipe de suporte pelo WhatsApp abaixo. Vamos
            confirmar sua identidade e fazer a exclusão manualmente.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/login?next=${encodeURIComponent('/delete-account')}`}
              className="px-4 py-2 text-sm font-semibold rounded-lg text-white"
              style={{ background: 'var(--color-p1)' }}
            >
              Fazer login pra excluir
            </Link>
            <Link
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-[color:var(--color-border)] text-[color:var(--color-ink)]"
            >
              Falar com suporte
            </Link>
          </div>
        </article>
      )}

      <p className="text-xs text-[color:var(--color-muted)] leading-relaxed pt-2">
        Dados anonimizados imediatamente. Arquivos (fotos, vídeos, anotações)
        entram em fila e somem em até 30 dias. Após a exclusão você não
        consegue mais entrar com essa conta — pra usar o app de novo, crie
        outra.
      </p>
    </main>
  );
}
