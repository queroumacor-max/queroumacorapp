// NativePushOptIn — "Ativar notificações" pro APP EMPACOTADO (Capacitor).
//
// Complementa o <PushOptIn> (web push/VAPID), que se esconde em WebView
// porque WebView não tem Web Push. Este card faz o inverso: só existe
// quando a casca nativa tem o plugin PushNotifications — aí o caminho é
// FCM/APNs → token em `push_device_tokens` (lib/services/pushTokens.ts).
// Nos dois componentes o princípio é o mesmo: ambiente sem suporte não vê
// card nenhum, em vez de ver instrução impossível.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { native } from '@/lib/native';
import { ensureDeviceToken, registerDeviceToken } from '@/lib/services/pushTokens';

type Status = 'idle' | 'working' | 'on' | 'denied' | 'error';

export function NativePushOptIn() {
  const { user } = useAuth();
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<Status>('idle');

  // Detecção no effect: window.Capacitor só existe no client e o plugin
  // pode registrar depois do 1º paint.
  useEffect(() => {
    const ok = native.push.isAvailable();
    setAvailable(ok);
    if (!ok) return;
    // Lê o estado REAL da permissão ao montar. Sem isto o `status` nascia
    // sempre 'idle' e o card mostrava "Ativar" TODA vez que o app abria,
    // mesmo já ativado — o usuário reativava a cada abertura. `checkPermissions`
    // não abre prompt. Só marcamos 'on'/'denied'; 'prompt' fica 'idle'.
    //
    // E o "on" tem que ser VERDADE: ler a permissão escondia o botão
    // "Ativar", que era o único lugar que gravava o token — o card dizia
    // "Ativadas neste aparelho" com `push_device_tokens` vazio, e o push ia
    // pra ninguém. `ensureDeviceToken` grava sem abrir prompt (só com a
    // permissão já concedida). O <NativePushBridge> no AppShell faz o mesmo
    // pra quem nunca chega neste rodapé; aqui é o que sustenta o rótulo.
    let alive = true;
    void native.push.permission().then((p) => {
      if (!alive) return;
      if (p === 'granted') {
        setStatus('on');
        if (user?.id) void ensureDeviceToken(user.id);
      } else if (p === 'denied') setStatus('denied');
    });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  // deps: [user?.id, status], não [user, status] — `activate` só lê
  // `user.id`, nunca outro campo do perfil. Estreitar de propósito (mesmo
  // raciocínio de `useAiConsent.accept`): widen pra `[user]` recriaria o
  // callback a cada mudança não-relacionada do perfil, sem nenhum ganho —
  // o React Compiler que validaria essa memoização não está ativo aqui.
  const activate = useCallback(async () => {
    if (!user?.id || status === 'working') return;
    setStatus('working');
    const res = await registerDeviceToken(user.id);
    if (res.ok) setStatus('on');
    else setStatus(res.reason === 'denied' ? 'denied' : 'error');
  }, [user?.id, status]);

  if (!user || !available) return null;

  return (
    <div
      className="w-full px-4 py-3 rounded-xl bg-white border border-[color:var(--color-border)]"
      role="region"
      aria-label="Notificações do aplicativo"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[color:var(--color-ink)] truncate">
            Notificações do aplicativo
          </p>
          <p className="text-xs text-[color:var(--color-muted)] leading-snug mt-0.5">
            {status === 'on'
              ? 'Ativadas neste aparelho.'
              : status === 'denied'
                ? 'Permissão negada. Ative nas configurações do aparelho.'
                : status === 'error'
                  ? 'Não foi possível ativar agora. Tente de novo.'
                  : 'Receba avisos de mensagens e novidades.'}
          </p>
        </div>
        {status !== 'on' && (
          <button
            type="button"
            onClick={() => void activate()}
            disabled={status === 'working'}
            className="shrink-0 px-4 py-2 rounded-full text-sm font-semibold text-white bg-[color:var(--color-p1)] disabled:opacity-50"
          >
            {status === 'working' ? 'Ativando…' : 'Ativar'}
          </button>
        )}
      </div>
    </div>
  );
}
