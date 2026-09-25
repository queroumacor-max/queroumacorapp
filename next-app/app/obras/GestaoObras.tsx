// Gestão de Obras — tile do pintor em Meu Negócio (e rota /obras, onde
// caem os avisos de convite/escala pro funcionário). Protótipo aprovado:
// https://claude.ai/artifact/XoADjescHo2T7Ww8ULs6fU
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { meusConvites } from '@/lib/services/obras';
import { EquipeTab } from './EquipeTab';
import { EscalaTab } from './EscalaTab';
import { MeuProgresso } from './MeuProgresso';
import { MinhaAgenda } from './MinhaAgenda';
import { ObrasTab } from './ObrasTab';

export type AbaObras = 'obras' | 'equipe' | 'escala' | 'agenda' | 'cliente';

const ABAS: ReadonlyArray<{ id: AbaObras; rotulo: string }> = [
  { id: 'obras', rotulo: 'Obras' },
  { id: 'equipe', rotulo: 'Equipe' },
  { id: 'escala', rotulo: 'Escala' },
  { id: 'agenda', rotulo: 'Minha agenda' },
  { id: 'cliente', rotulo: 'Meu progresso' },
];

export function GestaoObras({ abaInicial = 'obras' }: { abaInicial?: AbaObras }) {
  const { user } = useAuth();
  const uid = user?.id ?? '';
  const [aba, setAba] = useState<AbaObras>(abaInicial);
  const convites = useQuery({ queryKey: ['obra-convites', uid], queryFn: meusConvites, enabled: !!uid, retry: false });
  const pendentes = convites.data?.length ?? 0;

  if (!uid) {
    return <p className="text-sm text-[color:var(--color-muted)] p-4">Entre na sua conta pra usar a Gestão de Obras.</p>;
  }

  return (
    <div className="px-1 pt-2 pb-6 flex flex-col gap-4">
      <h2 className="font-extrabold text-2xl" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
        🏗️ Gestão de Obras
      </h2>
      <div
        role="tablist"
        aria-label="Seções"
        className="flex gap-1 p-1 rounded-xl bg-[color:var(--color-cream)] overflow-x-auto"
      >
        {ABAS.map((a) => {
          const on = aba === a.id;
          return (
            <button
              key={a.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => setAba(a.id)}
              className={`shrink-0 rounded-lg text-xs font-bold px-3 whitespace-nowrap ${on ? 'bg-[color:var(--color-ink)] text-[color:var(--color-white)]' : 'text-[color:var(--color-ink)]'}`}
              style={{ minHeight: 44 }}
            >
              {a.rotulo}
              {a.id === 'agenda' && pendentes ? ` (${pendentes})` : ''}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">
        {aba === 'obras' ? <ObrasTab uid={uid} /> : null}
        {aba === 'equipe' ? <EquipeTab uid={uid} /> : null}
        {aba === 'escala' ? <EscalaTab uid={uid} /> : null}
        {aba === 'agenda' ? <MinhaAgenda uid={uid} /> : null}
        {aba === 'cliente' ? <MeuProgresso uid={uid} /> : null}
      </div>
    </div>
  );
}
