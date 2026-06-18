// AvaliarView — lista quotes elegíveis pra review + form de star/criteria/comment.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { listReviewableQuotes, submitReview, type ReviewableQuote } from '@/lib/services/reviews';
import { Avatar } from '@/components/Avatar';
import { showToast } from '@/lib/toast';

const STAR_LABELS = ['', 'Ruim 😞', 'Regular 😐', 'Bom 🙂', 'Muito bom 😄', 'Excelente! 🤩'];
const CRITERIA = [
  'Pontualidade',
  'Acabamento',
  'Educação',
  'Limpeza',
  'Preço justo',
  'Cumprimento prazo',
];

export function AvaliarView() {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const userId = user?.id ?? '';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stars, setStars] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [criteriaSet, setCriteriaSet] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');

  const { data: quotes = [], isLoading, error } = useQuery<ReviewableQuote[], Error>({
    queryKey: ['reviewable-quotes', userId],
    queryFn: () => listReviewableQuotes(userId),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const selected = selectedId
    ? quotes.find((q) => q.id === selectedId) ?? null
    : quotes[0] ?? null;

  const submitMut = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!selected) throw new Error('Selecione um serviço');
      if (!stars) throw new Error('Escolha uma nota');
      await submitReview({
        quoteId: selected.id,
        rating: stars as 1 | 2 | 3 | 4 | 5,
        comment: comment.trim() || null,
        criteria: Array.from(criteriaSet),
      });
    },
    onSuccess: () => {
      showToast(`Avaliação enviada! ${STAR_LABELS[stars]}`, 'success');
      qc.invalidateQueries({ queryKey: ['reviewable-quotes', userId] });
      setTimeout(() => router.push('/perfil'), 1200);
    },
    onError: (err) => {
      showToast(err.message || 'Erro ao enviar.', 'error');
    },
  });

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <p className="text-sm text-[color:var(--color-muted)]">Faça login pra avaliar.</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-sm text-[color:var(--color-muted)]">Carregando…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-600">Erro: {error.message}</div>;
  }

  if (quotes.length === 0 || !selected) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">⭐</div>
        <h2 className="font-semibold mb-2">Nenhum serviço para avaliar</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          Quando um orçamento for concluído, você poderá avaliar aqui.
        </p>
      </div>
    );
  }

  function toggleCriteria(c: string) {
    setCriteriaSet((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  return (
    <>
      {/* Picker quando há +1 quote */}
      {quotes.length > 1 ? (
        <div className="mb-4">
          <div className="text-xs font-bold text-[color:var(--color-muted)] uppercase mb-2">
            Selecione o serviço
          </div>
          <ul className="space-y-2">
            {quotes.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(q.id)}
                  className="w-full text-left p-3 rounded-xl border text-sm"
                  style={{
                    background: q.id === selected.id ? 'var(--color-cream)' : 'var(--color-white)',
                    borderColor: q.id === selected.id ? 'var(--color-p1)' : 'var(--color-border)',
                  }}
                >
                  <b>{q.painter?.name ?? 'Pintor'}</b> — {q.service_type || q.title || 'Serviço'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Card do pintor selecionado */}
      <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[color:var(--color-border)] mb-4">
        <Avatar profile={{
          id: selected.painter?.id ?? '',
          name: selected.painter?.name ?? null,
          tag: null,
          avatar_url: selected.painter?.avatar_url ?? null,
        }} size={56} />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-[color:var(--color-ink)]">
            {selected.painter?.name ?? 'Pintor'}
          </div>
          <div className="text-xs text-[color:var(--color-muted)]">
            {[
              selected.service_type || selected.title,
              selected.painter?.city,
              selected.area_m2 ? `${selected.area_m2}m²` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>

      {/* Stars */}
      <div className="bg-white border border-[color:var(--color-border)] rounded-xl p-4 mb-4 text-center">
        <div className="flex justify-center gap-2 mb-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n as 1 | 2 | 3 | 4 | 5)}
              aria-label={`${n} estrelas`}
              className="text-3xl transition-transform"
              style={{
                opacity: n <= stars ? 1 : 0.3,
                transform: n <= stars ? 'scale(1.15)' : 'scale(1)',
              }}
            >
              ⭐
            </button>
          ))}
        </div>
        <div
          className="text-sm font-semibold"
          style={{
            color: stars >= 4 ? 'var(--color-p3)' : stars >= 3 ? 'var(--color-p2)' : stars > 0 ? 'var(--color-p4)' : 'var(--color-muted)',
          }}
        >
          {stars > 0 ? STAR_LABELS[stars] : 'Toque numa estrela'}
        </div>
      </div>

      {/* Criteria chips */}
      <div className="bg-white border border-[color:var(--color-border)] rounded-xl p-4 mb-4">
        <div className="text-xs font-bold text-[color:var(--color-muted)] uppercase mb-3">
          O que se destacou
        </div>
        <div className="flex flex-wrap gap-2">
          {CRITERIA.map((c) => {
            const sel = criteriaSet.has(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCriteria(c)}
                className="px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors"
                style={{
                  background: sel ? 'var(--color-p1)' : 'var(--color-white)',
                  color: sel ? '#fff' : 'var(--color-ink)',
                  borderColor: sel ? 'var(--color-p1)' : 'var(--color-border)',
                }}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {/* Comment */}
      <div className="bg-white border border-[color:var(--color-border)] rounded-xl p-4 mb-4">
        <label
          htmlFor="avaliar-comment"
          className="text-xs font-bold text-[color:var(--color-muted)] uppercase block mb-2"
        >
          Comentário (opcional)
        </label>
        <textarea
          id="avaliar-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Conte como foi sua experiência…"
          rows={4}
          maxLength={500}
          className="w-full px-3 py-2 text-sm rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-white)] text-[color:var(--color-ink)] resize-y"
        />
      </div>

      {/* Aviso anti-fraude */}
      <p className="text-xs text-[color:var(--color-muted)] mb-4 leading-relaxed">
        Ao avaliar, você confirma que a experiência é real e baseada neste
        serviço. Avaliações falsas ou combinadas serão removidas.{' '}
        <Link
          href="/info/antifraude"
          className="underline hover:opacity-80"
          style={{ color: 'var(--color-p1)' }}
        >
          Política Anti-Fraude
        </Link>
        .
      </p>

      {/* Submit */}
      <button
        type="button"
        onClick={() => submitMut.mutate()}
        disabled={!stars || submitMut.isPending}
        className="w-full px-4 py-3 text-base font-bold bg-[color:var(--color-p1)] text-white rounded-xl disabled:opacity-60"
      >
        {submitMut.isPending ? 'Enviando…' : 'Enviar avaliação'}
      </button>
    </>
  );
}
