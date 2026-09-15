// NativeBadge — mantém o número no ícone do app igual ao total de pendências
// (avisos + mensagens não lidas). Usa o plugin Badge quando presente; no-op no
// navegador/PWA e em launcher sem suporte. Montado no AppShell, renderiza null.

'use client';

import { useEffect } from 'react';
import { native } from '@/lib/native';
import { useUnreadNotificationCount } from '@/lib/hooks/useUnreadNotificationCount';
import { useUnreadMessageCount } from '@/lib/hooks/useUnreadMessageCount';

export function NativeBadge() {
  const notif = useUnreadNotificationCount();
  const msgs = useUnreadMessageCount();

  useEffect(() => {
    native.badge.set((notif || 0) + (msgs || 0));
  }, [notif, msgs]);

  // Ao desmontar (logout — este componente só vive dentro do AppShell
  // privado), zera o badge: senão o ícone do app continua mostrando a
  // contagem de quem saiu até a próxima conta abrir o app num aparelho
  // compartilhado, o que também revela ("tem gente com mensagem não lida")
  // a quem pegar o celular emprestado sem nunca ter feito login.
  useEffect(() => {
    return () => native.badge.set(0);
  }, []);

  return null;
}
