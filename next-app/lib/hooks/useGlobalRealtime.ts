// useGlobalRealtime — subscriptions Supabase Realtime para tabelas públicas
// que afetam a sensação Instagram/TikTok do app:
//   - posts (INSERT)  → invalida ['feed'] quando alguém posta novo
//   - comments (INSERT) → invalida ['post-comments', postId] e ['feed']
//   - likes (INSERT/DELETE) → invalida ['post-like', postId] e ['feed']
//   - stories (INSERT) → invalida ['stories']
//   - follows (INSERT/DELETE) → invalida ['following-ids', userId] e
//     ['follow-state', targetId, userId]
//   - jobs (UPDATE/INSERT) → invalida ['financeiro', userId], ['agenda', userId]
//   - points (INSERT) → invalida ['points', userId]
//
// Decisões:
//  - 1 canal único por user (não 1 por tabela) — Supabase aceita múltiplos
//    listeners no mesmo channel.subscribe(). Menos overhead de WS.
//  - Throttle inteligente: para feed/likes (alto volume), uso setTimeout
//    pra dar batch de invalidações em 300ms — se 10 likes chegam em 500ms,
//    1 refetch só.
//  - Filtro pra likes/comments NÃO existe (nenhum filtro por post) porque
//    queremos updates de qualquer post (UI decide se importa). Custo: tráfego
//    extra pro WS. Aceitável até o app escalar.
//
// Mount-once em AppShell via RealtimeBindings.

'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

// Throttler simples: agrupa invalidates em <ms> ms.
class Debouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Set<string>();
  constructor(private readonly ms: number, private readonly flush: (keys: string[]) => void) {}
  schedule(key: string) {
    this.pending.add(key);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      const keys = Array.from(this.pending);
      this.pending.clear();
      this.timer = null;
      this.flush(keys);
    }, this.ms);
  }
  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.pending.clear();
    this.timer = null;
  }
}

function invalidateByKeys(qc: QueryClient, keys: string[]) {
  for (const k of keys) {
    const parts = k.split('|');
    qc.invalidateQueries({ queryKey: parts });
  }
}

export function useGlobalRealtime(userId: string | null): void {
  const qc = useQueryClient();
  const debouncerRef = useRef<Debouncer | null>(null);

  useEffect(() => {
    if (!userId) return;
    const sb = getSupabase();

    const debouncer = new Debouncer(300, (keys) => invalidateByKeys(qc, keys));
    debouncerRef.current = debouncer;

    const channel = sb
      .channel('global-' + userId)
      // ── POSTS: novo post de qualquer user → feed atualiza
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        () => {
          debouncer.schedule('feed');
          debouncer.schedule('stories');
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts' },
        () => {
          // UPDATE pode ser soft-delete, status change, etc.
          debouncer.schedule('feed');
        },
      )
      // ── COMMENTS: invalida o cache de comentários do post (geral)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments' },
        (payload) => {
          const postId = (payload.new as { post_id?: string } | null)?.post_id;
          if (postId) debouncer.schedule(`post-comments|${postId}`);
          debouncer.schedule('feed');
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'comments' },
        (payload) => {
          const postId = (payload.new as { post_id?: string } | null)?.post_id;
          if (postId) debouncer.schedule(`post-comments|${postId}`);
        },
      )
      // ── LIKES: contador de likes atualiza vendo outros curtirem
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'likes' },
        (payload) => {
          const postId = (payload.new as { post_id?: string } | null)?.post_id;
          if (postId) debouncer.schedule(`post-like|${postId}`);
          debouncer.schedule('feed');
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'likes' },
        (payload) => {
          // DELETE não traz `new`; old tem o post_id.
          const postId = (payload.old as { post_id?: string } | null)?.post_id;
          if (postId) debouncer.schedule(`post-like|${postId}`);
          debouncer.schedule('feed');
        },
      )
      // ── FOLLOWS: contadores e estado de follow
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'follows' },
        (payload) => {
          const row = payload.new as
            | { follower_id?: string; following_id?: string }
            | null;
          if (row?.follower_id) {
            debouncer.schedule(`following-ids|${row.follower_id}`);
          }
          if (row?.following_id) {
            debouncer.schedule(`followers|${row.following_id}`);
            debouncer.schedule(`profile|${row.following_id}`);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'follows' },
        (payload) => {
          const row = payload.old as
            | { follower_id?: string; following_id?: string }
            | null;
          if (row?.follower_id) {
            debouncer.schedule(`following-ids|${row.follower_id}`);
          }
          if (row?.following_id) {
            debouncer.schedule(`followers|${row.following_id}`);
            debouncer.schedule(`profile|${row.following_id}`);
          }
        },
      )
      // ── JOBS: agenda/financeiro do PINTOR atual (filter painter_id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
          filter: `painter_id=eq.${userId}`,
        },
        () => {
          debouncer.schedule(`financeiro|${userId}`);
          debouncer.schedule(`jobs|${userId}`);
          debouncer.schedule(`agenda|${userId}`);
        },
      )
      // ── POINTS: saldo do user atual (filter user_id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'points',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          debouncer.schedule(`points|${userId}`);
        },
      )
      .subscribe();

    return () => {
      debouncer.dispose();
      sb.removeChannel(channel);
    };
  }, [userId, qc]);
}
