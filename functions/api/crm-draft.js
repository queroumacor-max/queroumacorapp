// Rascunha (NUNCA envia) uma mensagem de reativação de cliente para o
// mini-CRM do QueroUmaCor. Usa OpenAI; cai para Gemini se faltar/falhar.
// Requer no Cloudflare Pages pelo menos uma das variaveis:
// OPENAI_API_KEY ou GEMINI_API_KEY.
import { gateProAI, jsonResponse as json } from './_security.js';
import { callAIText } from './_ai.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY no Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const g = await gateProAI(env, request, body, { endpoint: 'crm-draft', limit: 10 });
  if (g instanceof Response) return g;

  const clientName = typeof body?.clientName === 'string' ? body.clientName.trim().slice(0, 80) : '';
  const lastService = typeof body?.lastService === 'string' ? body.lastService.trim().slice(0, 200) : '';
  const monthsSince = Math.max(0, Math.min(120, parseInt(body?.monthsSince, 10) || 0));
  const painterName = typeof body?.painterName === 'string' ? body.painterName.trim().slice(0, 80) : '';

  const systemPrompt = `Você é um assistente que escreve mensagens curtas e pessoais para profissionais de pintura no Brasil reativarem clientes antigos. Fala português brasileiro.

REGRAS:
- Escreva UMA mensagem pronta para enviar ao cliente (um único parágrafo, 2 a 4 frases).
- Tom cordial, próximo e profissional — como uma conversa de WhatsApp, sem ser invasivo.
- Cumprimente o cliente pelo nome quando houver.
- Relembre de leve o último serviço feito e há quanto tempo foi.
- Sugira gentilmente uma repintura, retoque ou manutenção, e ofereça ajuda/orçamento sem pressão.
- Não use assunto, não use assinatura de e-mail, não use marcadores nem listas.
- Emojis pontuais permitidos (no máximo 1 ou 2).
- Responda APENAS com o texto da mensagem, nada além disso.`;

  let userMessage = 'Escreva a mensagem de reativação.';
  if (clientName) userMessage += `\nNome do cliente: ${clientName}.`;
  if (lastService) userMessage += `\nÚltimo serviço realizado: ${lastService}.`;
  if (monthsSince) userMessage += `\nTempo desde o último serviço: ${monthsSince} meses.`;
  if (painterName) userMessage += `\nA mensagem é enviada pelo profissional: ${painterName}.`;

  const { text: reply, error } = await callAIText({
    env, systemPrompt, userMessage,
    temperature: 0.7,
    maxTokens: 240
  });

  if (!reply) return json({ error: error || 'Não foi possível gerar a mensagem' }, 502);

  return json({ draft: reply });
}
