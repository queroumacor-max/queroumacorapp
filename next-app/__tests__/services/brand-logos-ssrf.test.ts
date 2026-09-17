// __tests__/services/brand-logos-ssrf.test.ts — auditoria de webhooks/
// integrações externas 2026-09-17, achado L2.
//
// `persistBrandLogos` baixa a URL que a resposta da IA (OpenAI) devolve
// quando ela não manda base64. Sem checagem de host, um `fetch` aqui podia
// ser direcionado pra rede interna/metadado de nuvem. Este teste prova que
// a URL maliciosa NUNCA recebe um `fetch` (cai no fallback de "imagem
// ilegível", devolve a URL crua, sem lançar) e que uma URL pública comum
// continua funcionando normalmente.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { persistBrandLogos } from '../../lib/api/_services/brand-logos';

const SUPA_URL = 'https://fake.supabase.co';
const SERVICE_KEY = 'service-key-teste';
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(() => {
  process.env.SUPABASE_URL = SUPA_URL;
  process.env.SUPABASE_SERVICE_ROLE = SERVICE_KEY;
});
afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE;
  vi.unstubAllGlobals();
});

describe('persistBrandLogos — SSRF via URL devolvida pela IA', () => {
  it('URL apontando pra metadado de nuvem: nunca recebe fetch, devolve a URL crua sem lançar', async () => {
    const alvoMalicioso = 'https://169.254.169.254/latest/meta-data/iam/security-credentials/';
    const fetchSpy = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/rest/v1/errors')) {
        return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
      }
      // Qualquer outra coisa (inclusive o alvo malicioso, se chegasse a
      // ser chamado) responde 200 com uma imagem falsa — se o teste
      // falhar por causa disso, é porque o guard NÃO bloqueou o fetch.
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const out = await persistBrandLogos({
      userId: USER_ID,
      images: [alvoMalicioso],
      promptName: 'Teste',
      promptStyle: 'moderno',
    });

    expect(out).toEqual([alvoMalicioso]); // fallback: devolve a URL crua
    const chamouOAlvo = fetchSpy.mock.calls.some(([u]) => String(u) === alvoMalicioso);
    expect(chamouOAlvo).toBe(false);
  });

  it('URL http:// (sem TLS) também é recusada antes do fetch', async () => {
    const alvo = 'http://example.com/logo.png';
    const fetchSpy = vi.fn(async (_url: string) =>
      new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const out = await persistBrandLogos({ userId: USER_ID, images: [alvo] });
    expect(out).toEqual([alvo]);
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === alvo)).toBe(false);
  });

  it('URL pública https comum continua funcionando (o guard não bloqueia tráfego legítimo)', async () => {
    const alvoLegitimo = 'https://oaidalleapiprodscus.blob.core.windows.net/x/logo.png';
    const uploadsFeitos: string[] = [];
    const fetchSpy = vi.fn(async (url: string) => {
      const u = String(url);
      if (u === alvoLegitimo) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      if (u.includes('/storage/v1/object/posts/')) {
        uploadsFeitos.push(u);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('/rest/v1/brand_logos')) {
        return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const out = await persistBrandLogos({ userId: USER_ID, images: [alvoLegitimo] });

    expect(fetchSpy.mock.calls.some(([u]) => String(u) === alvoLegitimo)).toBe(true);
    expect(uploadsFeitos.length).toBe(1);
    // A imagem baixada com sucesso vira URL pública do NOSSO storage, não
    // a URL original da OpenAI.
    expect(out[0]).toContain(`${SUPA_URL}/storage/v1/object/public/posts/${USER_ID}/logos/`);
  });
});
