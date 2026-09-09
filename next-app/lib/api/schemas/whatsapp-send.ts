// lib/api/schemas/whatsapp-send.ts — Zod schema do payload do
// /api/whatsapp/send. Arquivo separado porque Next.js 15 só aceita HTTP
// handlers + config em route files; aqui fica testável.
//
// Caps:
//   - to: 8..25 chars (telefone com ou sem máscara; normalização BR fica
//     no service `normalizeBrPhone`).
//   - body: 1..4096 (limite de texto do Cloud API).
//   - template: nome aprovado no WABA (lowercase + underscore, padrão Meta).
//   - components: repassados crus pro Graph (a Meta valida shape); cap 10.

import { z } from 'zod';

export const whatsappSendSchema = z
  .object({
    to: z.string().min(8).max(25),
    type: z.enum(['text', 'template']).optional().default('text'),
    body: z.string().min(1).max(4096).optional(),
    template: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, 'nome de template inválido (lowercase + underscore)')
      .optional(),
    languageCode: z.string().min(2).max(15).optional().default('pt_BR'),
    components: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
    // Lead que está sendo abordado (portal). Com ele a rota amarra o wamid
    // ao lead, e é por esse vínculo que o status de entrega do webhook
    // chega até a tela de Leads (2026-09-09). Opcional: a aba WhatsApp e o
    // follow-up mandam sem lead.
    leadId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'text' && !data.body) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body'],
        message: 'body obrigatório quando type=text',
      });
    }
    if (data.type === 'template' && !data.template) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['template'],
        message: 'template obrigatório quando type=template',
      });
    }
  });

export type WhatsAppSendInput = z.infer<typeof whatsappSendSchema>;
