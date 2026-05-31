// lib/api/_services/admin-moderate.ts — port de
// `functions/api/_services/admin-moderate.js`. Fila de moderação admin
// (approve/reject de posts). Service role pra patch direto, com remoção
// best-effort de mídia no storage quando rejeita.

import { ServiceError, getServiceKey, getSupabaseUrl } from '../security';

const TIMEOUT_MS = 10000;

export type ModerateAction = 'approve' | 'reject';

function ctx(): { supaUrl: string; sHeaders: Record<string, string> } {
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Moderação admin não configurada', 503);
  const supaUrl = getSupabaseUrl();
  return {
    supaUrl,
    sHeaders: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
  };
}

export async function approvePost(args: { postId: string }): Promise<{ ok: true }> {
  const { postId } = args;
  if (!postId) throw new ServiceError('postId obrigatório', 400);
  const { supaUrl, sHeaders } = ctx();
  const r = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
    method: 'PATCH',
    headers: { ...sHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'approved' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    console.warn('admin-moderate approve supabase error', r.status, txt);
    throw new ServiceError('Falha temporária na consulta — tente de novo', 502);
  }
  return { ok: true };
}

export async function rejectPost(args: { postId: string }): Promise<{ ok: true }> {
  const { postId } = args;
  if (!postId) throw new ServiceError('postId obrigatório', 400);
  const { supaUrl, sHeaders } = ctx();

  // Pega a mídia pra remover do storage (best-effort — segue mesmo sem)
  let mediaUrl = '';
  try {
    const g = await fetch(
      `${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}&select=media_url`,
      { headers: sHeaders, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const arr = (await g.json()) as Array<{ media_url?: string }>;
    mediaUrl = arr?.[0]?.media_url || '';
  } catch {
    /* segue mesmo sem */
  }

  const d = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: { ...sHeaders, Prefer: 'return=minimal' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!d.ok) {
    const txt = (await d.text()).slice(0, 300);
    console.warn('admin-moderate reject supabase error', d.status, txt);
    throw new ServiceError('Falha temporária na consulta — tente de novo', 502);
  }

  if (mediaUrl && mediaUrl.includes('/posts/')) {
    const rawPath = mediaUrl.split('/posts/').pop() || '';
    // Anti-traversal: bloqueia .. e URL-encoded ..
    const path =
      /^[A-Za-z0-9_\-./]+$/.test(rawPath) &&
      !rawPath.includes('..') &&
      !rawPath.includes('%2E') &&
      !rawPath.includes('%2e')
        ? rawPath
        : null;
    if (path) {
      try {
        await fetch(`${supaUrl}/storage/v1/object/posts/${path}`, {
          method: 'DELETE',
          headers: sHeaders,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        /* best-effort */
      }
    }
  }
  return { ok: true };
}

export async function moderateAction(args: {
  action: ModerateAction;
  postId: string;
}): Promise<{ ok: true }> {
  if (args.action === 'approve') return approvePost({ postId: args.postId });
  if (args.action === 'reject') return rejectPost({ postId: args.postId });
  throw new ServiceError('ação inválida', 400);
}
