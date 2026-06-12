// lib/api/schemas/moderate.ts — Zod schema do POST /api/moderate.
// R-H10 do REMEDIATION_PLAN: validação Zod nos handlers críticos.
//
// Aceita `text` (caption do post), `mediaUrl` (URL Supabase pra hash),
// `imageUrl` (data URL ou Supabase pra Gemini vision) e `postId`. Todos
// opcionais — o handler lida com payload mínimo. `accessToken` opcional
// como fallback do header Authorization.
//
// Nota: NÃO aplicamos `.refine(text || mediaUrl)` pra manter compat com
// o caller histórico que dispara o endpoint só pra rotear pela pipeline
// de moderação (o handler curto-circuita pra `engine: 'none'` quando
// vazio). Os limites de tamanho garantem proteção contra DoS.

import { z } from 'zod';

export const moderateSchema = z.object({
  text: z.string().max(10_000).optional(),
  mediaUrl: z.string().url().max(2000).optional(),
  imageUrl: z.string().max(200_000).optional(), // data URLs podem ser longos
  postId: z.string().max(64).optional(),
  // accessToken min(1) (compat stubs), max 2000 (DoS); validação real
  // em requireAuth.
  accessToken: z.string().min(1).max(2000).optional(),
});

export type ModerateInput = z.infer<typeof moderateSchema>;

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
