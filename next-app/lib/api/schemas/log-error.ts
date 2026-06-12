// lib/api/schemas/log-error.ts — Zod schema do payload do /api/log-error.
//
// Mantém os campos que o sanitizer já trata. Endpoint é fail-open: shape
// inválido vira 200 silencioso (evita loop log-error → log-error), mas
// hard cap em strings + context bloqueia payload absurdo antes do insert.
//
// `context` é objeto livre porque clientes mandam ctx variado (Web Vitals,
// CSP report, exceptions); validamos só presença + truncamos JSON > 5KB
// no sanitizer.

import { z } from 'zod';

export const logErrorSchema = z.object({
  user_id: z.string().uuid().optional().nullable(),
  // mensagem principal. Aceita tanto `msg` (vanilla) quanto `message`.
  msg: z.string().max(1000).optional(),
  message: z.string().max(1000).optional(),
  type: z.string().max(32).optional(),
  stack: z.string().max(5000).optional(),
  url: z.string().url().max(500).optional(),
  ua: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  metric: z.string().max(32).optional(),
  value: z.number().optional(),
  ctx: z.string().max(500).optional(),
  context: z.record(z.unknown()).optional(),
});

export type LogErrorInput = z.infer<typeof logErrorSchema>;
