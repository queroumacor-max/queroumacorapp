// sessionStorageHybrid — sessão do Supabase em DOIS armazéns.
//
// Motivo (2026-08-28): no app da loja (wrapper WebView) usuários eram
// deslogados a cada reinício — suspeita de limpeza do localStorage pelo
// wrapper ("clear cache on exit" e afins). A sessão passa a ser gravada
// em localStorage E em cookies (fatiados, o limite é ~4KB por cookie);
// na leitura, vale quem sobreviveu. Se o wrapper limpar um dos dois, o
// login continua de pé.
//
// Segurança: o cookie NÃO é httpOnly (o supabase-js precisa ler no
// client) — mesma exposição a XSS que o localStorage já tinha, ou seja,
// não piora o modelo. `Secure` + `SameSite=Lax` sempre que https.
//
// Módulo SSR-safe: toda função checa o ambiente antes de tocar em
// document/localStorage. Helpers de fatiamento exportados puros pra teste.

// Fatia o VALOR JÁ CODIFICADO em pedaços que caibam num cookie (limite
// prático ~4096 bytes contando nome+atributos; 3000 deixa folga).
const CHUNK_SIZE = 3000;
// Teto de fatias na leitura/limpeza — sessão Supabase codificada tem
// ~3-6KB (2-3 fatias); 20 é um guarda contra loop, não um alvo.
const MAX_CHUNKS = 20;
// 30 dias (auditoria 2026-09-26: era 400, o teto do Chrome — refresh token
// + `user` ficavam no aparelho por mais de um ano). Não derruba quem usa:
// o supabase-js regrava a sessão a cada refresh do token (setItem →
// writeSessionCookie), o que renova o max-age. Só expira de verdade quem
// passou 30 dias sem abrir o app.
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function splitIntoCookieChunks(encoded: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    out.push(encoded.slice(i, i + CHUNK_SIZE));
  }
  return out;
}

function cookieName(key: string, index: number): string {
  return `${key}.${index}`;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(target)) return part.slice(target.length);
  }
  return null;
}

function writeCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

export function writeSessionCookie(key: string, rawValue: string): void {
  try {
    const chunks = splitIntoCookieChunks(encodeURIComponent(rawValue));
    chunks.forEach((c, i) => writeCookie(cookieName(key, i), c, COOKIE_MAX_AGE));
    // Apaga fatias sobrando de uma sessão anterior maior.
    for (let i = chunks.length; i < MAX_CHUNKS; i++) {
      if (readCookie(cookieName(key, i)) === null) break;
      writeCookie(cookieName(key, i), '', 0);
    }
  } catch {
    // cookie indisponível — localStorage segue sendo o armazém principal.
  }
}

export function readSessionCookie(key: string): string | null {
  try {
    const parts: string[] = [];
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const c = readCookie(cookieName(key, i));
      if (c === null) break;
      parts.push(c);
    }
    if (parts.length === 0) return null;
    return decodeURIComponent(parts.join(''));
  } catch {
    return null;
  }
}

export function clearSessionCookie(key: string): void {
  try {
    for (let i = 0; i < MAX_CHUNKS; i++) {
      if (readCookie(cookieName(key, i)) === null) break;
      writeCookie(cookieName(key, i), '', 0);
    }
  } catch {
    // ignora
  }
}

/**
 * Adapter de storage pro supabase-js: escreve nos dois armazéns, lê de
 * quem tiver. Quando o localStorage sobreviveu ele manda (é o mais
 * fresco); o cookie é o pára-quedas — e ao restaurar por ele, regrava o
 * localStorage pra voltar ao normal.
 */
export const hybridAuthStorage = {
  getItem(key: string): string | null {
    let fromLocal: string | null = null;
    try {
      fromLocal = window.localStorage.getItem(key);
    } catch {
      // localStorage bloqueado — segue pro cookie.
    }
    if (fromLocal !== null) return fromLocal;
    const fromCookie = readSessionCookie(key);
    if (fromCookie !== null) {
      try {
        window.localStorage.setItem(key, fromCookie);
      } catch {
        // sem localStorage, o cookie segue servindo sozinho.
      }
    }
    return fromCookie;
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignora — cookie abaixo cobre.
    }
    writeSessionCookie(key, value);
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignora
    }
    clearSessionCookie(key);
  },
};

/**
 * Existe sessão GRAVADA neste aparelho (em qualquer um dos armazéns)?
 * Não valida o token — só diz se há algo a restaurar. Usado pelo boot
 * pra decidir entre "manda pro /login" (nada salvo) e "Reconectando…"
 * (tem sessão, a rede que está lenta).
 */
export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k) && window.localStorage.getItem(k)) return true;
    }
  } catch {
    // localStorage bloqueado — tenta cookie.
  }
  try {
    if (typeof document !== 'undefined') {
      if (/(^|;\s)sb-[^=;]*-auth-token\.0=/.test(document.cookie)) return true;
    }
  } catch {
    // ignora
  }
  return false;
}

/**
 * Apaga TODA sessão do Supabase gravada neste aparelho, nos dois armazéns
 * (localStorage + cookies fatiados `sb-*-auth-token.N`). Inclui chaves
 * irmãs como `sb-*-auth-token-code-verifier` (PKCE).
 *
 * Motivo (auditoria 2026-09-26): no supabase-js v2, `auth.signOut()` sem
 * rede devolve `{ error }` e NÃO apaga a sessão local — em aparelho
 * compartilhado, "Sair" sem internet deixava a próxima pessoa logada na
 * conta de quem saiu. O logout chama isto depois do signOut, sempre.
 */
export function clearAllStoredSessions(): void {
  if (typeof window === 'undefined') return;
  const keys = new Set<string>();
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && /^sb-.*-auth-token/.test(k)) keys.add(k);
    }
  } catch {
    // localStorage bloqueado — segue pros cookies.
  }
  try {
    if (typeof document !== 'undefined') {
      for (const part of document.cookie.split('; ')) {
        const name = part.split('=')[0] ?? '';
        const m = /^(sb-.*-auth-token[^.]*)\.\d+$/.exec(name);
        if (m) keys.add(m[1]);
      }
    }
  } catch {
    // ignora
  }
  for (const k of keys) hybridAuthStorage.removeItem(k);
}
