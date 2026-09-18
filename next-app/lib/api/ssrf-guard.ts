// lib/api/ssrf-guard.ts — bloqueio de rede interna/privada pra fetch de URL
// vinda de fonte não totalmente confiável (resposta de provider de IA,
// campo de formulário, etc).
//
// Auditoria de webhooks/integrações externas (2026-09-17) — achado L2:
// `brand-logos.fetchBytes` baixa uma URL que a resposta da IA (OpenAI
// `gpt-image-1`) devolve, sem checar o host. A IA não é o usuário — o
// vetor de ataque de verdade exigiria a IA "alucinar" ou ser induzida
// (prompt injection) a devolver uma URL maliciosa —, mas tratar a resposta
// de um provider como dado ESTRUTURADO não confiável (não como comando) é
// a regra, não a exceção: se algum dia a resposta trouxer uma URL pra rede
// interna, o fetch não deveria nem tentar.
//
// Por que BLOQUEAR (blocklist de redes privadas) em vez de ALLOWLIST (só
// hosts conhecidos), diferente do que foi feito pro `push-notify`
// (`push-endpoint-guard.ts`): lá os provedores de Web Push são um conjunto
// FECHADO e conhecido (4 hosts). Aqui o host de resposta de imagem da
// OpenAI muda de storage (hoje Azure Blob, `*.blob.core.windows.net`, mas
// não é contrato público estável) — um allowlist errado quebraria geração
// legítima sem aviso. Blocklist de rede privada cobre o pior cenário
// (acesso a rede interna, metadado de nuvem) sem depender de adivinhar o
// host exato de um provider externo.
//
// LIMITAÇÃO DECLARADA: isto valida o HOSTNAME da URL (a `new URL().hostname`
// já normaliza formas numéricas/hex/octal de IP — proteção de graça contra
// ofuscação de literal), não o endereço REALMENTE resolvido no momento do
// fetch. DNS rebinding (hostname público no momento da checagem, resolvendo
// pra IP privado no momento do fetch) não é coberto — exigiria resolver o
// DNS e fixar o IP antes do fetch, não trivial no runtime do Cloudflare
// Workers sem uma lib de resolução própria. Documentado como risco residual
// aceito (mesmo padrão de decisão que o restante deste repo já usa pra
// trade-offs semelhantes).

const V4_PRIVATE_OR_RESERVED = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16.0.0/12
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local (inclui 169.254.169.254, metadado de nuvem)
  /^0\./, // "esta rede"
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];

function isPrivateOrReservedIPv4(host: string): boolean {
  return V4_PRIVATE_OR_RESERVED.some((re) => re.test(host));
}

/** Host IPv6 é literal quando `new URL().hostname` o envolve em colchetes. */
function isPrivateOrReservedIPv6(hostnameRaw: string): boolean {
  const h = hostnameRaw.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1') return true; // loopback
  if (h === '::') return true; // unspecified
  if (h.startsWith('fe80:') || h.startsWith('fe80::')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 (unique local)
  // IPv4-mapped (::ffff:a.b.c.d) — reaplica a checagem de IPv4 na cauda.
  // O parser de URL (WHATWG) normaliza pra forma hex pura
  // (`::ffff:7f00:1`, não `::ffff:127.0.0.1`), então aceita as duas.
  const mapeadoDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapeadoDotted) return isPrivateOrReservedIPv4(mapeadoDotted[1]);
  const mapeadoHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapeadoHex) {
    const alto = parseInt(mapeadoHex[1], 16);
    const baixo = parseInt(mapeadoHex[2], 16);
    const ip = [
      (alto >> 8) & 0xff,
      alto & 0xff,
      (baixo >> 8) & 0xff,
      baixo & 0xff,
    ].join('.');
    return isPrivateOrReservedIPv4(ip);
  }
  return false;
}

/**
 * `true` só pra uma URL `https:` cujo hostname NÃO é loopback, rede privada
 * (RFC1918), link-local (inclui o metadado de nuvem 169.254.169.254),
 * CGNAT, nem um literal IPv6 equivalente. URL malformada é `false`.
 */
export function isPubliclyRoutableHttpsUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.startsWith('[')) return !isPrivateOrReservedIPv6(host);
  // Host IPv4 literal (dotted-decimal — `new URL` já normalizou formas
  // numéricas/hex/octal alternativas pra este formato).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !isPrivateOrReservedIPv4(host);
  return true;
}
