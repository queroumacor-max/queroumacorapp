// lib/api/schemas/checkout.ts — Zod schema do POST /api/checkout.
// R-H10 do REMEDIATION_PLAN: validação Zod nos handlers críticos.
//
// `accessToken` é o JWT Supabase opcionalmente passado no body (alternativa
// ao header Authorization). Limites de tamanho protegem contra DoS por
// payload gigante.

import { z } from 'zod';

// Nota: `accessToken` mínimo é 1 char (compat com testes stub que mandam
// "jwt-stub", "good-jwt" etc.) e máximo é 2000 (DoS protection). Validação
// real do token acontece em `requireAuthStrict` via `/auth/v1/user`.
export const checkoutSchema = z.object({
  accessToken: z.string().min(1).max(2000).optional(),
  productId: z.string().max(100).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/**
 * Formata erros Zod pra resposta segura: em produção esconde os `path`
 * (que revelariam shape interno do schema). Em dev, expõe os campos
 * inválidos pra facilitar debug.
 */
export function formatZodError(
  issues: z.ZodIssue[]
): { error: string; fields?: string[] } {
  return {
    error: 'invalid_input',
    fields:
      process.env.NODE_ENV === 'production'
        ? undefined
        : issues.map((i) => i.path.join('.')),
  };
}
