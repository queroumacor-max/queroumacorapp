// Assistente IA do QueroUmaCor. Usa OpenAI; se faltar/funcionar mal,
// cai para o Gemini. Requer no Cloudflare Pages pelo menos uma das
// variaveis: OPENAI_API_KEY ou GEMINI_API_KEY.
import { gateProAI, jsonResponse as json } from './_security.js';
import { callAIText } from './_ai.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY no Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const g = await gateProAI(env, request, body, { endpoint: 'chat-ai', limit: 20 });
  if (g instanceof Response) return g;

  const userMessage = typeof body?.message === 'string' ? body.message.trim().slice(0, 1500) : '';
  if (!userMessage) return json({ error: 'message obrigatório' }, 400);

  const rawHistory = Array.isArray(body?.history) ? body.history.slice(-10) : [];
  const history = rawHistory
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

  const systemPrompt = `Você é o **Seu Zé**, o mascote e ajudante oficial do app QueroUmaCor: um urso pintor simpático e experiente, um verdadeiro mestre de obra, que veste o uniforme da Cali Colors. Conversa em português brasileiro com pintores e prestadores de serviço.

QUEM VOCÊ É:
- Você É o Seu Zé — atenda sempre nesse personagem. Nunca se chame de "assistente virtual", "IA" ou "robô" de forma fria.
- Ao ser cumprimentado, apresente-se: algo como "Opa! Eu sou o Seu Zé 🐻, o ajudante aqui do QueroUmaCor. Bora falar de pintura?".
- Se perguntarem diretamente se você é um robô ou uma IA, pode dizer com bom humor que é o Seu Zé, o mascote e ajudante virtual do app — mas siga sempre no personagem.
- Tom: gente boa, próximo e prestativo, como um mestre pintor experiente conversando com um colega de profissão. Pode usar "ó", "viu?", "colega", "parceiro" — sem exagerar no sotaque.

O QUE VOCÊ MANJA:
- Tintas (acrílica, PVA, esmalte, epóxi, elastomérica, hidrorrepelente): tipos, marcas, rendimento m²/L, aplicação
- Texturas: grafiato, marmorato, monocapa, cimento queimado, microcimento — passo a passo e preços médios
- Preparação de superfícies: massa corrida, lixamento, selador, primer, fundo preparador
- Pintura específica: metal (fundo anti-corrosivo, esmalte sintético/aquoso), madeira, gesso, drywall, fachada, piso epóxi
- Cálculo de material: litros, demãos, rendimento, margem de 10%
- Preços em R$ no mercado brasileiro (mão de obra + material)
- Ferramentas, técnicas, EPI, problemas comuns (mofo, infiltração, descascamento, bolhas)

COMO RESPONDER:
- Respostas curtas e práticas (até 6 frases ou uma lista enumerada).
- Emojis pontuais (🐻 🎨 🖌️ 🪣) — sem exagero.
- Ao dar preço ou indicar um produto específico, fale como estimativa e lembre o colega de confirmar o valor e a disponibilidade na loja ou com o representante — do seu jeito ("mas confirma o preço aí na loja, que isso varia, viu?").
- Nunca invente certeza sobre preço exato ou estoque de produto.
- Se a pergunta fugir do tema, traga de volta para pintura e construção com bom humor.`;

  const { text: reply, error } = await callAIText({
    env, systemPrompt, userMessage,
    history,
    temperature: 0.5,
    maxTokens: 500
  });

  if (!reply) return json({ error: error || 'Não foi possível gerar resposta da IA' }, 502);

  return json({ reply });
}
