export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ flagged: false, error: 'OPENAI_API_KEY não configurada' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const text = typeof body?.text === 'string' ? body.text.slice(0, 4000) : '';
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.slice(0, 200000) : '';

  if (!text.trim() && !imageUrl.trim()) {
    return json({ flagged: false, categories: {}, scores: {}, reasons: [], engine: 'none' });
  }

  // ── Camada 1: OpenAI omni-moderation (texto + imagem) ──
  try {
    const input = [];
    if (text.trim()) input.push({ type: 'text', text });
    if (imageUrl.trim()) input.push({ type: 'image_url', image_url: { url: imageUrl } });

    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input })
    });
    if (!r.ok) throw new Error(`omni ${r.status}`);
    const data = await r.json();
    const result = data?.results?.[0];
    if (!result) throw new Error('resposta inválida');

    const categories = result.categories || {};
    const scores = result.category_scores || {};
    const reasons = Object.entries(categories).filter(([, v]) => v === true).map(([k]) => k);

    const HARD = ['sexual/minors', 'hate/threatening', 'violence/graphic', 'self-harm/intent', 'self-harm/instructions'];
    const isHard = reasons.some(c => HARD.includes(c)) || (scores['sexual/minors'] || 0) > 0.3;

    // omni-moderation não tem categoria de golpe/scam — checa só no texto.
    const scam = detectScam(text);
    const flagged = !!result.flagged || scam;

    return json({
      flagged,
      severity: isHard ? 'hard' : (flagged ? 'soft' : 'none'),
      categories,
      scores,
      reasons: scam ? [...reasons, 'scam'] : reasons,
      engine: 'omni-moderation'
    });
  } catch (primaryErr) {
    // ── Camada 2 (fallback): gpt-4o-mini visão com rubrica estrita ──
    try {
      const fb = await fallbackModeration(env.OPENAI_API_KEY, text, imageUrl);
      return json({ ...fb, engine: 'gpt-4o-mini-fallback' });
    } catch (fbErr) {
      // Ambas as camadas falharam — quem chama deve tratar como "indisponível".
      return json({ error: `moderação indisponível: ${String(primaryErr?.message || primaryErr)}`, engine: 'failed' }, 502);
    }
  }
}

function detectScam(text) {
  if (!text) return false;
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const lures = [
    'pix antecipado', 'deposito antecipado', 'taxa de liberacao', 'ganhe dinheiro facil',
    'renda extra garantida', 'investimento garantido', 'dobre seu dinheiro', 'clique no link e ganhe',
    'premio voce ganhou', 'cartao premiado', 'emprestimo sem consulta', 'chave pix para pagamento adiantado'
  ];
  return lures.some(l => t.includes(l));
}

async function fallbackModeration(apiKey, text, imageUrl) {
  const userContent = [];
  const rubric = 'Você é um moderador de conteúdo. Analise o conteúdo e responda APENAS um JSON válido ' +
    '{"flagged":bool,"severity":"none|soft|hard","reasons":[string]}. ' +
    'severity "hard" (bloqueio total) para: nudez explícita, pornografia, qualquer conteúdo sexual envolvendo menores, ' +
    'violência gráfica/sangue, ódio com ameaça, apologia a abuso infantil. ' +
    'severity "soft" (revisão humana) para: linguagem ofensiva, golpe/scam/phishing, spam, conteúdo sexual sugestivo. ' +
    'severity "none" se for seguro. reasons em palavras curtas (ex: "nudez","sexual/minors","golpe","violencia","odio").';
  userContent.push({ type: 'text', text: (text || '(sem texto)').slice(0, 3000) });
  if (imageUrl && imageUrl.trim()) {
    userContent.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: rubric },
        { role: 'user', content: userContent }
      ]
    })
  });
  if (!r.ok) throw new Error(`fallback ${r.status}`);
  const data = await r.json();
  let parsed = {};
  try { parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}'); } catch { parsed = {}; }
  const severity = ['none', 'soft', 'hard'].includes(parsed.severity) ? parsed.severity : (parsed.flagged ? 'soft' : 'none');
  return {
    flagged: !!parsed.flagged || severity !== 'none',
    severity,
    categories: {},
    scores: {},
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 8) : []
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
