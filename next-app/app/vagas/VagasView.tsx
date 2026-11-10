'use client';

// Vagas pra pintor: a equipe da loja acha a vaga fora do app, confere e
// publica pelo portal. Aqui o profissional lê e chama o contato DO ANÚNCIO —
// o QueroUmaCor não é o contratante, e a tela diz isso.

import { useQuery } from '@tanstack/react-query';
import { fetchVagasAtivas } from '@/lib/services/vagas';
import { dataDoAnuncio, fonteSegura, linkDoContato, localDaVaga, type Vaga } from '@/lib/vagas';
import { abrirLinkExterno } from '@/lib/native/browser';

function CartaoDaVaga({ vaga }: { vaga: Vaga }) {
  const local = localDaVaga(vaga);
  const link = linkDoContato(vaga);
  const fonte = fonteSegura(vaga.fonte_url);
  const data = dataDoAnuncio(vaga.anuncio_em);
  return (
    <article className="rounded-2xl bg-[color:var(--color-white)] border border-[color:var(--color-border)] p-4">
      <h3 className="font-bold text-base leading-snug" style={{ overflowWrap: 'anywhere' }}>
        {vaga.titulo}
      </h3>
      {(vaga.empresa || local) && (
        <p className="text-xs text-[color:var(--color-muted)] mt-1">
          {[vaga.empresa, local].filter(Boolean).join(' · ')}
        </p>
      )}
      {vaga.remuneracao && (
        <p className="mt-2 inline-block rounded-md bg-[color:var(--color-bg)] px-2 py-1 text-xs font-bold">
          {vaga.remuneracao}
        </p>
      )}
      {vaga.descricao && (
        <p className="text-sm mt-2 leading-relaxed" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {vaga.descricao}
        </p>
      )}
      {vaga.contato_obs && (
        <p className="text-xs text-[color:var(--color-muted)] mt-2">{vaga.contato_obs}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {link ? (
          <button
            type="button"
            onClick={() => abrirLinkExterno(link)}
            className="rounded-xl bg-[color:var(--color-p1-button)] text-[color:var(--color-white-fixed)] font-bold text-sm px-4 py-2.5"
          >
            {vaga.contato_whatsapp ? 'Chamar no WhatsApp' : 'Ligar'}
          </button>
        ) : (
          vaga.contato && <span className="text-sm font-semibold">Contato: {vaga.contato}</span>
        )}
        {fonte && (
          <button
            type="button"
            onClick={() => abrirLinkExterno(fonte)}
            className="rounded-xl border border-[color:var(--color-border)] text-sm font-semibold px-3 py-2.5"
          >
            Ver anúncio
          </button>
        )}
      </div>
      <p className="text-[11px] text-[color:var(--color-muted)] mt-2">
        {[data ? `Anúncio de ${data}` : null, vaga.fonte ? `Fonte: ${vaga.fonte}` : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </article>
  );
}

export function VagasView() {
  const q = useQuery<Vaga[], Error>({
    queryKey: ['vagas-ativas'],
    queryFn: fetchVagasAtivas,
    staleTime: 5 * 60 * 1000,
  });
  const vagas = q.data ?? [];

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          💼 Vagas para pintor
        </h2>
        <p className="text-xs text-[color:var(--color-muted)] mt-1 leading-relaxed">
          Vagas de outras empresas que a Cali Colors encontrou e conferiu. A contratação é direto
          com quem anunciou: confirme os dados antes de ir.
        </p>
      </header>
      {q.isLoading && <p className="text-sm text-[color:var(--color-muted)]">Carregando vagas…</p>}
      {q.error && (
        <div className="rounded-xl border border-[color:var(--color-border)] p-3 text-sm">
          Não consegui carregar as vagas.{' '}
          <button type="button" className="underline font-semibold" onClick={() => q.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}
      {!q.isLoading && !q.error && vagas.length === 0 && (
        <p className="rounded-xl border border-dashed border-[color:var(--color-border)] p-4 text-sm text-[color:var(--color-muted)] text-center">
          Nenhuma vaga aberta agora. Quando a loja publicar uma, ela aparece aqui.
        </p>
      )}
      {vagas.map((v) => (
        <CartaoDaVaga key={v.id} vaga={v} />
      ))}
    </section>
  );
}
