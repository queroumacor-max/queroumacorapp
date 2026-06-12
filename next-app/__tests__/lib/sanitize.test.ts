// Tests de lib/utils/sanitize.ts — CRIT-3 do audit 2026-06-12.
//
// O snippet do `search_all` é renderizado via `dangerouslySetInnerHTML`
// no `SearchResults.tsx`. Sem sanitização, qualquer `<script>` /
// `<img onerror>` em bio/caption/description vira XSS stored. Os
// testes travam o contrato: escapeHtml escapa 5 chars; sanitizeSearchSnippet
// neutraliza HTML arbitrário e mantém só os `<b>` do highlight.

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  sanitizeSearchSnippet,
  HL_OPEN,
  HL_CLOSE,
} from '../../lib/utils/sanitize';

describe('escapeHtml', () => {
  it('escapa < e >', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapa & (deve ser PRIMEIRO pra não double-escape)', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapa " e \'', () => {
    expect(escapeHtml(`"hello" 'world'`)).toBe('&quot;hello&quot; &#39;world&#39;');
  });

  it('escapa todos os 5 chars de uma vez', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;',
    );
  });

  it('não-escape: texto plano sai igual', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('não double-escape: `&amp;` na entrada vira `&amp;amp;`', () => {
    // E1: input que já parece escapado AINDA assim escapa o `&` —
    // alternativa seria heurística frágil. Confirmamos o comportamento.
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('sanitizeSearchSnippet', () => {
  it('empty/null safe', () => {
    expect(sanitizeSearchSnippet('')).toBe('');
    // @ts-expect-error — testar branch defensivo
    expect(sanitizeSearchSnippet(null)).toBe('');
    // @ts-expect-error — testar branch defensivo
    expect(sanitizeSearchSnippet(undefined)).toBe('');
  });

  it('XSS via <img onerror> vira texto literal (não executa)', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const out = sanitizeSearchSnippet(payload);
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
    // Garantia explícita: nenhum `<img` aberto sobra no output.
    expect(out).not.toMatch(/<img/i);
  });

  it('sentinelas viram <b>...</b>', () => {
    const out = sanitizeSearchSnippet(`foo ${HL_OPEN}bar${HL_CLOSE} baz`);
    expect(out).toBe('foo <b>bar</b> baz');
  });

  it('mistura: <script> escapado MAS <b> aplicado nas sentinelas', () => {
    const input = `foo <script>alert(1)</script> ${HL_OPEN}bar${HL_CLOSE}`;
    const out = sanitizeSearchSnippet(input);
    expect(out).toBe(
      'foo &lt;script&gt;alert(1)&lt;/script&gt; <b>bar</b>',
    );
    // Garantia: nenhum `<script>` aberto sobra.
    expect(out).not.toMatch(/<script/i);
  });

  it('múltiplas sentinelas por snippet', () => {
    const input = `${HL_OPEN}a${HL_CLOSE} e ${HL_OPEN}b${HL_CLOSE}`;
    expect(sanitizeSearchSnippet(input)).toBe('<b>a</b> e <b>b</b>');
  });

  it('aspas no input ficam HTML-escaped (impede break de attribute)', () => {
    // Se um dia o snippet caísse num atributo (não é o caso hoje, mas
    // defesa em profundidade), aspas escapadas evitam injeção.
    const input = `${HL_OPEN}foo"bar'baz${HL_CLOSE}`;
    expect(sanitizeSearchSnippet(input)).toBe(
      '<b>foo&quot;bar&#39;baz</b>',
    );
  });

  it('payload XSS clássico com event handler é neutralizado', () => {
    const payload = `<a href="javascript:alert(1)" onclick="alert(2)">click</a>`;
    const out = sanitizeSearchSnippet(payload);
    expect(out).toBe(
      '&lt;a href=&quot;javascript:alert(1)&quot; onclick=&quot;alert(2)&quot;&gt;click&lt;/a&gt;',
    );
    // O <a> abre como &lt; — nenhum tag executável sobra. As palavras
    // "onclick" / "javascript" aparecem como texto literal (escapadas
    // por aspas), o que é inofensivo: o browser não interpreta atributo
    // fora de um elemento.
    expect(out).not.toMatch(/<a /i);
    expect(out).not.toMatch(/<\/a>/i);
  });
});
