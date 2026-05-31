// @ts-check
// Business logic — fila de moderação admin (approve/reject de posts).
import { ServiceError, FALLBACK_SUPABASE_URL } from '../_security.js';
import { getServiceKey } from './_admin.js';

const TIMEOUT_MS = 10000;

/**
 * Approve um post. Throw ServiceError em falha.
 * @param {{ env: Record<string,string>, postId: string }} args
 * @returns {Promise<{ ok: true }>}
 */
export async function approvePost({ env, postId }) {
  if (!postId) throw new ServiceError('postId obrigatório', 400);
  const { supaUrl, sHeaders } = ctx(env);
  const r = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
    method: 'PATCH',
    headers: { ...sHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ status: 'approved' }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    console.warn('admin-moderate approve supabase error', r.status, txt);
    throw new ServiceError('Falha temporária na consulta — tente de novo', 502);
  }
  return { ok: true };
}

/**
 * Rejeita um post: DELETE + tenta remover media do storage.
 * @param {{ env: Record<string,string>, postId: string }} args
 * @returns {Promise<{ ok: true }>}
 */
export async function rejectPost({ env, postId }) {
  if (!postId) throw new ServiceError('postId obrigatório', 400);
  const { supaUrl, sHeaders } = ctx(env);
  // Pega a mídia pra remover do storage
  let mediaUrl = '';
  try {
    const g = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}&select=media_url`, {
      headers: sHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const arr = await g.json();
    mediaUrl = arr?.[0]?.media_url || '';
  } catch { /* segue mesmo sem a mídia */ }

  const d = await fetch(`${supaUrl}/rest/v1/posts?id=eq.${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: { ...sHeaders, 'Prefer': 'return=minimal' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!d.ok) {
    const txt = (await d.text()).slice(0, 300);
    console.warn('admin-moderate reject supabase error', d.status, txt);
    throw new ServiceError('Falha temporária na consulta — tente de novo', 502);
  }

  if (mediaUrl && mediaUrl.includes('/posts/')) {
    const rawPath = mediaUrl.split('/posts/').pop() || '';
    // Anti-traversal: bloqueia .. e URL-encoded ..
    const path = (/^[A-Za-z0-9_\-./]+$/.test(rawPath) && !rawPath.includes('..') && !rawPath.includes('%2E') && !rawPath.includes('%2e'))
      ? rawPath : null;
    if (path) {
      try {
        await fetch(`${supaUrl}/storage/v1/object/posts/${path}`, {
          method: 'DELETE',
          headers: sHeaders,
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
      } catch { /* best-effort */ }
    }
  }
  return { ok: true };
}

function ctx(env) {
  const serviceKey = getServiceKey(env);
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const sHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };
  return { supaUrl, sHeaders };
}
