// lib/api/_services/push-endpoint-guard.ts — SSRF guard pro endpoint de Web
// Push (auditoria de webhooks 2026-09-17).
//
// Fica em `lib/`, não em `app/api/push-notify/route.ts`: arquivo de rota do
// Next só aceita um conjunto fechado de exports (GET/POST/runtime/…) —
// exportar um helper dali quebra `next build` com "X is not a valid Route
// export field", erro que NÃO aparece no `tsc` nem no `vitest` (mesma
// armadilha documentada em `whatsapp/templates/route.ts`).
//
// `push_subscriptions.endpoint` é dado do CLIENTE — a RLS só garante que a
// linha pertence ao próprio usuário (`user_id = auth.uid()`), nunca que o
// valor é um push service de verdade. Sem allowlist, o handler de envio
// fazia `fetch(sub.endpoint, …)` sem checar nada: qualquer usuário
// autenticado podia gravar um `endpoint` apontando pra QUALQUER URL —
// metadado de nuvem, serviço interno, terceiro arbitrário — e, ao disparar
// uma notificação pra si mesmo (like/comment/follow de uma segunda conta,
// por exemplo), o trigger do banco chamaria o handler — que roda no edge
// com credencial de serviço — e o `fetch` sairia pra onde o atacante
// escolheu, com um JWT VAPID assinado por NÓS no header Authorization.
// SSRF clássico via campo controlado pelo "provider".
//
// Allowlist por HOSTNAME (não por IP resolvido): os provedores reais de Web
// Push que os navegadores usam. Checar o hostname evita inteiramente a
// categoria "IP resolvido depois muda" (DNS rebinding) — não precisamos
// resolver nada, só que o host bata com um domínio que SÓ esses provedores
// controlam.

const PUSH_ENDPOINT_ALLOWED_HOSTS = [
  'fcm.googleapis.com', // Chrome/Edge/Android (Web Push via FCM)
  'android.googleapis.com', // GCM legado, ainda visto em subscriptions antigas
  'updates.push.services.mozilla.com', // Firefox (autopush)
  'web.push.apple.com', // Safari / PWA em iOS 16.4+ "standalone"
].map((h) => h.toLowerCase());

const PUSH_ENDPOINT_ALLOWED_SUFFIXES = [
  '.notify.windows.com', // Edge legado / WNS (ex.: wns2-xyz.notify.windows.com)
  '.wns.windows.com',
].map((s) => s.toLowerCase());

/**
 * `true` só para uma URL https de um dos provedores de Web Push conhecidos.
 * Qualquer outra coisa — `http://`, IP literal, `localhost`, domínio
 * desconhecido, URL malformada, ou um host que só TERMINA parecido
 * (`fcm.googleapis.com.evil.com`) — é `false`.
 */
export function isAllowedPushEndpoint(rawEndpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(rawEndpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (PUSH_ENDPOINT_ALLOWED_HOSTS.includes(host)) return true;
  return PUSH_ENDPOINT_ALLOWED_SUFFIXES.some((suf) => host.endsWith(suf));
}
