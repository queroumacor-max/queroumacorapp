// app/api/auth-rate-check/route.ts — port de `functions/api/auth-rate-check.js`.
// Rate limit defensivo de auth por IP. Cliente chama ANTES de bater na auth
// do Supabase pra economizar request e dificultar brute force.

import { type NextRequest, NextResponse } from 'next/server';
import { jsonResponse, rateLimitResponse, ServiceError, serviceErrorResponse } from '@/lib/api/security';
import { checkAuthRateLimit } from '@/lib/api/_services/auth-rate-check';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  let body: { action?: unknown } = {};
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    /* sem body é OK */
  }
  try {
    const action = typeof body?.action === 'string' ? body.action : 'login';
    const ip =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') ||
      'unknown';
    const result = await checkAuthRateLimit({ action, ip });
    if (!result.allowed) {
      return rateLimitResponse({
        allowed: false,
        count: result.count,
        limit: result.limit,
        retry_after_seconds: result.retry_after_seconds,
      });
    }
    return jsonResponse({
      allowed: true,
      action: result.action,
      limit: result.limit,
      skipped: !!result.skipped,
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('auth-rate-check crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
