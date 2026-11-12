// k6 load test — dois perfis, escolhidos pela env PROFILE:
//
//   basic (default): só os endpoints públicos leves do app
//     (/api/health, /api/cidades). Mede o edge do Cloudflare Workers.
//     NÃO toca nas rotas que pesam; serve de smoke de disponibilidade.
//
//   completo: simula NAVEGAÇÃO real de usuário logado — feed, busca,
//     trending e catálogo da loja. Essas chamadas vão DIRETO ao
//     PostgREST do Supabase (é assim que o app faz no navegador), que é
//     onde a escala realmente dói (custo de RPC, RLS e pool de conexão).
//     Precisa de um JWT de usuário de teste (login no setup).
//
// Carga: VUS usuários simultâneos no platô (default 50; passe VUS=100),
// rampa de 1min na subida e 30s na descida, DURATION de platô (default 3m),
// com think-time aleatório por iteração pra parecer gente, não martelo.
//
// Rodar local (basic):
//   BASE_URL=https://alvo k6 run scripts/load-test.js
//
// Rodar local (completo):
//   PROFILE=completo VUS=100 DURATION=3m \
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=<anon> \
//   LOAD_TEST_EMAIL=<conta de teste> LOAD_TEST_PASSWORD=<senha> \
//   k6 run scripts/load-test.js
//
// ATENÇÃO (perfil completo): bate no Supabase de PRODUÇÃO — é o único
// banco que existe. São SÓ LEITURAS (feed/busca/trending/produtos), não
// grava nada, mas carrega o DB real; rode com consciência e de olho no
// painel do Supabase (Reports → Database: conexões e slow queries).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { b64decode } from 'k6/encoding';

const PROFILE = (__ENV.PROFILE || 'basic').toLowerCase();
const VUS = parseInt(__ENV.VUS || '50', 10);
const DURATION = __ENV.DURATION || '3m';

export const options = {
  scenarios: {
    carga: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    // Falha global baixa (inclui qualquer status != 2xx/3xx).
    http_req_failed: ['rate<0.02'],
    // Endpoints leves do perfil basic.
    'http_req_duration{endpoint:health}': ['p(95)<500'],
    'http_req_duration{endpoint:cidades}': ['p(95)<800'],
    // RPCs pesadas do Supabase — metas realistas (feed/busca custam mais
    // que um health check; p95<500ms ali seria meta de mentira).
    'http_req_duration{endpoint:feed}': ['p(95)<1000', 'p(99)<2500'],
    'http_req_duration{endpoint:busca}': ['p(95)<1200', 'p(99)<3000'],
    'http_req_duration{endpoint:trending}': ['p(95)<1000', 'p(99)<2500'],
    'http_req_duration{endpoint:produtos}': ['p(95)<1000'],
  },
};

// setup() roda uma vez: valida env e, no completo, faz UM login pra obter
// o JWT compartilhado pelos VUs (é token de usuário, não service role —
// mesma exposição do navegador).
export function setup() {
  if (PROFILE !== 'completo') {
    const base = __ENV.BASE_URL;
    if (!base) {
      throw new Error('basic: defina BASE_URL (ex.: BASE_URL=https://alvo k6 run scripts/load-test.js)');
    }
    return { profile: 'basic', base };
  }

  const url = __ENV.SUPABASE_URL;
  const anon = __ENV.SUPABASE_ANON_KEY;
  const email = __ENV.LOAD_TEST_EMAIL;
  const pass = __ENV.LOAD_TEST_PASSWORD;
  if (!url || !anon) throw new Error('completo: defina SUPABASE_URL e SUPABASE_ANON_KEY');
  if (!email || !pass) throw new Error('completo: defina LOAD_TEST_EMAIL e LOAD_TEST_PASSWORD (conta de teste real)');

  const res = http.post(
    `${url}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password: pass }),
    { headers: { apikey: anon, 'Content-Type': 'application/json' } },
  );
  if (res.status !== 200) {
    throw new Error(`completo: login da conta de teste falhou (${res.status}). Confira e-mail/senha e se a conta tem e-mail confirmado.`);
  }
  const token = String(res.json('access_token') || '');
  if (!token) throw new Error('completo: login não devolveu access_token');

  // uid = claim `sub` do JWT (base64url do payload). get_feed_v2 hoje deriva
  // o usuário de auth.uid() e ignora p_user_id, mas a assinatura ainda pede
  // o argumento — mandamos o próprio sub pra bater com o shape do app.
  let uid = '';
  try {
    const payload = JSON.parse(b64decode(token.split('.')[1], 'rawurl', 's'));
    uid = payload.sub || '';
  } catch (_e) {
    uid = '';
  }

  return { profile: 'completo', url, anon, token, uid, appUrl: __ENV.APP_URL || '' };
}

function pct(p) {
  return Math.random() < p;
}

export default function (data) {
  if (data.profile !== 'completo') {
    const base = data.base;
    const r1 = http.get(`${base}/api/health`, { tags: { endpoint: 'health' } });
    check(r1, { 'health 200': (r) => r.status === 200 });
    const r2 = http.get(`${base}/api/cidades?uf=SP`, { tags: { endpoint: 'cidades' } });
    check(r2, { 'cidades 200': (r) => r.status === 200 });
    sleep(1 + Math.random() * 2);
    return;
  }

  const { url, anon, token, uid } = data;
  const h = {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  // 1) Feed — toda iteração (é o que mais abre no app).
  const feed = http.post(
    `${url}/rest/v1/rpc/get_feed_v2`,
    JSON.stringify({ p_limit: 20, p_cursor: null, p_user_id: uid, p_following_ids: null, p_role_filter: null }),
    Object.assign({ tags: { endpoint: 'feed' } }, h),
  );
  check(feed, { 'feed 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(1 + Math.random() * 2);

  // 2) Busca — metade das iterações.
  if (pct(0.5)) {
    const termos = ['pintura', 'grafite', 'textura', 'parede', 'fachada', 'reforma'];
    const q = termos[Math.floor(Math.random() * termos.length)];
    const s = http.post(
      `${url}/rest/v1/rpc/search_all`,
      JSON.stringify({ p_query: q, p_limit: 20 }),
      Object.assign({ tags: { endpoint: 'busca' } }, h),
    );
    check(s, { 'busca 2xx': (r) => r.status >= 200 && r.status < 300 });
    sleep(0.5 + Math.random() * 1.5);
  }

  // 3) Trending — ~1/3 das iterações (tela "Em alta").
  if (pct(0.33)) {
    const t = http.post(
      `${url}/rest/v1/rpc/get_trending_posts`,
      JSON.stringify({ p_limit: 20, p_window_days: 7 }),
      Object.assign({ tags: { endpoint: 'trending' } }, h),
    );
    check(t, { 'trending 2xx': (r) => r.status >= 200 && r.status < 300 });
  }

  // 4) Catálogo da loja — ~1/3 das iterações (leitura pública de products).
  if (pct(0.33)) {
    const p = http.get(
      `${url}/rest/v1/products?select=id,name,price,image_url&limit=30`,
      Object.assign({ tags: { endpoint: 'produtos' } }, h),
    );
    check(p, { 'produtos 2xx': (r) => r.status >= 200 && r.status < 300 });
  }

  sleep(0.5 + Math.random());
}
