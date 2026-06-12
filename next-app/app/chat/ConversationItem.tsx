// ConversationItem — uma linha da sidebar de conversas.
// Equivalente ao bloco `.conv-item` gerado em renderConvList do vanilla.

'use client';

import Link from 'next/link';
import type { ConversationMeta } from '@/lib/services/chat';

// Detecta nome que na verdade é um email (display_name nulo no perfil e o
// fallback acabou pegando o email). Nesses casos preferimos a @tag; se não
// houver, mostramos só a parte local do email (antes do @) em vez do
// endereço inteiro vazando na lista de conversas (BUG-06).
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function displayName(c: ConversationMeta): string {
  if (c.is3way) return (c.name || 'Conversa') + ' + Cali Colors';
  const nm = (c.name ?? '').trim();
  const tag = c.tag && c.tag.trim() ? '@' + c.tag.trim().replace(/^@/, '') : '';
  if (nm && !/^usu[aá]rio$/i.test(nm)) {
    if (looksLikeEmail(nm)) {
      // Tag é o melhor substituto; sem tag, usa o local-part do email.
      return tag || nm.split('@')[0] || 'Usuário';
    }
    return nm;
  }
  if (tag) return tag;
  return 'Usuário';
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function roleBadge(role: string | null): string | null {
  if (!role) return null;
  const r = role.toLowerCase();
  if (/grafit/.test(r)) return 'GRAFITEIRO';
  if (/automotiv|funile/.test(r)) return 'PINTOR AUTOMOTIVO';
  if (/pintor/.test(r)) return 'PINTOR';
  return null;
}

export interface ConversationItemProps {
  conv: ConversationMeta;
}

export function ConversationItem({ conv }: ConversationItemProps) {
  const name = displayName(conv);
  const badge = !conv.is3way ? roleBadge(conv.role) : null;
  const preview = conv.lastMsg || '';
  const prefix = conv.lastMsgFromMe ? 'Você: ' : '';
  const time = formatTime(conv.lastMsgTime);

  // href do Link encoda o convId (pode ter ':' ou '_' válidos).
  const href = `/chat/${encodeURIComponent(conv.convId)}`;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-3 rounded-xl border bg-white border-[color:var(--color-border,#e5e5e5)] hover:bg-[color:var(--color-bg,#f8f8f8)] transition-colors"
    >
      <div className="relative flex-shrink-0">
        <span
          className="w-12 h-12 rounded-full overflow-hidden bg-[color:var(--color-border,#e5e5e5)] flex items-center justify-center text-sm font-bold"
          aria-hidden="true"
        >
          {conv.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={conv.avatarUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </span>
        {conv.is3way ? (
          <span
            className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[color:var(--color-ink,#111)] flex items-center justify-center border-2 border-white"
            aria-label="Conversa com Cali Colors"
          >
            <span className="text-[8px] font-bold text-[color:var(--color-p1,#ff6a00)]">
              CC
            </span>
          </span>
        ) : null}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate">{name}</span>
          {conv.is3way ? (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[color:var(--color-ink,#111)] text-[color:var(--color-p1,#ff6a00)]">
              + CALI
            </span>
          ) : null}
          {badge ? (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[color:var(--color-p1,#ff6a00)] text-white">
              {badge}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-[color:var(--color-muted,#666)] truncate mt-0.5">
          {prefix}
          {preview.substring(0, 60)}
        </div>
      </div>

      <div className="text-[10px] text-[color:var(--color-muted,#666)] flex-shrink-0">
        {time}
      </div>
    </Link>
  );
}
