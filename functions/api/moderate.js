export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ flagged: false, error: 'OPENAI_API_KEY não configurada' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const text = typeof body?.text === 'string' ? body.text.slice(0, 4000) : '';
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.slice(0, 2000) : '';

  if (!text.trim() && !imageUrl.trim()) {
    return json({ flagged: false, categories: {}, scores: {}, reasons: [] });
  }

  const input = [];
  if (text.trim()) input.push({ type: 'text', text });
  if (imageUrl.trim()) input.push({ type: 'image_url', image_url: { url: imageUrl } });

  try {
    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input
      })
    });
    if (!r.ok) {
      const errText = await r.text();
      return json({ error: `OpenAI ${r.status}: ${errText.slice(0, 200)}` }, 500);
    }
    const data = await r.json();
    const result = data?.results?.[0];
    if (!result) return json({ error: 'Resposta inválida da OpenAI' }, 502);

    const categories = result.categories || {};
    const scores = result.category_scores || {};
    const reasons = Object.entries(categories).filter(([, v]) => v === true).map(([k]) => k);

    // Hard-block categories — content that should NEVER publish
    const HARD = ['sexual/minors', 'hate/threatening', 'violence/graphic', 'self-harm/intent', 'self-harm/instructions'];
    const isHard = reasons.some(c => HARD.includes(c)) || (scores['sexual/minors'] || 0) > 0.3;

    return json({
      flagged: !!result.flagged,
      severity: isHard ? 'hard' : (result.flagged ? 'soft' : 'none'),
      categories,
      scores,
      reasons
    });
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
