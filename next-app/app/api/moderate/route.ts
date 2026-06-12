// app/api/moderate/route.ts — port de `functions/api/moderate.js`.
// NÃO usa gateProAI — moderate é livre pra todos os logados (não PRO-only)
// porque qualquer post passa por moderação. Auth obrigatório.
//
// Wave 29 (C4): aceita `mediaUrl` opcional. Quando presente, baixa a
// mídia, calcula SHA-256 e checa contra a deny-list `media_hash_blocklist`.
// Hit → curto-circuito (não chama Gemini, retorna flagged=true). Miss →
// segue fluxo Gemini normal; se severity for high+/hard → enqueue em
// `media_review_queue` pra revisão admin. Backward-compatible com callers
// que mandam só `text`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  gateAiUsage,
  rateLimitResponse,
  recordAiUsage,
  requireAuth,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { moderateContent } from '@/lib/api/_services/moderate';
import {
  hashMedia,
  checkHashBlocklist,
  enqueueMediaReview,
} from '@/lib/api/mediaHash';
import { moderateSchema, formatZodError } from '@/lib/api/schemas/moderate';

export const runtime = 'edge';

// Tamanho máximo da mídia baixada pra hash. Bucket `posts` permite 50MB
// mas pra hash + scan rápido capamos em 20MB (vídeos grandes não precisam
// de hash no path crítico — moderate-video cuida).
const MAX_HASH_BYTES = 20 * 1024 * 1024;
const HASH_FETCH_TIMEOUT_MS = 8000;

function isAllowedMediaHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    if (!/^[A-Za-z0-9-]+\.supabase\.co$/.test(u.hostname)) return false;
    return u.pathname.startsWith('/storage/');
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        flagged: false,
        error: 'GEMINI_API_KEY não configurada',
        engine: 'none',
      },
      { status: 503 }
    );
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = moderateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodError(parsed.error.issues), { status: 400 });
  }
  const body = parsed.data;
  const auth = await requireAuth(request, body);
  if (auth.error)
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  if (!auth.user)
    return NextResponse.json({ error: 'Faça login' }, { status: 401 });
  const rl = await checkRateLimit({
    userId: auth.user.id,
    endpoint: 'moderate',
    limit: 20,
  });
  if (!rl.allowed) return rateLimitResponse(rl);
  const aiGate = await gateAiUsage({
    userId: auth.user.id,
    email: auth.user.email,
    feature: 'moderate',
  });
  if (aiGate instanceof NextResponse) return aiGate;

  const mediaUrl = body.mediaUrl ?? '';
  const postId = body.postId ?? null;
  const userId = auth.user.id;

  // ── (1) Hash + blocklist check ──────────────────────────────────────
  let mediaHash = '';
  if (mediaUrl && isAllowedMediaHost(mediaUrl)) {
    try {
      const r = await fetch(mediaUrl, {
        signal: AbortSignal.timeout(HASH_FETCH_TIMEOUT_MS),
      });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 0 && buf.byteLength <= MAX_HASH_BYTES) {
          mediaHash = await hashMedia(buf);
        }
      }
    } catch {
      // Falha de fetch/hash não bloqueia moderação — segue só com Gemini.
    }
  }

  if (mediaHash) {
    const hit = await checkHashBlocklist(mediaHash);
    if (hit.blocked) {
      // Curto-circuito: não gasta cota de Gemini quando já sabemos que
      // o conteúdo é proibido. Enfileira na review queue como crítico
      // (admin precisa decidir ação — ban, NCMEC report etc.).
      await enqueueMediaReview({
        postId,
        userId,
        mediaUrl,
        mediaHash,
        reason: `blocklist:${hit.category || 'reported'}`,
        severity: hit.category === 'csam' ? 'critical' : 'high',
      });
      return NextResponse.json({
        flagged: true,
        approved: false,
        severity: 'hard',
        reasons: ['media_blocked'],
        category: hit.category,
        mediaHash,
        engine: 'blocklist',
      });
    }
  }

  // ── (2) Gemini moderation normal ────────────────────────────────────
  try {
    const result = await moderateContent({
      text: body.text,
      imageUrl: body.imageUrl ?? (mediaUrl || undefined),
    });
    await recordAiUsage({ userId, feature: 'moderate' });

    // ── (3) Enqueue review pra severidade hard ou flagged + media ────
    // Soft normalmente vira "revisar humano"; hard = bloqueio. Em ambos
    // os casos, se temos mídia, queremos rastrear pra futura adição na
    // blocklist (operação humana via dashboard admin).
    if (
      mediaUrl &&
      mediaHash &&
      (result.severity === 'hard' || (result.flagged && result.severity === 'soft'))
    ) {
      await enqueueMediaReview({
        postId,
        userId,
        mediaUrl,
        mediaHash,
        reason: result.reasons.length > 0 ? result.reasons.join(',') : 'gemini_flagged',
        severity: result.severity === 'hard' ? 'high' : 'med',
      });
    }

    return NextResponse.json({
      ...result,
      approved: !result.flagged || result.severity === 'soft',
      mediaHash: mediaHash || undefined,
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('moderate crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
