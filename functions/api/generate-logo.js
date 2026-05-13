export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY não configurada no projeto Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const rawName = typeof body?.name === 'string' ? body.name : '';
  const name = rawName.replace(/[^\p{L}\p{N}\s&\-.']/gu, '').trim().slice(0, 50);
  if (!name) return json({ error: 'name obrigatório' }, 400);

  const prompts = [
    `Vector logo design for a Brazilian house painting company called "${name}". Bold geometric emblem badge style. Iconography of a paint roller and brush integrated with strong sans-serif typography. Vibrant orange (#ff6b35) and deep navy (#1a1a2e) palette. Flat 2D vector art, minimalist, premium feel, centered on pure white background, no other text, no people, no photographic elements.`,
    `Modern circular monogram logo for a painting business named "${name}". Large prominent initials in elegant geometric sans-serif. Thin paint stroke arc accent encircling the monogram. Teal (#2ec4b6) and ink navy (#1a1a2e) colors on pure white background. Flat vector style, premium minimalist branding, centered, no other text, no extras.`,
    `Stylish horizontal lockup logo for a painter brand named "${name}". Crisp paintbrush line-art icon to the left of the brand name in bold modern sans-serif type. Warm terracotta (#e63946) and cream tones, flat 2D vector design, premium minimalist look, white background, centered, no extra text, no people.`
  ];

  try {
    const urls = await Promise.all(prompts.map(async (prompt) => {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'medium'
        })
      });
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(`OpenAI ${r.status}: ${errText.slice(0, 200)}`);
      }
      const data = await r.json();
      const item = data?.data?.[0];
      if (item?.url) return item.url;
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
      return null;
    }));

    if (urls.some(u => !u)) return json({ error: 'OpenAI não retornou imagem' }, 502);
    return json({ urls });
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
