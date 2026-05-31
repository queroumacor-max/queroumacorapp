// app/api/health/route.ts — port de `functions/api/health.js` (vanilla) +
// `functions/api/_services/health.js`. Health check público pra uptime
// monitoring (UptimeRobot, Cloudflare Health Checks). Sempre 200; body
// conta o que está saudável.
//
// Diferenças do vanilla:
//   - `cf.colo` não está disponível direto no Next edge runtime — usamos
//     `process.env.VERCEL_REGION` / `CF_REGION` quando deployed em Vercel /
//     CF Pages via `@cloudflare/next-on-pages`. Fica `unknown` em dev local.
//   - `env.CF_PAGES_COMMIT_SHA` substituído por `NEXT_PUBLIC_APP_VERSION`
//     (setar via Cloudflare Pages build env quando portarmos o deploy).

import { NextResponse } from 'next/server';

export const runtime = 'edge';

const SUPABASE_TIMEOUT_MS = 2000;

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  let supabaseLive = false;
  if (supabaseUrl) {
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
        headers: process.env.SUPABASE_ANON_KEY ? { apikey: process.env.SUPABASE_ANON_KEY } : {},
        signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
      });
      // 401/404 são respostas válidas (Supabase respondeu). Só "false"
      // quando a request nem completa (timeout/erro de rede).
      supabaseLive = res.status > 0;
    } catch {
      supabaseLive = false;
    }
  }

  return NextResponse.json(
    {
      status: 'ok',
      time: new Date().toISOString(),
      app: 'queroumacorapp',
      region: process.env.VERCEL_REGION || process.env.CF_REGION || 'unknown',
      version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
      supabase: supabaseLive,
    },
    {
      headers: {
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    }
  );
}
