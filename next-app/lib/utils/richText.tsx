// richText — parser de @menção e #hashtag pra transformar caption/comment
// crus em React JSX com links. Substitui regex iterativo pra zerar risco
// de injeção (sem dangerouslySetInnerHTML).
//
// Regras:
//   - @user: letras + dígitos + underscore, 2-30 chars. Vira <Link href="/perfil/{tag}">.
//     O componente caller decide se @tag resolve perfil pelo `tag` field
//     (não pelo id) — backend tem trigger sync_profile_tag_username.
//   - #tag: letras unicode + dígitos + underscore, 1-50 chars. Vira
//     <Link href="/hashtag/{tag}">. Só conta se vier no início ou
//     precedido por espaço/quebra (evita falso-positivo em "foo#bar").
//   - URLs http(s) automáticas viram <a> com target=_blank rel=noreferrer.
//     Pontuação final ".,!?;:)" é stripada do match (fica como texto fora
//     do link).
//
// Não trata bold/italic/etc — mantém o texto simples.

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

// Boundary pra @mention e #hashtag: início da string ou whitespace antes.
// Lookbehind tem suporte universal (Safari 16+, Chrome 62+, FF 78+).
const TOKEN_RE =
  /(?<=^|\s)(@[a-zA-Z0-9_]{2,30})|(?<=^|\s)(#[\p{L}\p{N}_]{1,50})|(https?:\/\/[^\s<>"]+)/gu;

// Pontuação que costuma seguir uma URL e NÃO faz parte dela.
const URL_TRAILING_RE = /[.,!?;:)\]}'"]+$/;

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
      // E2: stripa pontuação trailing. "veja https://foo.com." → URL é
      // "https://foo.com" e o "." vira texto solto depois do link.
      const trailing = url.match(URL_TRAILING_RE)?.[0] ?? '';
      const cleanUrl = trailing ? url.slice(0, url.length - trailing.length) : url;
      out.push(
        <a
          key={key++}
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-[color:var(--color-p1)] hover:underline break-all"
        >
          {cleanUrl}
        </a>,
      );
      if (trailing) {
        out.push(<Fragment key={key++}>{trailing}</Fragment>);
      }
    }
    lastIndex = m.index + match.length;
  }
  if (lastIndex < text.length) {
    out.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }
  return out;
}

/** Extrai hashtags (lowercase, sem o #) de um texto. Util pra search/insert.
 *  Boundary igual ao TOKEN_RE: só conta hashtag precedida de início/whitespace. */
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const re = /(?<=^|\s)#([\p{L}\p{N}_]{1,50})/gu;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[1]!.toLowerCase());
  return Array.from(out);
}
