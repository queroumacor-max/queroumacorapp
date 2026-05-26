// Upload do template visual de cada estilo da Arte IG.
// Restrito a ADMIN_EMAILS — não é per-user, afeta TODOS os usuários.
// Pipeline: valida token + email admin → upload pro bucket style-refs no
// Supabase storage (service_role) → devolve URL pública.
//
// Requer no Cloudflare Pages: SUPABASE_URL, SUPABASE_SERVICE_ROLE (ou _KEY),
// SUPABASE_ANON_KEY, ADMIN_EMAILS (comma-separated).
import { jsonResponse as json, FALLBACK_SUPABASE_URL } from './_security.js';

const ALLOWED_STYLES = ['portrait', 'antesdepois', 'profissional', 'trabalho', 'grafite'];
const MAX_BYTES = 4 * 1024 * 1024;  // 4MB max (templates costumam ser pequenos)

export async function onRequestPost(context){
  try { return await handle(context); }
  catch(e){
    console.warn('[upload-style-ref] crash:', e && e.message);
    return json({ error: 'Erro interno', detail: String(e?.message || e).slice(0, 200) }, 500);
  }
}

async function handle({ env, request }){
  if (!env.ADMIN_EMAILS) return json({ error: 'ADMIN_EMAILS não configurado' }, 503);
  const serviceKey = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json({ error: 'SUPABASE service role não configurado' }, 503);
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');

  // 1. Valida token e email contra ADMIN_EMAILS
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return json({ error: 'Sem token' }, 401);

  let email = '';
  try {
    const u = await fetch(supaUrl + '/auth/v1/user', {
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'apikey': env.SUPABASE_ANON_KEY || ''
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!u.ok) return json({ error: 'Token inválido' }, 401);
    const ud = await u.json();
    email = String(ud?.email || '').trim().toLowerCase();
  } catch(e){
    return json({ error: 'Falha validar token' }, 401);
  }
  const admins = env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!email || !admins.includes(email)){
    return json({ error: 'Acesso negado — só admin pode trocar templates' }, 403);
  }

  // 2. Parse body
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const styleKey = String(body?.styleKey || '').trim();
  const photoDataUrl = typeof body?.photoDataUrl === 'string' ? body.photoDataUrl : '';
  if (!ALLOWED_STYLES.includes(styleKey)){
    return json({ error: 'styleKey inválido', allowed: ALLOWED_STYLES }, 400);
  }
  const m = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoDataUrl);
  if (!m) return json({ error: 'photoDataUrl inválida' }, 400);
  const mime = m[1];
  const b64 = m[2].replace(/\s+/g, '');
  if ((b64.length * 3 / 4) > MAX_BYTES){
    return json({ error: `Imagem grande demais (máx ${MAX_BYTES / 1024 / 1024}MB)` }, 413);
  }

  // 3. Converte pra bytes
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // 4. Upload pro bucket style-refs (path: <styleKey>.jpg ou .png)
  // Usa cache-busting timestamp no path pra invalidar CDN imediatamente
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const path = `${styleKey}.${ext}`;
  const uploadUrl = `${supaUrl}/storage/v1/object/style-refs/${encodeURIComponent(path)}`;

  // PUT com upsert pra sobrescrever o template anterior
  const r = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + serviceKey,
      'Content-Type': mime,
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=60'  // 1min cache pra propagar troca rápido
    },
    body: bytes
  });
  if (!r.ok){
    const txt = (await r.text()).slice(0, 400);
    return json({ error: 'Falha ao subir no storage', detail: `${r.status}: ${txt}` }, 502);
  }

  // 5. Limpa as outras extensões pra não ter conflito (se trocou jpg → png)
  const otherExts = ['jpg', 'jpeg', 'png', 'webp'].filter(e => e !== ext);
  for (const e of otherExts){
    try {
      await fetch(`${supaUrl}/storage/v1/object/style-refs/${encodeURIComponent(styleKey + '.' + e)}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + serviceKey }
      });
    } catch(_){ /* ignora 404 */ }
  }

  // 6. Devolve URL pública + bust pra forçar refresh imediato no client
  const publicUrl = `${supaUrl}/storage/v1/object/public/style-refs/${encodeURIComponent(path)}?v=${Date.now()}`;
  return json({ ok: true, url: publicUrl, styleKey, path });
}
