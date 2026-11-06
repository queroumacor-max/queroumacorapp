// announce-push — "📲 Enviar push" dos Avisos do portal (2026-11-06).
//
// Por que NÃO grava uma linha em `notifications` por pessoa (o caminho que o
// sininho já usa): cada INSERT dispara o trigger `dispatch_push_on_notification`,
// que chama /api/push-notify UMA VEZ por pessoa pelo pg_net — e essa rota aceita
// 60 chamadas/min por IP. Um aviso pra 500 pessoas perderia ~440 pushes calados.
// Aqui o servidor escolhe os destinatários e manda em lote, pela mesma função do
// /api/push-notify (enviarPush). O aviso em si já aparece no /notificacoes
// (AvisosDaLoja), então o push só leva até lá.

import { ROLES, type RoleKey } from '@/lib/roles';
import { enviarPush, type EnvioPushConfig, type ResultadoPush } from '@/lib/api/_services/push-send';

/** O que o portal oferece no dropdown. 'todos' = qualquer pessoa com push ativo. */
export const PUBLICOS_PUSH = ['todos', 'pintor', 'grafiteiro', 'automotivo', 'arquiteto', 'cliente'] as const;
export type PublicoPush = (typeof PUBLICOS_PUSH)[number];

/** Teto por envio: o Worker tem limite de subrequests por requisição, e cada
 *  aparelho é uma chamada ao FCM/push service. Passou disso, a tela avisa. */
export const MAX_PESSOAS_POR_ENVIO = 1500;
const LOTE = 100;
const PAGINA = 1000;

/** Normaliza o pedido do portal: valores desconhecidos saem; 'todos' engole o resto. */
export function publicosValidos(entrada: unknown): PublicoPush[] {
  if (!Array.isArray(entrada)) return [];
  const set = new Set<PublicoPush>();
  for (const v of entrada) {
    if (typeof v === 'string' && (PUBLICOS_PUSH as readonly string[]).includes(v)) set.add(v as PublicoPush);
  }
  if (set.has('todos')) return ['todos'];
  return [...set];
}

/** Valores de `profiles.role` que cada público casa — inclui os sinônimos
 *  antigos (funileiro, engenheiro, graffiti) de lib/roles.ts. */
export function rolesDoPublico(publicos: PublicoPush[]): string[] | null {
  if (publicos.includes('todos')) return null;
  const out = new Set<string>();
  for (const p of publicos) {
    const spec = ROLES.find((r) => r.key === (p as RoleKey));
    if (!spec) continue;
    out.add(spec.key);
    for (const s of spec.sinonimos ?? []) out.add(s);
  }
  return [...out];
}

/** Texto do push a partir do aviso: título inteiro (até 120) e o começo da
 *  mensagem numa linha só (até 160) — tela de bloqueio corta o resto mesmo. */
export function payloadDoAviso(aviso: { id: string; title: string; message: string }) {
  const titulo = (aviso.title || 'Aviso da Cali Colors').trim().slice(0, 120);
  const linha = (aviso.message || '').replace(/\s+/g, ' ').trim();
  const corpo = linha.length > 160 ? `${linha.slice(0, 157).trimEnd()}…` : linha;
  return { title: titulo, body: corpo, url: '/notificacoes', tag: `aviso-${aviso.id}` };
}

interface Rest {
  supabaseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
}

async function lerTudo(rest: Rest, caminho: string): Promise<Record<string, unknown>[]> {
  const f = rest.fetchImpl ?? fetch;
  const base = rest.supabaseUrl.replace(/\/$/, '');
  const out: Record<string, unknown>[] = [];
  for (let de = 0; de < 200_000; de += PAGINA) {
    const res = await f(`${base}/rest/v1/${caminho}`, {
      headers: {
        apikey: rest.serviceKey,
        Authorization: `Bearer ${rest.serviceKey}`,
        Range: `${de}-${de + PAGINA - 1}`,
        'Range-Unit': 'items',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`consulta ${caminho.split('?')[0]} falhou: ${res.status}`);
    const lote = (await res.json()) as Record<string, unknown>[];
    out.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return out;
}

export interface Destinatarios {
  /** Perfis que batem com o público escolhido. */
  perfis: number;
  /** Desses, quantos têm push ativo em algum aparelho/navegador. */
  ids: string[];
}

export async function escolherDestinatarios(rest: Rest, publicos: PublicoPush[]): Promise<Destinatarios> {
  const roles = rolesDoPublico(publicos);
  const filtro = roles ? `&role=in.(${roles.map((r) => `"${r}"`).join(',')})` : '';
  const [perfis, tokens, subs] = await Promise.all([
    lerTudo(rest, `profiles?select=id${filtro}&order=id`),
    lerTudo(rest, 'push_device_tokens?select=user_id&order=user_id'),
    lerTudo(rest, 'push_subscriptions?select=user_id&order=user_id'),
  ]);
  const comPush = new Set<string>();
  for (const r of [...tokens, ...subs]) if (typeof r.user_id === 'string') comPush.add(r.user_id);
  const ids = perfis.map((p) => p.id).filter((id): id is string => typeof id === 'string' && comPush.has(id));
  return { perfis: perfis.length, ids };
}

export async function enviarEmLotes(
  ids: string[],
  payload: ReturnType<typeof payloadDoAviso>,
  cfg: EnvioPushConfig,
): Promise<ResultadoPush> {
  const soma: ResultadoPush = {
    sent: 0,
    removed: 0,
    total: 0,
    web: { sent: 0, removed: 0, total: 0 },
    native: { sent: 0, removed: 0, total: 0 },
  };
  for (let i = 0; i < ids.length; i += LOTE) {
    const r = await enviarPush(ids.slice(i, i + LOTE), payload, cfg);
    soma.sent += r.sent;
    soma.removed += r.removed;
    soma.total += r.total;
    for (const k of ['web', 'native'] as const) {
      soma[k].sent += r[k].sent;
      soma[k].removed += r[k].removed;
      soma[k].total += r[k].total;
    }
  }
  return soma;
}

/** Teto de pessoas escolhidas uma a uma (o modo "pessoa específica"). */
export const MAX_PESSOAS_ESCOLHIDAS = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normaliza a lista de pessoas do portal: só UUID, sem repetição, até o teto. */
export function pessoasValidas(entrada: unknown): string[] {
  if (!Array.isArray(entrada)) return [];
  const set = new Set<string>();
  for (const v of entrada) {
    if (typeof v === 'string' && UUID_RE.test(v)) set.add(v.toLowerCase());
    if (set.size >= MAX_PESSOAS_ESCOLHIDAS) break;
  }
  return [...set];
}

/** Destinatários escolhidos pelo id: quantos perfis existem e quais têm push. */
export async function destinatariosPorId(rest: Rest, pessoas: string[]): Promise<Destinatarios> {
  if (pessoas.length === 0) return { perfis: 0, ids: [] };
  const lista = `in.(${pessoas.join(',')})`;
  const [perfis, tokens, subs] = await Promise.all([
    lerTudo(rest, `profiles?select=id&id=${lista}&order=id`),
    lerTudo(rest, `push_device_tokens?select=user_id&user_id=${lista}&order=user_id`),
    lerTudo(rest, `push_subscriptions?select=user_id&user_id=${lista}&order=user_id`),
  ]);
  const comPush = new Set<string>();
  for (const r of [...tokens, ...subs]) if (typeof r.user_id === 'string') comPush.add(r.user_id);
  const ids = perfis.map((p) => p.id).filter((id): id is string => typeof id === 'string' && comPush.has(id));
  return { perfis: perfis.length, ids };
}
