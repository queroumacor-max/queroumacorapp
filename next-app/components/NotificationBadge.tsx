// NotificationBadge — pequeno pin vermelho (variante laranja P1, padrão do
// design system) que mostra a contagem de notificações não lidas. Pensado pra
// ser posicionado em cima de um ícone de sino dentro de um header/nav (o pai
// precisa ter `position: relative` pra `absolute` do badge funcionar).
//
// Substitui o div `#notif-badge-dot` do vanilla (head.js) — mas com contagem
// numérica (vanilla mostrava só um dot binário). Vantagem: o usuário vê
// quantas pendências tem sem abrir a tela.
//
// Reaproveita o hook useNotifications, então qualquer instância renderizada
// na árvore compartilha a mesma query (TanStack Query dedup automaticamente
// por queryKey) — pode usar em header + bottom-nav sem custo extra de rede.

'use client';

import { useNotifications } from '@/lib/hooks/useNotifications';

export function NotificationBadge() {
  const { unreadCount } = useNotifications();
  if (unreadCount === 0) return null;
  return (
    <span
      className="absolute -top-1 -right-1 bg-[color:var(--color-p1)] text-white text-xs rounded-full px-1.5 py-0.5 font-bold min-w-[18px] text-center leading-none"
      aria-label={`${unreadCount} notificações não lidas`}
    >
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  );
}
