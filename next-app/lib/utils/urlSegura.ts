// urlSegura — allowlist de esquema pra URL que vem de DADO (banco, API,
// planilha) e vai parar num `href`/`src`. Auditoria 2026-09-11.
//
// React NÃO filtra `javascript:` em `href` (o react-dom 18/19 só avisa). A
// CSP do app bloqueia a execução hoje, mas CSP é rede de segurança, não
// correção: o link `//evil.example` num painel de admin continua levando o
// revisor pra fora do site com cara de link interno. Aqui a regra é uma
// só: ou começa com http(s)://, ou não vira link.

const ESQUEMA_OK = /^https?:\/\/[^\s/]+/i;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\x00-\x1f\x7f]/;

/** `url` se for http(s) absoluta; senão `null` (quem chama decide o fallback). */
export function hrefSeguro(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!ESQUEMA_OK.test(u)) return null;
  // Controle/CRLF não têm o que fazer numa URL de atributo.
  if (CONTROLE.test(u)) return null;
  return u;
}

/** Como `hrefSeguro`, mas completa `www.site.com` com `https://`. */
export function hrefSeguroOuHttps(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return hrefSeguro(u);
  return hrefSeguro(`https://${u.replace(/^\/+/, '')}`);
}

/**
 * Valor de cor pra CSS (`background`, `color`): `#hex` (3-8 dígitos) ou
 * uma lista de cores/porcentagens pra gradiente. Nada de `url(`, `(`, `;`
 * ou aspas — `style-src` mantém 'unsafe-inline' e um `color_gradient` como
 * `red),url(https://x` faria o navegador buscar o que quiser.
 */
export function corCssSegura(v: unknown, fallback = '#cccccc'): string {
  if (typeof v !== 'string') return fallback;
  const c = v.trim();
  if (!c) return fallback;
  return /^[#0-9a-zA-Z,.\s%-]{1,120}$/.test(c) ? c : fallback;
}
