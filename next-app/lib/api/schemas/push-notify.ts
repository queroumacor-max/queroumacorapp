// lib/api/schemas/push-notify.ts — Zod schema do payload do /api/push-notify.
// Extraído pra arquivo separado porque Next.js 15 só aceita HTTP handlers +
// config em route files. Mantém validação testável.
//
// Hard caps:
//   - userIds: 1..100 UUIDs. Trigger pg_net normal manda 1; >50 levanta
//     warning (sinal de potencial abuso/secret leak).
//   - title: 1..200 chars (Web Push spec não limita, mas Chrome trunca em ~200).
//   - body: até 500 chars (mesma heurística).
//   - url: caminho relativo começando com '/' (evita open-redirect via push).
//   - icon: URL absoluta (CDN/Storage).

import { z } from 'zod';

export const pushNotifySchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
  title: z.string().min(1).max(200),
  body: z.string().max(500).optional().default(''),
  url: z.string().startsWith('/').max(500).optional().default('/notificacoes'),
  icon: z.string().url().max(500).optional(),
  tag: z.string().max(100).optional(),
});

export type PushNotifyInput = z.infer<typeof pushNotifySchema>;
