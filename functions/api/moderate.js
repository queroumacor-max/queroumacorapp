// Moderação de texto + imagem via Google Gemini.
// Requer no Cloudflare Pages: GEMINI_API_KEY.
// Vídeo é tratado de forma assíncrona em /api/moderate-video.
import { requireAuth, checkRateLimit, rateLimitResponse } from './_security.js';

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
  'Você é um moderador de conteúdo de uma rede social de pintores/grafiteiros. ' +
  'Analise o texto e a imagem (se houver) e responda APENAS um JSON válido: ' +
  '{"flagged":bool,"severity":"none|soft|hard","reasons":[string]}. ' +
  'severity "hard" (bloqueio total): nudez explícita, pornografia, QUALQUER conteúdo sexual envolvendo menores, ' +
  'violência gráfica/sangue, ódio com ameaça, apologia a abuso infantil, armas/drogas ilícitas em destaque. ' +
  'severity "soft" (revisão humana): linguagem ofensiva, golpe/scam/phishing, spam, conteúdo sexual sugestivo, ' +
  'dados pessoais expostos (doxxing), pedido de contato/pagamento fora da plataforma (PIX/telefone na legenda). ' +
  'severity "none" se for seguro (arte, pintura, grafite legítimo são seguros). ' +
  'reasons: palavras curtas em pt-br (ex: "nudez","sexual_menores","golpe","violencia","odio","spam").';

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
        })
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
    // Falhou: quem chama trata como indisponível (fail-safe → revisão).
    return json({ error: `moderação indisponível: ${String(err?.message || err)}`, engine: 'failed' }, 502);
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
  const r = await fetch(src);
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
