// Helpers de segurança server-side para os endpoints de IA. Arquivo com
// prefixo `_` para que o Cloudflare Pages Functions NÃO o exponha como
// rota HTTP — é apenas um módulo importado pelos handlers vizinhos.
//
// Estratégia: FAIL-OPEN em todos os pontos onde a config (env) ainda
// não está completa, para preservar o comportamento atual até que:
//   1) o cliente passe a enviar o token em todas as chamadas; e
//   2) SUPABASE_SERVICE_KEY seja configurada no Cloudflare.
// Quando ambos estiverem em vigor, requireAuth + requirePro passam a
// barrar requests anônimos e usuários sem PRO, respectivamente.

export const FALLBACK_SUPABASE_URL = 'https://uwqebaqweehiljsqkifm.supabase.co';
export const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cWViYXF3ZWVoaWxqc3FraWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjYzMjgsImV4cCI6MjA4OTgwMjMyOH0.yp-z4iMifiOV3ftLVIHOFEQBLcMBdU8VFok7VKlSFg8';

// Extrai o JWT do request. Prioridade: header Authorization Bearer,
// depois `accessToken` no body (útil para multipart, ou clientes que
// não setam o header).
export function getToken(request, body){
  try {
    const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    if(auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  } catch(_){ /* ignore */ }
  if(body && typeof body.accessToken === 'string') return body.accessToken;
  return '';
}

// Para multipart/form-data: pegue o accessToken do FormData e passe
// como `{ accessToken }` para requireAuth.
export function getTokenFromForm(request, formData){
  try {
    const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    if(auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  } catch(_){ /* ignore */ }
  if(formData && typeof formData.get === 'function'){
    const v = formData.get('accessToken');
    if(typeof v === 'string') return v;
  }
  return '';
}

// Valida o JWT do Supabase. Retorna sempre um objeto:
//   - { user, token }         quando token válido
//   - { user: null, anon:true } quando não veio token (FAIL-OPEN: deixa
//                               passar; cliente atual ainda não envia)
//   - { user: null, anon:true, warn:'...'} quando token veio mas é
//                               inválido/expirou (FAIL-OPEN também,
//                               não bloqueia para não quebrar fluxos
//                               legados; PRO check vai liberar como
//                               pro:true sem userId).
//
// Quando quisermos endurecer (cliente já manda token sempre + service
// key configurada), basta trocar os warnings por `return { error, status }`
// nesses dois ramos. Por ora, sem quebrar nada.
//
// ATENCAO — requireAuth e FAIL-OPEN POR DESIGN:
//   - Retorna { user: null, anon: true } quando token ausente/invalido/erro
//   - NAO BLOQUEIA o request — cabe ao chamador validar `auth.user`
//   - Use SEMPRE `gateProAI`/`gateProAIForm` em vez de chamar direto, EXCETO
//     em endpoints que precisam ser anonimos (raro)
//   - Se chamar direto, OBRIGATORIO ter:
//       if (!auth.user) return json({error: 'login obrigatorio'}, 401);
//   - moderate.js e o unico caller direto hoje (e ja tem o guard)
export async function requireAuth(env, request, body){
  const token = getToken(request, body);
  if(!token){
    console.warn('requireAuth: sem token — fail-open (anônimo)');
    return { user: null, anon: true };
  }
  const url = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL) + '/auth/v1/user';
  const anon = env.SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;
  try {
    const r = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': anon },
      signal: AbortSignal.timeout(10000)
    });
    if(!r.ok){
      console.warn('requireAuth: token inválido (' + r.status + ') — fail-open');
      return { user: null, anon: true, warn: 'token inválido' };
    }
    const user = await r.json();
    if(!user || !user.id){
      console.warn('requireAuth: resposta sem id — fail-open');
      return { user: null, anon: true, warn: 'usuário inválido' };
    }
    return { user, token };
  } catch(e){
    console.warn('requireAuth: erro de rede — fail-open:', e && e.message);
    return { user: null, anon: true, warn: 'erro de rede' };
  }
}

// Lê profile.is_pro via service role. FAIL-OPEN sempre que faltar
// userId (ex.: requireAuth caiu em anônimo) ou SUPABASE_SERVICE_KEY.
// Retorna { pro:true, checked:false } nesses casos. Só barra (pro:false)
// quando o profile existe E is_pro é false ou pro_expires_at já passou.
export async function requirePro(env, userId){
  if(!userId){
    // sem userId não dá pra consultar — fail-open
    return { pro: true, checked: false };
  }
  // Aceita 3 nomes pra compatibilidade com setups existentes
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey){
    console.warn('requirePro: SUPABASE_SERVICE_ROLE/SUPABASE_SERVICE_KEY não configurada — fail-open');
    return { pro: true, checked: false };
  }
  const url = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL)
    + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId)
    + '&select=is_pro,pro_expires_at';
  try {
    const r = await fetch(url, {
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey
      },
      signal: AbortSignal.timeout(10000)
    });
    if(!r.ok){
      console.warn('requirePro: falha ao consultar profiles', r.status);
      // Service key configurada mas Supabase indisponível: fail-CLOSED.
      // Atacante não bypassa PRO check via DoS no Supabase.
      return { pro: false, checked: false, error: 'verificação indisponível' };
    }
    const rows = await r.json();
    if(!Array.isArray(rows) || rows.length === 0){
      // profile não encontrado: barra (usuário existe no auth mas não tem profile)
      return { pro: false, checked: true };
    }
    const prof = rows[0];
    const notExpired = !prof.pro_expires_at || new Date(prof.pro_expires_at) > new Date();
    return { pro: !!(prof.is_pro && notExpired), checked: true };
  } catch(e){
    console.warn('requirePro: exceção', e && e.message);
    // Service key configurada mas erro de rede ao Supabase: fail-CLOSED.
    return { pro: false, checked: false, error: 'erro de rede' };
  }
}

export function jsonResponse(obj, status = 200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

// Rate limit por (user, endpoint, minuto). Devolve { allowed, count,
// limit, retry_after_seconds }. Fail-open se algo der errado — não
// quer bloquear usuário legítimo por problema de infra.
export async function checkRateLimit(env, userId, endpoint, limit = 30){
  if(!userId) return { allowed: true, skipped: true };
  const serviceKey = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey) return { allowed: true, skipped: true };
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  try {
    const r = await fetch(supaUrl + '/rest/v1/rpc/check_rate_limit', {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_endpoint: endpoint,
        p_limit: limit
      }),
      signal: AbortSignal.timeout(10000)
    });
    if(!r.ok) return { allowed: true, skipped: true };
    const data = await r.json();
    return {
      allowed: !!data?.allowed,
      count: data?.count || 0,
      limit: data?.limit || limit,
      retry_after_seconds: data?.retry_after_seconds || 60
    };
  } catch {
    return { allowed: true, skipped: true };
  }
}

// Helper pra montar a resposta 429 padrão
export function rateLimitResponse(rl){
  return new Response(JSON.stringify({
    error: 'Limite por minuto atingido (' + rl.count + '/' + rl.limit + '). Tente em ' + rl.retry_after_seconds + 's.',
    retry_after: rl.retry_after_seconds
  }), {
    status: 429,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': String(rl.retry_after_seconds || 60)
    }
  });
}

// gateProAI — bundle de requireAuth + requirePro + checkRateLimit.
// Retorna { userId, user, token } se passou, OU uma Response de erro se barrou.
// Uso típico: const g = await gateProAI(env, request, body, { endpoint:'chat-ai', limit:20 });
//             if (g instanceof Response) return g;
//             const userId = g.userId;
export async function gateProAI(env, request, body, { endpoint, limit = 30, requirePro: needPro = true } = {}) {
  const auth = await requireAuth(env, request, body);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status);
  const userId = auth.user && auth.user.id;
  if (needPro) {
    const proCheck = await requirePro(env, userId);
    if (!proCheck.pro) return jsonResponse({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);
  }
  const rl = await checkRateLimit(env, userId, endpoint, limit);
  if (!rl.allowed) return rateLimitResponse(rl);
  return { userId, user: auth.user, token: auth.token };
}

// Variante de gateProAI para endpoints multipart/form-data: extrai o token
// do FormData (via getTokenFromForm) em vez de body.accessToken.
export async function gateProAIForm(env, request, formData, { endpoint, limit = 30, requirePro: needPro = true } = {}) {
  const accessToken = getTokenFromForm(request, formData);
  const auth = await requireAuth(env, request, { accessToken });
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status);
  const userId = auth.user && auth.user.id;
  if (needPro) {
    const proCheck = await requirePro(env, userId);
    if (!proCheck.pro) return jsonResponse({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);
  }
  const rl = await checkRateLimit(env, userId, endpoint, limit);
  if (!rl.allowed) return rateLimitResponse(rl);
  return { userId, user: auth.user, token: auth.token };
}
