// Moderação de mensagem de chat DEPOIS do envio (2026-09-23).
//
// O chat grava a mensagem direto (envio instantâneo) e pede a moderação aqui.
// Quem é dono do ciclo de vida é o SERVIDOR: a rota responde 202 na hora e o
// trabalho segue por `runAfterResponse` (ctx.waitUntil), então fechar o app,
// recarregar a página ou a WebView ir pro fundo depois do envio não cancela
// mais a moderação (achado do Codex no PR #394 — a 1ª versão rodava no
// navegador e morria junto com ele).
//
// O conteúdo moderado é o do BANCO (lido com service role), nunca o que o
// cliente manda: o id é a única coisa que vem de fora, e ele só vale se o
// chamador for o remetente.
//
// Reprovada → soft delete (`deleted_at`) + broadcast `msg-removed` no canal
// realtime de CADA participante (`chat-global-<uuid>`, o mesmo que o
// `useChatRealtime` já escuta). O destinatário não receberia o UPDATE por
// postgres_changes: a policy de SELECT esconde linha com `deleted_at`, e o
// realtime respeita RLS. O broadcast é só um AVISO — quem recebe refaz a
// consulta (RLS-filtrada), então um broadcast forjado não esconde nada de
// verdade, só provoca um refetch.

import { getServiceKey, getSupabaseUrl } from '../security';
import { moderateContent } from './moderate';

export interface ChatMessageRow {
  id: string;
  sender_id: string;
  receiver_id: string | null;
  conversation_id: string;
  content: string | null;
  type: string | null;
  deleted_at: string | null;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Todos os participantes: remetente, destinatário e os UUIDs do convId (3-way). */
export function participantesDaMensagem(m: Pick<ChatMessageRow, 'sender_id' | 'receiver_id' | 'conversation_id'>): string[] {
  const ids = new Set<string>();
  if (m.sender_id) ids.add(m.sender_id.toLowerCase());
  if (m.receiver_id) ids.add(m.receiver_id.toLowerCase());
  for (const u of m.conversation_id.match(UUID_RE) ?? []) ids.add(u.toLowerCase());
  return [...ids];
}

/** Mesma regra do cliente antigo: qualquer `flagged` bloqueia no chat. */
export function mensagemReprovada(r: { flagged?: boolean; approved?: boolean }): boolean {
  return r.flagged === true || r.approved === false;
}

function restHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export async function lerMensagem(id: string): Promise<ChatMessageRow | null> {
  const url = getSupabaseUrl();
  const key = getServiceKey();
  if (!url || !key) return null;
  const r = await fetch(
    `${url}/rest/v1/messages?id=eq.${encodeURIComponent(id)}&select=id,sender_id,receiver_id,conversation_id,content,type,deleted_at&limit=1`,
    { headers: restHeaders(key), signal: AbortSignal.timeout(6000) },
  );
  if (!r.ok) return null;
  const rows = (await r.json()) as ChatMessageRow[];
  return rows[0] ?? null;
}

async function apagarMensagem(id: string): Promise<boolean> {
  const url = getSupabaseUrl();
  const key = getServiceKey();
  if (!url || !key) return false;
  const r = await fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
    method: 'PATCH',
    headers: { ...restHeaders(key), Prefer: 'return=minimal' },
    body: JSON.stringify({ deleted_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(6000),
  });
  return r.ok;
}

async function avisarParticipantes(m: ChatMessageRow): Promise<void> {
  const url = getSupabaseUrl();
  const key = getServiceKey();
  if (!url || !key) return;
  const payload = { id: m.id, conversationId: m.conversation_id, senderId: m.sender_id };
  await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: restHeaders(key),
    body: JSON.stringify({
      messages: participantesDaMensagem(m).map((uid) => ({
        topic: `chat-global-${uid}`,
        event: 'msg-removed',
        payload,
      })),
    }),
    signal: AbortSignal.timeout(6000),
  }).catch(() => undefined);
}

/** Roda a moderação e aplica o desfecho. Devolve true se a mensagem foi apagada. */
export async function moderarMensagemDeChat(m: ChatMessageRow): Promise<boolean> {
  const texto = (m.content ?? '').trim();
  if (!texto || m.deleted_at) return false;
  const resultado = await moderateContent({ text: texto });
  const reprovada = mensagemReprovada({
    flagged: resultado.flagged,
    approved: !resultado.flagged || resultado.severity === 'soft',
  });
  if (!reprovada) return false;
  const apagou = await apagarMensagem(m.id);
  if (apagou) await avisarParticipantes(m);
  return apagou;
}
