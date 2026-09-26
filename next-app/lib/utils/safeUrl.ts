// safeUrl — helpers pra URL vinda de dado de usuário (auditoria 2026-09-26).
//
// React 18 NÃO bloqueia `href="javascript:..."` (só avisa no console): um
// valor gravado pelo próprio usuário via REST (link de curso, certificado,
// media_url) vira XSS no clique de quem abrir. Todo href com dado de usuário
// passa por `safeHttpUrl`.

/**
 * Devolve a URL (sem espaços nas pontas) se for absoluta http/https;
 * `undefined` pra qualquer outra coisa (javascript:, data:, vbscript:,
 * relativa, vazia, malformada). Com `undefined` o React não renderiza o href.
 */
export function safeHttpUrl(u: unknown): string | undefined {
  if (typeof u !== 'string') return undefined;
  const s = u.trim();
  if (!s) return undefined;
  try {
    const url = new URL(s);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return s;
  } catch {
    return undefined;
  }
}

/**
 * Mídia que o app pode CARREGAR sozinho (sem clique) — `<img>/<video>/
 * <audio>` baixam a URL assim que renderizam, entregando o IP de quem abriu
 * a conversa pra qualquer host que o remetente escolher. Só confiamos no
 * Storage do Supabase (onde os anexos do chat são gravados — ver
 * lib/services/chat-attachments.ts) e na própria origem do app (proxy
 * /cdn-cgi/image, arquivos estáticos). Sempre https.
 */
export function isTrustedMediaUrl(u: unknown, appOrigin?: string): boolean {
  const s = safeHttpUrl(u);
  if (!s) return false;
  try {
    const url = new URL(s);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host.endsWith('.supabase.co')) return true;
    const origin =
      appOrigin ?? (typeof window !== 'undefined' ? window.location.origin : undefined);
    return !!origin && url.origin === origin;
  } catch {
    return false;
  }
}
