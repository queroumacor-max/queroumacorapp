// Moderação de texto + imagem via Google Gemini.
// Requer no Cloudflare Pages: GEMINI_API_KEY.
// Vídeo é tratado de forma assíncrona em /api/moderate-video.
import { requireAuth, checkRateLimit, rateLimitResponse, jsonResponse as json } from './_security.js';

const GEMINI_MODEL = 'gemini-2.5-flash';

// Allowlist de hosts pra fetchImageInline. Antes aceitava qualquer URL
// arbitrária (SSRF) — agora só Supabase Storage do projeto, ou data: URLs.
function isAllowedImageHost(urlStr){
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    if (!/^[A-Za-z0-9-]+\.supabase\.co$/.test(u.hostname)) return false;
    return u.pathname.startsWith('/storage/');
  } catch { return false; }
}

const RUBRIC =
  'Você é um moderador de conteúdo de uma plataforma BRASILEIRA de PINTORES, GRAFITEIROS e profissionais de pintura. ' +
  'O público publica trabalhos, materiais, preços e formas de contato — isso é o NEGÓCIO dessa galera. ' +
  'Modere com PARCIMÔNIA: na dúvida, libere. Falso positivo (segurar trabalho honesto) machuca mais do que falso negativo. ' +
  'Analise o texto e a imagem (se houver) e responda APENAS um JSON válido: ' +
  '{"flagged":bool,"severity":"none|soft|hard","reasons":[string]}.\n' +
  '\n' +
  'severity "hard" (bloqueio total — só nesses casos): ' +
  'nudez explícita ou pornografia; QUALQUER conteúdo sexual envolvendo menores; ' +
  'violência gráfica real com sangue/cadáveres; ameaça concreta de morte/agressão a pessoa específica; ' +
  'apologia ao nazismo, terrorismo ou abuso infantil; venda explícita de drogas ilícitas pesadas ou armas de fogo.\n' +
  '\n' +
  'severity "soft" (revisão humana — use com PARCIMÔNIA): ' +
  'golpe/scam/phishing claro ("pague antes pra liberar", "ganhe X reais sem fazer nada", taxa antecipada, link de encurtador suspeito); ' +
  'spam massivo (mesma mensagem repetida várias vezes); ' +
  'doxxing de TERCEIRO (expor telefone/endereço de outra pessoa sem permissão); ' +
  'ofensa pesada direcionada a uma pessoa real específica (não gíria casual); ' +
  'incitação a ódio contra grupo (não simples palavrão).\n' +
  '\n' +
  'severity "none" (LIBERA — esses casos NUNCA são soft nem hard):\n' +
  '- Arte de pintura, grafite, mural, textura — mesmo que abstrato, polêmico, expressivo ou com nudez artística discreta.\n' +
  '- Telefone, WhatsApp, Instagram, e-mail, PIX e endereço do PRÓPRIO prestador na legenda — é como ele atende cliente.\n' +
  '- Preço de serviço/material, "R$/m²", orçamento.\n' +
  '- Link pro próprio Instagram, site ou portfólio (instagram.com/foo, meusite.com.br).\n' +
  '- Palavrão leve usado como exclamação ou ênfase brasileira ("foda demais", "puta arte linda", "que merda de tempo", "caraca, ficou top") — sem ataque pessoal real.\n' +
  '- Críticas a marcas, produtos ou concorrência (mesmo duras).\n' +
  '- Termos técnicos: "matar a sede", "matar a saudade", "armário", "pistola de pintar", "rolo", "trincha".\n' +
  '- Nomes próprios (Cornélio, Matheus, Armando) — não confundir com substring de palavrão.\n' +
  '\n' +
  'reasons: palavras curtas em pt-br (ex: "nudez","sexual_menores","golpe","violencia","odio","spam","doxxing").';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.GEMINI_API_KEY) {
    return json({ flagged: false, error: 'GEMINI_API_KEY não configurada', engine: 'none' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Auth + rate-limit (fecha SSRF anônimo + uso do endpoint como proxy)
  const auth = await requireAuth(env, request, body);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!auth.user) return json({ error: 'Faça login' }, 401);
  const rl = await checkRateLimit(env, auth.user.id, 'moderate', 20);
  if (!rl.allowed) return rateLimitResponse(rl);

  const text = typeof body?.text === 'string' ? body.text.slice(0, 4000) : '';
  const imageUrlRaw = typeof body?.imageUrl === 'string' ? body.imageUrl : '';
  // Só aceita data: URL ou URL do Supabase Storage do projeto (anti-SSRF)
  const imageUrl = (imageUrlRaw.startsWith('data:image/') || isAllowedImageHost(imageUrlRaw))
    ? imageUrlRaw : '';

  if (!text.trim() && !imageUrl.trim()) {
    return json({ flagged: false, severity: 'none', reasons: [], engine: 'none' });
  }

  // Heurística local barata de golpe (roda antes do modelo)
  const scam = detectScam(text);

  const parts = [{ text: RUBRIC }, { text: 'CONTEÚDO:\n' + (text || '(sem texto)') }];

  if (imageUrl.trim()) {
    try {
      const img = await fetchImageInline(imageUrl);
      if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.b64 } });
    } catch (e) { /* sem imagem inline, modera só o texto */ }
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        }),
        signal: AbortSignal.timeout(25000)
      }
    );
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 150)}`);
    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    let severity = ['none', 'soft', 'hard'].includes(parsed.severity) ? parsed.severity : 'none';
    let reasons = Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 8) : [];
    let flagged = !!parsed.flagged || severity !== 'none';

    if (scam) {
      flagged = true;
      if (severity === 'none') severity = 'soft';
      if (!reasons.includes('golpe')) reasons.push('golpe');
    }

    return json({ flagged, severity, reasons, categories: {}, scores: {}, engine: 'gemini' });
  } catch (err) {
    const isTimeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (isTimeout) return json({ error: 'Gemini timeout (25s) — tente de novo', engine: 'failed' }, 504);
    // Falhou: quem chama trata como indisponível (fail-safe → revisão).
    // Não vaza err.message no response (pode conter detalhes internos);
    // loga server-side só pra diagnostico.
    console.warn('moderate err:', err && err.message);
    return json({ error: 'moderação indisponível', engine: 'failed' }, 502);
  }
}

function detectScam(text) {
  if (!text) return false;
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const lures = [
    'pix antecipado', 'deposito antecipado', 'taxa de liberacao', 'ganhe dinheiro facil',
    'renda extra garantida', 'investimento garantido', 'dobre seu dinheiro', 'clique no link e ganhe',
    'premio voce ganhou', 'cartao premiado', 'emprestimo sem consulta', 'pagamento adiantado'
  ];
  return lures.some(l => t.includes(l));
}

async function fetchImageInline(src) {
  // data URL (ex.: frame capturado no cliente)
  const m = /^data:([^;]+);base64,(.+)$/.exec(src);
  if (m) return { mime: m[1], b64: m[2] };
  if (!/^https?:\/\//.test(src)) return null;
  const r = await fetch(src, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 6 * 1024 * 1024) return null; // imagem grande demais p/ inline
  return { mime: ct, b64: bufToB64(buf) };
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
