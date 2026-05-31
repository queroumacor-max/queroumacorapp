// lib/api/_services/crm-draft.ts — port de
// `functions/api/_services/crm-draft.js`. Rascunho de mensagem de reativação.

import { ServiceError } from '../security';
import { callAIText } from '../_ai';

const SYSTEM_PROMPT = `Você é um assistente que escreve mensagens curtas e pessoais para profissionais de pintura no Brasil reativarem clientes antigos. Fala português brasileiro.

REGRAS:
- Escreva UMA mensagem pronta para enviar ao cliente (um único parágrafo, 2 a 4 frases).
- Tom cordial, próximo e profissional — como uma conversa de WhatsApp, sem ser invasivo.
- Cumprimente o cliente pelo nome quando houver.
- Relembre de leve o último serviço feito e há quanto tempo foi.
- Sugira gentilmente uma repintura, retoque ou manutenção, e ofereça ajuda/orçamento sem pressão.
- Não use assunto, não use assinatura de e-mail, não use marcadores nem listas.
- Emojis pontuais permitidos (no máximo 1 ou 2).
- Responda APENAS com o texto da mensagem, nada além disso.`;

export async function draftReactivationMessage(args: {
  clientName?: unknown;
  lastService?: unknown;
  monthsSince?: unknown;
  painterName?: unknown;
}): Promise<{ draft: string }> {
  const cName =
    typeof args.clientName === 'string' ? args.clientName.trim().slice(0, 80) : '';
  const lSvc =
    typeof args.lastService === 'string'
      ? args.lastService.trim().slice(0, 200)
      : '';
  const monthsRaw = args.monthsSince;
  const mSince = Math.max(
    0,
    Math.min(120, parseInt(String(monthsRaw ?? ''), 10) || 0)
  );
  const pName =
    typeof args.painterName === 'string'
      ? args.painterName.trim().slice(0, 80)
      : '';

  let userMessage = 'Escreva a mensagem de reativação.';
  if (cName) userMessage += `\nNome do cliente: ${cName}.`;
  if (lSvc) userMessage += `\nÚltimo serviço realizado: ${lSvc}.`;
  if (mSince) userMessage += `\nTempo desde o último serviço: ${mSince} meses.`;
  if (pName) userMessage += `\nA mensagem é enviada pelo profissional: ${pName}.`;

  const { text: reply, error } = await callAIText({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    temperature: 0.7,
    maxTokens: 240,
  });
  if (!reply) {
    throw new ServiceError(error || 'Não foi possível gerar a mensagem', 502);
  }
  return { draft: reply };
}
