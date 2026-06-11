// lib/api/mediaHash.ts — helpers de hashing + blocklist + review queue
// pra camada de CSAM scanning (C4 do RELEASE_AUDIT).
//
// Edge-runtime compatível: usa `crypto.subtle.digest` (SHA-256), `fetch`
// direto contra REST API do Supabase com service_role (sem
// `@supabase/supabase-js` no edge pra não inflar bundle nem depender de
// fetch wrappers que algumas runtimes não suportam).
//
// Filosofia:
//   - hashMedia retorna string vazia se input é vazio (não throw — caller
//     já valida antes).
//   - checkHashBlocklist falha-aberta (retorna { blocked: false }) quando
//     service_role ausente ou Supabase indisponível. CSAM blocking é
//     DEFENSE-IN-DEPTH; o gate primário é Cloudflare CSAM Scanning Tool
//     + Gemini moderation. Se nossa blocklist quebrar, não trava o app.
//   - enqueueMediaReview falha-aberta também (log + return). Perder
//     telemetria de review é menos ruim que travar publicação legítima.

import { getServiceKey, getSupabaseUrl } from './security';

const SUPA_TIMEOUT_MS = 8000;

/**
 * SHA-256 do binário em hex (64 chars lowercase). Edge-runtime friendly.
 * Aceita ArrayBuffer ou Blob; converte Blob via `.arrayBuffer()`.
 */
export async function hashMedia(blob: ArrayBuffer | Blob): Promise<string> {
  const buf =
    blob instanceof ArrayBuffer ? blob : await blob.arrayBuffer();
  if (buf.byteLength === 0) return '';
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bufToHex(digest);
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16);
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}

export interface BlocklistMatch {
  blocked: boolean;
  category?: 'csam' | 'abuse' | 'spam' | 'reported';
  id?: string;
}

/**
 * Lookup na deny-list via service_role REST. Retorna `{ blocked: true }`
 * se o hash bate exato. Fail-open em config faltando ou erro de rede.
 */
export async function checkHashBlocklist(hash: string): Promise<BlocklistMatch> {
  if (!hash || typeof hash !== 'string') return { blocked: false };
  const serviceKey = getServiceKey();
  if (!serviceKey) return { blocked: false };
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return { blocked: false };
  }
  const url =
    `${supaUrl}/rest/v1/media_hash_blocklist` +
    `?hash=eq.${encodeURIComponent(hash)}` +
    `&select=id,category` +
    `&limit=1`;
  try {
    const r = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    });
    if (!r.ok) return { blocked: false };
    const rows = (await r.json()) as Array<{ id?: string; category?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) return { blocked: false };
    const row = rows[0];
    const cat = row.category;
    const validCat: BlocklistMatch['category'] | undefined =
      cat === 'csam' || cat === 'abuse' || cat === 'spam' || cat === 'reported'
        ? cat
        : undefined;
    return {
      blocked: true,
      category: validCat,
      id: typeof row.id === 'string' ? row.id : undefined,
    };
  } catch {
    return { blocked: false };
  }
}

export interface EnqueueReviewArgs {
  postId?: string | null;
  userId: string;
  mediaUrl: string;
  mediaHash: string;
  reason: string;
  severity: 'low' | 'med' | 'high' | 'critical';
}

/**
 * Insere row em `media_review_queue` via service_role. Fail-open: log
 * + return em qualquer falha — não trava o caller.
 */
export async function enqueueMediaReview(args: EnqueueReviewArgs): Promise<void> {
  if (!args.userId || !args.mediaUrl || !args.reason) return;
  const serviceKey = getServiceKey();
  if (!serviceKey) return;
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return;
  }
  const payload: Record<string, unknown> = {
    user_id: args.userId,
    media_url: args.mediaUrl,
    media_hash: args.mediaHash || null,
    reason: args.reason,
    severity: args.severity,
    status: 'pending',
  };
  if (args.postId) payload.post_id = args.postId;

  try {
    const r = await fetch(`${supaUrl}/rest/v1/media_review_queue`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.warn(
        'enqueueMediaReview: insert falhou',
        r.status,
        (await r.text()).slice(0, 200),
      );
    }
  } catch (e) {
    console.warn(
      'enqueueMediaReview: exceção',
      e instanceof Error ? e.message : e,
    );
  }
}
