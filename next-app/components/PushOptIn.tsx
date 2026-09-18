// PushOptIn — card de opt-in pra notificações push (Web Push API).
// Aparece no ProfileFooter pra qualquer user logado.
//
// Estados (resolvidos no useEffect inicial + reativo a permission/subscribed):
//   - 'unsupported' = ambiente sem Web Push → o card inteiro some (ver abaixo);
//   - 'denied'     = permission negada (não pode pedir de novo direto;
//                    dica orientando o usuário a liberar no navegador);
//   - 'not-subscribed' = pode pedir; toggle OFF;
//   - 'subscribed'  = subscription ativa; toggle ON; clique = unsubscribe;
//   - 'loading'    = ação em andamento (subscribe/unsubscribe).
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  getPushPermissionState,
  isPushSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
  type PushPermissionState,
} from '@/lib/services/pushSubscriptions';

type Status = 'unsupported' | 'denied' | 'not-subscribed' | 'subscribed' | 'loading';

export function PushOptIn() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const perm: PushPermissionState = getPushPermissionState();
    if (perm === 'unsupported') {
      setStatus('unsupported');
      return;
    }
    if (perm === 'denied') {
      setStatus('denied');
      return;
    }
    const subscribed = await isPushSubscribed();
    setStatus(subscribed ? 'subscribed' : 'not-subscribed');
  }, []);

  useEffect(() => {
    // Sincroniza com sistema externo (permissão do navegador +
    // subscription do service worker) — não é derivável no render/SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    refresh();
    // Escuta `pushsubscriptionchange` enviado pelo SW (key rotation etc).
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'pushsubscriptionchange') {
        refresh();
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [refresh]);

  const userId = user?.id;

  const handleEnable = useCallback(async () => {
    if (!userId) {
      setError('Faça login pra ativar notificações.');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      await subscribeToPush(userId);
      setStatus('subscribed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao ativar notificações.';
      setError(msg);
      await refresh();
    }
  }, [userId, refresh]);

  const handleDisable = useCallback(async () => {
    if (!userId) return;
    setStatus('loading');
    setError(null);
    try {
      await unsubscribeFromPush(userId);
      setStatus('not-subscribed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao desativar notificações.';
      setError(msg);
      await refresh();
    }
  }, [userId, refresh]);

  if (!user) return null;

  // VAPID não configurada no ambiente → esconde o card (nada pra ativar).
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return null;

  // Sem Web Push no ambiente → some com o card em vez de explicar.
  //
  // O app empacotado (Capacitor) roda num WebView, e WebView não tem Web
  // Push: nem o WKWebView do iPhone (a Apple só liberou no Safari e em PWA
  // da tela de início) nem o WebView do Android. Ou seja: a esmagadora
  // maioria de quem via essa mensagem estava no app instalado, onde a dica
  // "instale como app na tela inicial" não fazia sentido nenhum — a pessoa
  // JÁ estava num app instalado. Melhor não oferecer nada do que oferecer
  // uma saída que não existe.
  //
  // Push no app empacotado exige push NATIVO (FCM/APNs pelo plugin do
  // Capacitor), que é outro caminho e virá num build nativo futuro.
  if (status === 'unsupported') return null;

  const isOn = status === 'subscribed';
  const isLoading = status === 'loading';
  const isDenied = status === 'denied';

  return (
    <div
      className="w-full px-4 py-3 rounded-xl bg-white border border-[color:var(--color-border)]"
      role="region"
      aria-label="Notificações push"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 text-[color:var(--color-ink)] shrink-0"
            aria-hidden="true"
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[color:var(--color-ink)] truncate">
              Receber notificações
            </p>
            <p className="text-xs text-[color:var(--color-muted)] leading-snug mt-0.5">
              {isDenied
                ? 'Bloqueado. Libere nas configurações do navegador pra ativar.'
                : isOn
                  ? 'Avisos de curtidas, comentários e mensagens chegam mesmo com o app fechado.'
                  : 'Receba avisos de curtidas, comentários e mensagens com o app fechado.'}
            </p>
            {error ? (
              <p className="text-xs text-[color:var(--color-danger)] mt-1">{error}</p>
            ) : null}
          </div>
        </div>

        {!isDenied ? (
          <button
            type="button"
            disabled={isLoading}
            onClick={isOn ? handleDisable : handleEnable}
            aria-pressed={isOn}
            aria-label={isOn ? 'Desativar notificações' : 'Ativar notificações'}
            className="relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{
              background: isOn ? 'var(--color-primary)' : 'rgba(0,0,0,0.18)',
              opacity: isLoading ? 0.55 : 1,
              cursor: isLoading ? 'wait' : 'pointer',
            }}
          >
            <span
              className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
              style={{ transform: isOn ? 'translateX(22px)' : 'translateX(2px)' }}
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}
