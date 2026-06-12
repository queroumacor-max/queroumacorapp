// env-check.ts — validação de envs críticas no boot.
//
// Throw cedo em prod se faltar coisa essencial; em dev só warn. Importado
// pelo topo de `lib/api/security.ts` pra rodar uma vez por cold-start no
// edge runtime — se uma env crítica sumiu (ex.: rotation de
// SUPABASE_SERVICE_ROLE_KEY que não bateu em todos os envs do CF Pages),
// o edge sobe quebrado e o request inteiro 503-a, em vez de silenciosamente
// fail-open (que era o comportamento antigo do `requirePro`/`gateAiUsage`).
//
// Lista mínima: o que precisa pra autenticar + validar PRO server-side.
// `SUPABASE_URL` + `SUPABASE_ANON_KEY` cobrem auth (validar JWT), e
// `SUPABASE_SERVICE_ROLE_KEY` cobre as checagens admin (profiles.is_pro,
// ai_usage etc.). Sem essas três, a API fica parcialmente quebrada — e o
// pior caso (sem service key) era libera-tudo silenciosamente.
//
// Edge runtime não tem process.exit; throw é a única opção. O Next vai
// capturar e devolver 500 — preferível ao "fail-open por env ausente".

const REQUIRED_IN_PROD = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export function assertProductionEnvs(opts: { force?: boolean } = {}): void {
  if (process.env.NODE_ENV !== 'production') return;
  // Skip silencioso quando importado durante vitest (`security.ts` chama
  // `assertProductionEnvs()` no module-load; outros tests setam
  // NODE_ENV='production' pra exercitar caminhos fail-closed e seriam
  // obrigados a mockar TODAS as envs prod só por causa desse assert).
  // Tests que querem exercitar o assert chamam com `{ force: true }`.
  if (!opts.force && (process.env.VITEST === 'true' || process.env.VITEST_WORKER_ID)) {
    return;
  }
  const missing = REQUIRED_IN_PROD.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    // Edge runtime não tem process.exit; throw é a única opção.
    throw new Error(
      `[env-check] Variáveis obrigatórias ausentes em produção: ${missing.join(', ')}`,
    );
  }
}
