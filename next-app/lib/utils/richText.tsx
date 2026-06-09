// richText — parser de @menção e #hashtag pra transformar caption/comment
// crus em React JSX com links. Substitui regex iterativo pra zerar risco
// de injeção (sem dangerouslySetInnerHTML).
//
// Regras:
//   - @user: letras + dígitos + underscore, 2-30 chars. Vira <Link href="/perfil/{tag}">.
//     O componente caller decide se @tag resolve perfil pelo `tag` field
//     (não pelo id) — backend tem trigger sync_profile_tag_username.
//   - #tag: letras unicode + dígitos + underscore, 1-50 chars. Vira
//     <Link href="/hashtag/{tag}">.
//   - URLs http(s) automáticas viram <a> com target=_blank rel=noreferrer.
//
// Não trata bold/italic/etc — mantém o texto simples.

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

// Regex única que captura @mention, #hashtag ou URL. Cada alternative tem
// um named capture pra discriminar.
const TOKEN_RE = /(@[a-zA-Z0-9_]{2,30})|(#[\p{L}\p{N}_]{1,50})|(https?:\/\/[^\s]+)/gu;

export function renderRichText(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let key = 0;
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > lastIndex) {
      out.push(<Fragment key={key++}>{text.slice(lastIndex, m.index)}</Fragment>);
    }
    const [match, mention, hashtag, url] = m;
    if (mention) {
      const tag = mention.slice(1);
      out.push(
        <Link
          key={key++}
          href={`/perfil/${encodeURIComponent(tag)}`}
          className="text-[color:var(--color-p1)] font-semibold hover:underline"
        >
          {mention}
        </Link>,
      );
    } else if (hashtag) {
      const tag = hashtag.slice(1).toLowerCase();
      out.push(
        <Link
          key={key++}
          href={`/hashtag/${encodeURIComponent(tag)}`}
          className="text-[color:var(--color-p1)] font-semibold hover:underline"
        >
          {hashtag}
        </Link>,
      );
    } else if (url) {
      out.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-[color:var(--color-p1)] hover:underline break-all"
        >
          {url}
        </a>,
      );
    }
    lastIndex = m.index + match.length;
  }
  if (lastIndex < text.length) {
    out.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }
  return out;
}

/** Extrai hashtags (lowercase, sem o #) de um texto. Util pra search/insert. */
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const re = /#([\p{L}\p{N}_]{1,50})/gu;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[1]!.toLowerCase());
  return Array.from(out);
}
