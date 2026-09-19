// Investigação 2026-09-19 (headers de segurança ausentes em produção, /,
// /feed, /login, /portal) — achado: o adapter em produção
// (`@cloudflare/next-on-pages`) zera os headers acumulados de
// `next.config.mjs` sempre que a requisição casa com a entrada do
// MIDDLEWARE no routes-manifest interno (`override:true`). Fix: aplicar os
// headers de segurança diretamente no response que `middleware.ts`
// devolve (função `applySecurityHeaders`) — esses SOBREVIVEM porque o
// motor de rotas mergeia de volta os headers que o próprio middleware
// carrega, depois de zerar o resto.
//
// `middleware.ts` virou a ÚNICA fonte destes headers (saíram de
// `next.config.mjs` — declarar nos dois lugares duplicava o valor por
// append, e pra headers de valor único isso vira `"DENY, DENY"`, formato
// que boa parte dos navegadores não reconhece). Sem uma 2ª fonte pra
// comparar, este teste passa a travar os valores GOLDEN diretamente —
// qualquer edição acidental de um valor aqui tem que ser deliberada.
// `cspHeadersParidade.test.ts` cobre o outro par que ainda existe
// (`_headers` da raiz vs. este arquivo).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

type HeaderPair = [string, string];

function headersArrayFromMiddleware(constName: 'SECURITY_HEADERS' | 'API_CORS_HEADERS'): HeaderPair[] {
  const raw = readFileSync('middleware.ts', 'utf8');
  const re = new RegExp(`const ${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`);
  const blockMatch = raw.match(re);
  if (!blockMatch) {
    throw new Error(`middleware.ts: constante ${constName} não encontrada no formato esperado`);
  }
  const body = blockMatch[1];
  const pairs: HeaderPair[] = [];
  const entryRe = /\[\s*'([^']+)',\s*\n?\s*(?:'((?:[^'\\]|\\.)*)'|SECURITY_CSP)\s*,?\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body))) {
    const key = m[1];
    const value = m[2] !== undefined ? m[2].replace(/\\'/g, "'") : cspFromMiddleware(raw);
    pairs.push([key, value]);
  }
  if (pairs.length === 0) {
    throw new Error(`middleware.ts: nenhum header extraído de ${constName}`);
  }
  return pairs;
}

function cspFromMiddleware(raw: string): string {
  const m = raw.match(/const SECURITY_CSP =\s*\n?\s*"([^"]*)"/);
  if (!m) throw new Error('middleware.ts sem `const SECURITY_CSP = "..."` no formato esperado');
  return m[1];
}

const EXPECTED_SECURITY_HEADERS: HeaderPair[] = [
  [
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://*.sentry-cdn.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: data: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.onrender.com https://challenges.cloudflare.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://sentry.io https://*.sentry.io https://cdn.jsdelivr.net https://storage.googleapis.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests",
  ],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'],
  ['X-Frame-Options', 'DENY'],
  [
    'Permissions-Policy',
    'microphone=(self), camera=(self), geolocation=(self), payment=(self), accelerometer=(), gyroscope=(), magnetometer=(), usb=()',
  ],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
];

const EXPECTED_API_CORS_HEADERS: HeaderPair[] = [
  ['Access-Control-Allow-Origin', 'https://queroumacor.com.br'],
  ['Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'],
  ['Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256, X-Internal-Secret'],
  ['Access-Control-Max-Age', '600'],
  ['Vary', 'Origin'],
];

describe('middleware.ts — valores golden dos headers de segurança/CORS', () => {
  it('SECURITY_HEADERS bate com o esperado (CSP, X-Frame-Options, Permissions-Policy, COOP, CORP, ...)', () => {
    expect(headersArrayFromMiddleware('SECURITY_HEADERS')).toEqual(EXPECTED_SECURITY_HEADERS);
  });

  it('API_CORS_HEADERS bate com o esperado', () => {
    expect(headersArrayFromMiddleware('API_CORS_HEADERS')).toEqual(EXPECTED_API_CORS_HEADERS);
  });
});
