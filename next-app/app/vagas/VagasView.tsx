'use client';

// Vagas pra pintor: a equipe da loja acha a vaga fora do app, confere e
// publica pelo portal. Aqui o profissional lê e chama o contato DO ANÚNCIO —
// o QueroUmaCor não é o contratante, e a tela diz isso.

import { useQuery } from '@tanstack/react-query';
import { fetchVagasAtivas } from '@/lib/services/vagas';
import { dataDoAnuncio, fonteSegura, linkDoContato, localDaVaga, rotuloDoRegime, type Vaga } from '@/lib/vagas';
import { abrirLinkExterno } from '@/lib/native/browser';
import { useRouter } from 'next/navigation';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { situacaoDoPlano } from '@/lib/billingBalance';
import { useBillingBalance } from '@/lib/hooks/useBillingBalance';

function CartaoDaVaga({ vaga }: { vaga: Vaga }) {
  const local = localDaVaga(vaga);
  const link = linkDoContato(vaga);
  const fonte = fonteSegura(vaga.fonte_url);
  const data = dataDoAnuncio(vaga.anuncio_em);
  const regime = rotuloDoRegime(vaga.regime);
  const conferida = dataDoAnuncio(vaga.conferido_em);
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
      {(vaga.remuneracao || regime) && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {regime && (
            <span className="rounded-md bg-[color:var(--color-ink-fixed)] text-[color:var(--color-white-fixed)] px-2 py-1 text-xs font-bold">
              {regime}
            </span>
          )}
          {vaga.remuneracao && (
            <span className="rounded-md bg-[color:var(--color-bg)] px-2 py-1 text-xs font-bold">
              {vaga.remuneracao}
            </span>
          )}
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
        {[data ? `Anúncio de ${data}` : null, conferida ? `Conferida em ${conferida}` : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </article>
  );
}

export function VagasView() {
  // Vagas é recurso do PRO (decisão de 10/11/2026). A tela só esconde; quem
  // barra de verdade é a RLS (migration 2026-11-10-e), então nem buscamos.
  // A MESMA pergunta do selo do topo (`situacaoDoPlano`): conta da equipe e
  // assinatura da loja moram no saldo, não só no perfil — perguntando só ao
  // perfil, quem tinha o selo ADMIN via o bloqueio aqui (print de 11/11).
  const policyUser = usePolicyUser();
  const saldo = useBillingBalance();
  const isPro = situacaoDoPlano(policyUser, saldo.data ?? null).plano !== 'gratis';
  const router = useRouter();
  const q = useQuery<Vaga[], Error>({
    queryKey: ['vagas-ativas'],
    queryFn: fetchVagasAtivas,
    staleTime: 5 * 60 * 1000,
    enabled: isPro,
  });
  const vagas = q.data ?? [];

  // Saldo ainda carregando: não dá pra afirmar "você não é PRO".
  if (!isPro && saldo.isLoading) {
    return <p className="text-sm text-[color:var(--color-muted)] p-4">Carregando…</p>;
  }
  if (!isPro) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          💼 Vagas para pintor
        </h2>
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-white)] p-5 text-center">
          <p className="text-3xl" aria-hidden>🔒</p>
          <p className="font-bold mt-2">As vagas são exclusivas do Plano PRO</p>
          <p className="text-sm text-[color:var(--color-muted)] mt-1 leading-relaxed">
            Vagas de trabalho na região, encontradas e conferidas pela Cali Colors.
          </p>
          <button
            type="button"
            onClick={() => router.push('/pro')}
            className="mt-4 rounded-xl bg-[color:var(--color-p1-button)] text-[color:var(--color-white-fixed)] font-bold text-sm px-5 py-3"
          >
            Conhecer o PRO
          </button>
        </div>
      </section>
    );
  }

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
