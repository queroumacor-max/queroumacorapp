// NotificationsList — client component que renderiza a lista de notificações
// do usuário. Espelha o output de `loadNotifications()` em modules/notif.js
// (skeleton enquanto carrega, empty state quando vazio, card-por-linha quando
// tem dados, error state com retry quando estoura). Diferenças vs vanilla:
//
//  - cache + revalidação delegada ao TanStack Query via useNotifications();
//  - "marcar como lida" é UI-driven (botão por linha + "Marcar todas") em vez
//    do auto-clear de badge ao abrir a tela (pattern do sininho desktop);
//  - sem fontes extras (likes/comments/announcements) — só lê de
//    `notifications`. As outras fontes que o vanilla agregava no client
//    devem ser gravadas via `notify_user()` (RPC) pra aparecerem aqui. Esse
//    é o caminho que a feature já tá tomando (eventos `post.liked` etc.
//    disparam notify(), ver modules/notif.js linha 188+).

'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useNotifications } from '@/lib/hooks/useNotifications';
import type { Notification } from '@/lib/types';

// Ícone por tipo — fallback "🔔" pra tipos novos não listados, mantendo a UX
// graciosa quando o backend introduzir novas categorias antes do front.
function iconFor(type?: string | null): string {
  switch (type) {
    case 'like':
      return '🖌️';
    case 'comment':
      return '💬';
    case 'follow':
      return '👤';
    case 'message':
      return '✉️';
    case 'quote_sent':
      return '📄';
    case 'quote_approved':
      return '🎉';
    case 'order':
      return '📦';
    case 'review':
      return '⭐';
    case 'announcement':
      return '📢';
    case 'system':
    case 'info':
    default:
      return '🔔';
  }
}

// Formata "há X tempo" em PT-BR. Versão simplificada do getTimeAgo do vanilla
// (que importa moment-like helper); aqui inline-amos pra não acoplar a
// utils.ts. Quando portarmos getTimeAgo pra lib/, trocamos pela versão única.
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return 'agora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `há ${w} sem`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `há ${mo} mes`;
  return `há ${Math.floor(d / 365)} anos`;
}

// Skeleton row reflete a altura/forma do card real (~56px) pra que o layout
// não pule quando os dados chegam (CLS = 0).
function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)] animate-pulse">
      <div className="w-10 h-10 rounded-full bg-[color:var(--color-border)]" />
      <div className="flex-1">
        <div className="h-3 w-3/4 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded" />
      </div>
      <div className="h-2 w-12 bg-[color:var(--color-border)] rounded" />
    </div>
  );
}

function NotifRow({
  n,
  onMarkRead,
}: {
  n: Notification;
  onMarkRead: (id: string) => void;
}) {
  const unread = !n.read;
  const handleClick = () => {
    if (unread) onMarkRead(n.id);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ' +
        (unread
          ? 'bg-white border-[color:var(--color-p1)]/40 hover:bg-[color:var(--color-bg)]'
          : 'bg-white/60 border-[color:var(--color-border)] hover:bg-white')
      }
      aria-label={n.title || 'Notificação'}
    >
      <span
        className="w-10 h-10 rounded-full bg-[color:var(--color-ink)] text-white flex items-center justify-center flex-shrink-0 text-lg"
        aria-hidden="true"
      >
        {iconFor(n.type)}
      </span>
      <span className="flex-1 min-w-0">
        {n.title ? (
          <span className="block font-semibold text-sm truncate">{n.title}</span>
        ) : null}
        {n.body ? (
          <span className="block text-xs text-[color:var(--color-muted)] truncate">
            {n.body}
          </span>
        ) : null}
      </span>
      <span className="text-xs text-[color:var(--color-muted)] flex-shrink-0">
        {timeAgo(n.created_at)}
      </span>
      {unread ? (
        <span
          className="w-2 h-2 rounded-full bg-[color:var(--color-p1)] flex-shrink-0"
          aria-label="Não lida"
        />
      ) : null}
    </button>
  );
}

export function NotificationsList() {
  const { user, loading: authLoading } = useAuth();
  const { notifications, loading, error, unreadCount, markRead, markAll, isMarking } =
    useNotifications();

  // Auto-marca todas como lidas ao abrir a tela (paridade vanilla
  // modules/notif.js linha 36 `updateNotifBadge(false)`). Só roda
  // uma vez por mount + quando tem coisa pra marcar.
  const autoMarkedRef = useRef(false);
  useEffect(() => {
    if (autoMarkedRef.current) return;
    if (!user || loading) return;
    if (unreadCount > 0) {
      autoMarkedRef.current = true;
      markAll();
    }
  }, [user, loading, unreadCount, markAll]);

  // Sem sessão: prompt pro login. O AuthProvider expõe `loading` enquanto a
  // sessão tá sendo restaurada do storage — durante essa janela mostramos
  // skeleton pra não piscar "faça login" pro usuário já logado.
  if (authLoading) {
    return (
      <div className="space-y-2" aria-label="Carregando">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🔔
        </div>
        <h2 className="font-semibold mb-2">Entre pra ver suas notificações</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Curtidas, comentários e avisos aparecem aqui depois que você faz login.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2" aria-label="Carregando notificações">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Não foi possível carregar as notificações. Tente de novo.
        </p>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🔔
        </div>
        <h2 className="font-semibold mb-2">Sem notificações</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          Você está em dia. Curtidas, comentários e mensagens aparecem aqui.
        </p>
      </div>
    );
  }

  return (
    <div>
      {unreadCount > 0 ? (
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[color:var(--color-muted)]">
            {unreadCount} não {unreadCount === 1 ? 'lida' : 'lidas'}
          </span>
          <button
            type="button"
            onClick={() => markAll()}
            disabled={isMarking}
            className="text-xs font-semibold text-[color:var(--color-p1)] disabled:opacity-50"
          >
            Marcar todas como lidas
          </button>
        </div>
      ) : null}
      <ul className="space-y-2">
        {notifications.map((n) => (
          <li key={n.id}>
            <NotifRow n={n} onMarkRead={markRead} />
          </li>
        ))}
      </ul>
    </div>
  );
}
