// Assistente IA do QueroUmaCor. Usa OpenAI; se faltar/funcionar mal,
// cai para o Gemini. Requer no Cloudflare Pages pelo menos uma das
// variaveis: OPENAI_API_KEY ou GEMINI_API_KEY.
const GEMINI_MODEL = 'gemini-2.5-flash';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY no Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const userMessage = typeof body?.message === 'string' ? body.message.trim().slice(0, 1500) : '';
  if (!userMessage) return json({ error: 'message obrigatório' }, 400);

  const rawHistory = Array.isArray(body?.history) ? body.history.slice(-10) : [];
  const history = rawHistory
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

  const DISCLAIMER = 'Sou um assistente virtual, qualquer confirmação de informações ditas aqui eu recomendo checar com o representante da marca ou lojista que você escolher.';

  const systemPrompt = `Você é o assistente IA especializado em pintura, construção civil e acabamentos do app QueroUmaCor. Fala português brasileiro com pintores e prestadores de serviço no Brasil.

REGRA OBRIGATÓRIA: TODA resposta sua DEVE começar com EXATAMENTE este texto, sem alteração nenhuma, como primeira linha, seguido de uma linha em branco:

${DISCLAIMER}

Depois do disclaimer, dê a resposta normal.

Domínios que você atende:
- Tintas (acrílica, PVA, esmalte, epóxi, elastomérica, hidrorrepelente): tipos, marcas, rendimento m²/L, aplicação
- Texturas: grafiato, marmorato, monocapa, cimento queimado, microcimento — passo a passo e preços médios
- Preparação de superfícies: massa corrida, lixamento, selador, primer, fundo preparador
- Pintura específica: metal (fundo anti-corrosivo, esmalte sintético/aquoso), madeira, gesso, drywall, fachada, piso epóxi
- Cálculo de material: litros, demãos, rendimento, margem de 10%
- Preços em R$ no mercado brasileiro (mão de obra + material)
- Ferramentas, técnicas, EPI, problemas comuns (mofo, infiltração, descascamento, bolhas)

Estilo:
- Respostas curtas e práticas (até 6 frases ou usar lista enumerada) após o disclaimer
- Tom amigável e profissional
- Emojis pontuais permitidos (🎨 🖌️ 💡 🧱) — sem exagero
- Valores aproximados em R$ quando relevante
- Se a pergunta fugir do tema, redirecione gentilmente para pintura/construção`;

  let reply = '';
  let lastError = '';

  // 1) OpenAI
  if (env.OPENAI_API_KEY) {
    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
      ];
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.5, max_tokens: 500 })
      });
      if (r.ok) {
        const data = await r.json();
        reply = data?.choices?.[0]?.message?.content?.trim() || '';
      } else {
        lastError = `OpenAI ${r.status}: ${(await r.text()).slice(0, 150)}`;
      }
    } catch (e) {
      lastError = 'OpenAI: ' + String(e?.message || e);
    }
  }

  // 2) Fallback Gemini
  if (!reply && env.GEMINI_API_KEY) {
    try {
      const contents = [
        ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text: userMessage }] }
      ];
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { temperature: 0.5, maxOutputTokens: 600 }
          })
        }
      );
      if (r.ok) {
        const data = await r.json();
        reply = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      } else {
        lastError = `Gemini ${r.status}: ${(await r.text()).slice(0, 150)}`;
      }
    } catch (e) {
      lastError = 'Gemini: ' + String(e?.message || e);
    }
  }

  if (!reply) return json({ error: lastError || 'Não foi possível gerar resposta da IA' }, 502);

  if (!/^Sou um assistente virtual/i.test(reply)) {
    reply = DISCLAIMER + '\n\n' + reply;
  }
  return json({ reply });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
