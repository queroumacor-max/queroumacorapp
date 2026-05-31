// AnalysisCard — card "Análise IA" pra disparar o /api/fin-analysis (PRO).
// Espelha o bloco "Análise do mês com Seu Zé" do vanilla
// (modules/financeiro.js: analisarFinanceiroIA, linhas 122-177), mas como
// componente declarativo:
//   - Gate visual: canSeeProFeature(user) → admin/PRO veem o botão; resto
//     vê CTA pra upgrade. O gate real (banco/rate limit) acontece no
//     backend via gateProAI — mesmo que alguém burlar o gate visual, o
//     servidor recusa.
//   - hasEntries=false desativa o botão com explicação ("sem dados pra
//     analisar") — evita request inútil que retorna análise vazia.
//   - Estado de loading mostra spinner inline, sucesso mostra texto em card
//     destacado com gradient roxo (mesma identidade visual do vanilla,
//     linhas 166-171).
//   - error mostra mensagem do backend (PRO-gate, rate limit, IA off) sem
//     vazar stack pra UI.

'use client';

import type { User } from '@supabase/supabase-js';
import { canSeeProFeature, type PolicyUser } from '@/lib/policies';
import type { AIAnalysisResult } from '@/lib/services/financeiro';

interface AnalysisCardProps {
  user: User | null;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  analysis: AIAnalysisResult | null;
  error: Error | null;
  onReset: () => void;
  hasEntries: boolean;
}

// User do Supabase carrega is_pro/is_admin no `user_metadata` em alguns
// fluxos. Pra alimentar canSeeProFeature (que espera PolicyUser shape),
// extraímos os flags relevantes. Defensivo: se `user_metadata` é qualquer
// coisa que não objeto, tratamos como vazio.
function userToPolicy(user: User | null): PolicyUser | null {
  if (!user) return null;
  const meta =
    user.user_metadata && typeof user.user_metadata === 'object'
      ? (user.user_metadata as Record<string, unknown>)
      : {};
  return {
    id: user.id,
    is_pro: meta.is_pro === true ? true : meta.is_pro === false ? false : null,
    is_admin:
      meta.is_admin === true ? true : meta.is_admin === false ? false : null,
    role: typeof meta.role === 'string' ? meta.role : null,
  };
}

export function AnalysisCard({
  user,
  onAnalyze,
  isAnalyzing,
  analysis,
  error,
  onReset,
  hasEntries,
}: AnalysisCardProps) {
  const isPro = canSeeProFeature(userToPolicy(user));

  return (
    <div className="bg-white rounded-xl border border-[color:var(--color-border)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg" aria-hidden="true">
          🤖
        </span>
        <span
          className="text-[11px] font-extrabold uppercase tracking-wider"
          style={{
            background: 'linear-gradient(135deg,#8338ec,var(--color-p1))',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: '#8338ec',
          }}
        >
          Análise do mês com Seu Zé · PRO
        </span>
      </div>

      {!isPro ? (
        <div className="text-sm text-[color:var(--color-muted)]">
          Pintor PRO recebe análise personalizada do mês com sugestões pra
          melhorar lucro. Faça upgrade pra liberar.
        </div>
      ) : (
        <>
          {analysis ? (
            // Resultado: texto da IA + botão pra rodar de novo. Mantém o
            // resultado visível mesmo se o usuário scroll — useMutation
            // guarda `data` até `reset()` ou nova chamada.
            <div className="space-y-3">
              <div className="text-sm leading-relaxed text-[color:var(--color-ink)] whitespace-pre-wrap">
                {analysis.analysis}
              </div>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  onAnalyze();
                }}
                disabled={isAnalyzing}
                className="text-xs font-semibold text-[color:var(--color-p1)] disabled:opacity-50"
              >
                Analisar de novo
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[color:var(--color-muted)]">
                {hasEntries
                  ? 'Compara seu mês atual com o anterior e sugere ações pra aumentar lucro.'
                  : 'Adicione alguns lançamentos antes pra ter dados pra analisar.'}
              </p>
              <button
                type="button"
                onClick={onAnalyze}
                disabled={isAnalyzing || !hasEntries}
                className="px-4 py-2 bg-gradient-to-br from-[#8338ec] to-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold disabled:opacity-60"
              >
                {isAnalyzing ? 'Analisando...' : 'Analisar com Seu Zé'}
              </button>
            </div>
          )}

          {error ? (
            <div
              role="alert"
              className="mt-3 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
            >
              {error.message || 'Erro ao analisar.'}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
