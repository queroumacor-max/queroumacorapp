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

const FALLBACK_SUPABASE_URL = 'https://uwqebaqweehiljsqkifm.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cWViYXF3ZWVoaWxqc3FraWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjYzMjgsImV4cCI6MjA4OTgwMjMyOH0.yp-z4iMifiOV3ftLVIHOFEQBLcMBdU8VFok7VKlSFg8';

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
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': anon }
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
      }
    });
    if(!r.ok){
      console.warn('requirePro: falha ao consultar profiles', r.status);
      return { pro: true, checked: false }; // fail-open em erro
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
    return { pro: true, checked: false }; // fail-open
  }
}

export function jsonResponse(obj, status = 200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
