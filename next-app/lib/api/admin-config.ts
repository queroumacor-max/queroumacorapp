// admin-config.ts — cache de `ADMIN_EMAILS` lido uma vez por cold-start.
//
// Motivação (R-H6 do REMEDIATION_PLAN):
//   - `security.ts` parseava `ADMIN_EMAILS` a cada chamada de `isAdminEmail`,
//     o que é desperdício (rota admin chama N vezes por request) e impede
//     validação no startup. Caching aqui transforma `isAdminEmail` em
//     `Set.has` O(1) e centraliza a parsing/validação.
//   - Em produção, emitimos `console.error` se a env-var estiver
//     ausente/vazia — combinado com `assertProductionEnvs` no
//     `security.ts`, deixa rastro óbvio de misconfig sem derrubar o edge
//     inteiro (size=0 garante que nenhum email vira admin sem precisar
//     bloquear o boot).
//
// Formato esperado: comma-separated, com ou sem espaços. Entradas
// inválidas (sem `@` ou sem TLD) são ignoradas com warn — preferimos
// degradar a alguns admins do que perder o resto da lista por causa de
// um typo.
//
// Não é necessário refresh em runtime: env vars do edge runtime são
// imutáveis por cold-start. Quando o operador roda re-deploy com nova
// lista, novos edge workers leem a versão nova.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAdminEmails(): Set<string> {
  const raw = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid = raw.filter((e) => EMAIL_RE.test(e));
  const invalid = raw.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) {
    console.warn(
      '[admin-config] ADMIN_EMAILS contém entradas inválidas (ignoradas):',
      invalid,
    );
  }
  return new Set(valid);
}

const ADMIN_EMAILS_CACHE = parseAdminEmails();

// Boot-time validation só em produção. `assertProductionEnvs()` no
// `security.ts` cobre as envs Supabase obrigatórias; aqui só logamos —
// throw aqui derruba TODO request edge, e preferimos size=0 (= nenhum
// admin) a downtime total. Em vitest skipa via VITEST flags.
if (
  process.env.NODE_ENV === 'production' &&
  ADMIN_EMAILS_CACHE.size === 0 &&
  process.env.VITEST !== 'true' &&
  !process.env.VITEST_WORKER_ID
) {
  console.error(
    '[admin-config] ADMIN_EMAILS ausente/vazio em produção — ' +
      'nenhum email será reconhecido como admin via env. Painéis admin ' +
      'continuam acessíveis pra profiles.portal_access=true (auth-server).',
  );
}

/**
 * Checa se `email` está em `ADMIN_EMAILS` (case-insensitive). Lê do cache
 * inicializado no module-load — O(1).
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS_CACHE.has(email.toLowerCase());
}

/**
 * Resetar cache para testes. Uso:
 *   __resetAdminEmailsCacheForTests({ raw: 'a@b.co,c@d.co' });
 *
 * Sem `raw` apenas re-lê `process.env.ADMIN_EMAILS` atual.
 */
export function __resetAdminEmailsCacheForTests(opts?: { raw?: string }): void {
  if (opts?.raw !== undefined) process.env.ADMIN_EMAILS = opts.raw;
  const fresh = parseAdminEmails();
  ADMIN_EMAILS_CACHE.clear();
  for (const e of fresh) ADMIN_EMAILS_CACHE.add(e);
}
