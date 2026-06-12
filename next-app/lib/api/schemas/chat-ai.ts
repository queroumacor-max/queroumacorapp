// lib/api/schemas/chat-ai.ts — Zod schema do POST /api/chat-ai.
// R-H10 do REMEDIATION_PLAN: validação Zod nos handlers críticos.
//
// O handler real aceita `message` (string) + `history` (array de
// {role, content}), NÃO o pattern OpenAI `messages: [...]`. Esquema
// adaptado pra realidade do código existente (chatWithSeuZe).
// Aceitamos `message: ''` (string vazia/whitespace) — o service downstream
// já valida e devolve `ServiceError(400)` no caso vazio, mantendo compat
// com os testes existentes.

import { z } from 'zod';

export const chatAiHistoryMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(10_000),
});

// Nota: `accessToken` min(1) (compat com stubs), max 2000 (DoS).
// Validação real via requireAuth → /auth/v1/user.
export const chatAiSchema = z.object({
  message: z.string().max(10_000).optional(),
  history: z.array(chatAiHistoryMessageSchema).max(20).optional(),
  accessToken: z.string().min(1).max(2000).optional(),
});

export type ChatAiInput = z.infer<typeof chatAiSchema>;

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
