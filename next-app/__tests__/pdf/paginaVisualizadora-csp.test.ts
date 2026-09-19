// PENTEST (2026-09-19): a CSP própria de `/pdf/[id]` (a página
// visualizadora do orçamento) tinha `'unsafe-inline'` em script-src —
// removido, trocado por nonce por requisição (a rota já é dinâmica, então
// nonce não tem o custo que teria em Server Component estático — ver
// `middleware.ts` pro raciocínio completo de quando usar nonce vs hash).

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// O route handler usa `request.nextUrl.searchParams`. `NextRequest` aceita
// uma `Request` padrão como entrada — Next adiciona `.nextUrl` no
// construtor (mesmo padrão de `__tests__/api/cidades.test.ts`).
function mkReq(): NextRequest {
  return new NextRequest('https://app.test/pdf/abcdefgh');
}

describe('GET /pdf/[id] (página visualizadora) — CSP sem unsafe-inline', () => {
  it('a CSP da página não tem mais unsafe-inline em script-src, e o nonce do header bate com o do <script> inline', async () => {
    const { GET } = await import('@/app/pdf/[id]/route');
    const res = await GET(mkReq(), { params: Promise.resolve({ id: 'abcdefgh' }) });
    const csp = res.headers.get('Content-Security-Policy') || '';
    // style-src mantém 'unsafe-inline' de propósito (os estilos inline
    // `style="..."` desta página) — só script-src precisa estar sem.
    const scriptSrc = csp.split(';').find((s) => s.trim().startsWith('script-src'));
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    const nonceMatch = csp.match(/'nonce-([^']+)'/);
    expect(nonceMatch).toBeTruthy();
    const nonce = nonceMatch![1];
    const html = await res.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
  });

  it('o nonce muda a cada requisição (não é um valor fixo reaproveitável)', async () => {
    const { GET } = await import('@/app/pdf/[id]/route');
    const mk = () => GET(mkReq(), { params: Promise.resolve({ id: 'abcdefgh' }) });
    const [r1, r2] = await Promise.all([mk(), mk()]);
    const n1 = r1.headers.get('Content-Security-Policy')?.match(/'nonce-([^']+)'/)?.[1];
    const n2 = r2.headers.get('Content-Security-Policy')?.match(/'nonce-([^']+)'/)?.[1];
    expect(n1).toBeTruthy();
    expect(n1).not.toBe(n2);
  });
});
