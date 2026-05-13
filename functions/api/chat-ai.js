export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY não configurada' }, 503);
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

  const messages = [
    {
      role: 'system',
      content: `Você é o assistente IA especializado em pintura, construção civil e acabamentos do app QueroUmaCor. Fala português brasileiro com pintores e prestadores de serviço no Brasil.

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
- Se a pergunta fugir do tema, redirecione gentilmente para pintura/construção`
    },
    ...history,
    { role: 'user', content: userMessage }
  ];

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.5,
        max_tokens: 500
      })
    });
    if (!r.ok) {
      const errText = await r.text();
      return json({ error: `OpenAI ${r.status}: ${errText.slice(0, 200)}` }, 500);
    }
    const data = await r.json();
    let reply = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!reply) return json({ error: 'Resposta vazia da OpenAI' }, 502);
    // Safety net: ensure the disclaimer is always the first line, even if the model skipped it
    if (!/^Sou um assistente virtual/i.test(reply)) {
      reply = DISCLAIMER + '\n\n' + reply;
    }
    return json({ reply });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
