import { requireAuth, requirePro } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY não configurada no projeto Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Auth + PRO check (fail-open)
  const auth = await requireAuth(env, request, body);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const proCheck = await requirePro(env, auth.user && auth.user.id);
  if (!proCheck.pro) return json({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);

  const rawName = typeof body?.name === 'string' ? body.name : '';
  const name = rawName.replace(/[^\p{L}\p{N}\s&\-.']/gu, '').trim().slice(0, 50);
  if (!name) return json({ error: 'name obrigatório' }, 400);

  const rawStyle = typeof body?.style === 'string' ? body.style : '';
  const style = rawStyle.replace(/[^\p{L}\p{N}\s,&\-.']/gu, '').trim().slice(0, 80);
  const styleHint = style || 'modern minimalist, premium branding';

  const prompts = [
    `Logo design — bold emblem badge composition for a Brazilian small business called "${name}". Strong sans-serif typography integrated with iconic shapes. Visual style: ${styleHint}. Isolated subject on a fully transparent background, no rectangle or backdrop behind the logo, flat 2D vector art, no people, no photographic elements, no extra text besides the brand name.`,
    `Logo design — modern circular monogram composition for a business named "${name}". Large prominent initials. Visual style: ${styleHint}. Isolated subject on a fully transparent background, no rectangle or backdrop behind the logo, flat 2D vector art, premium feel, no people, no extra text besides the brand name.`,
    `Logo design — horizontal lockup composition with an icon to the left of the brand name "${name}". Crisp, premium. Visual style: ${styleHint}. Isolated subject on a fully transparent background, no rectangle or backdrop behind the logo, flat 2D vector art, no people, no extra text besides the brand name.`
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
          quality: 'medium',
          background: 'transparent',
          output_format: 'png'
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
