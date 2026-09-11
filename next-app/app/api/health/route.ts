// app/api/health/route.ts — port de `functions/api/health.js` (vanilla) +
// `functions/api/_services/health.js`. Health check público pra uptime
// monitoring (UptimeRobot, Cloudflare Health Checks). Sempre 200; body
// conta o que está saudável.
//
// Diferenças do vanilla:
//   - `cf.colo` não está disponível direto no Next edge runtime — usamos
//     `getRuntimeEnv('VERCEL_REGION')` / `CF_REGION` quando deployed em Vercel /
//     CF Pages via `@cloudflare/next-on-pages`. Fica `unknown` em dev local.
//   - `env.CF_PAGES_COMMIT_SHA` substituído por `NEXT_PUBLIC_APP_VERSION`
//     (setar via Cloudflare Pages build env quando portarmos o deploy).

import { NextResponse, type NextRequest } from 'next/server';
// No edge do Cloudflare a env-var só existe no request context — process.env
// volta vazio. Ver lib/api/env.ts.
import { getRuntimeEnv } from '@/lib/api/env';
import { resolveSupabaseEnv } from '@/lib/api/security';

export const runtime = 'edge';

const SUPABASE_TIMEOUT_MS = 2000;

// Marcador do build. Serve pra responder "o deploy já subiu?" sem depender
// de env-var nenhuma: basta abrir /api/health e comparar com o que o repo
// tem. Bumpar a cada feature cujo deploy a gente precise confirmar.
const BUILD_MARKER = 'brand-logos-2026-08-22';

export async function GET(request: NextRequest) {
  // Par ÚNICO via resolveSupabaseEnv: url e chave sempre do mesmo prefixo.
  // Antes cada ponto do código rolava a própria ordem e eles discordavam —
  // foi o que produziu o par cruzado do incidente de 2026-09-04.
  let supabaseUrl = '';
  let anonKey = '';
  try {
    const env = resolveSupabaseEnv();
    supabaseUrl = env.url;
    anonKey = env.anonKey;
  } catch {
    // sem par completo: `supabase:false` abaixo já reporta
  }
  let supabaseLive = false;
  if (supabaseUrl) {
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
        headers: anonKey ? { apikey: anonKey } : {},
        signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
      });
      // 401/404 são respostas válidas (Supabase respondeu). Só "false"
      // quando a request nem completa (timeout/erro de rede).
      supabaseLive = res.status > 0;
    } catch {
      supabaseLive = false;
    }
  }

  // `x-request-id` setado pelo middleware. Eco no body facilita debug
  // ("UptimeRobot tá vendo X, qual request foi?").
  const requestId = request.headers.get('x-request-id') ?? 'unknown';

  return NextResponse.json(
    {
      status: 'ok',
      time: new Date().toISOString(),
      app: 'queroumacorapp',
      region: getRuntimeEnv('VERCEL_REGION') || getRuntimeEnv('CF_REGION') || 'unknown',
      version: getRuntimeEnv('NEXT_PUBLIC_APP_VERSION') || 'dev',
      build: BUILD_MARKER,
      supabase: supabaseLive,
      request_id: requestId,
    },
    {
      headers: {
        'cache-control': 'no-store',
        // Pentest Strix (2026-09-11): era '*'. Monitor externo (UptimeRobot,
        // curl) não passa por CORS; só navegador de OUTRA origem perde — e
        // não há quem legitimamente leia isto de fora do próprio domínio.
        // Header da rota VENCE o de `next.config` (comprovado no wrangler).
        'access-control-allow-origin': 'https://queroumacor.com.br',
        'x-request-id': requestId,
      },
    }
  );
}
