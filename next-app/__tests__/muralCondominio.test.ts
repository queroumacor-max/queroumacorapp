// Leitura automática dos murais de condomínio (2026-11-10). O HTML abaixo é
// SINTÉTICO, com a mesma estrutura do site real — nenhum dado de morador
// entra no repositório.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import {
  chaveDoAnuncio,
  ehPedidoDePintor,
  extrairAnuncios,
  linhaDaOportunidade,
  precoUtil,
} from '@/lib/api/_services/mural-condominio';

const cartao = (titulo: string, descricao: string, extra = '') => `
<div class="img-anuncio"><img src="x.jpg" class="circle" alt=""></div>
<div class="anuncio"><div class="anuncio_altura"><div class="anuncio_conteudo">
  <div class="titulo_int">${titulo}</div>
  <div class="descricao_int">${descricao}</div>
  <div class="linha"><span class="label">Preço:&nbsp;</span>R$ 1,00</div>
  <div class="linha"><span class="label">Contato:&nbsp;</span>Fulana de Tal</div>
  ${extra}
  <div class="linha"><span class="label">E-mail:&nbsp;</span><a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="abcdef">[email&#160;protected]</a></div>
  <div class="clearfix"></div>
</div></div><div class="clearfix"></div>
<div class="mostrar-menos right" style="display: none;"><a href="#">menos</a></div></div>`;

const HTML = `<html><body><div class="interna_lista">
${cartao('Pintor', 'Procuro pintor para um orçamento de pintura em apartamento.')}
${cartao('Pinturas em geral', 'Faça já seu orçamento sem compromisso')}
${cartao('Alugo apartamento', 'Estou &agrave; procura de um apartamento pra alugar')}
${cartao('Diarista e pintor', 'Procuro diarista e pintor, entrar em contato 11 91234-5678')}
${cartao('Preciso pintor', 'Preciso de um pintor. Pintura em 3 portas &amp; 1 quarto.', '<div class="linha"><span class="label">Telefone:&nbsp;</span>11 2400-1234</div>')}
</div></body></html>`;

const fonte = { id: 'f1', nome: 'Condomínio Teste', url: 'https://mural.exemplo.com.br/classificados', cidade: 'Guarulhos', bairro: 'Centro' };

describe('extrairAnuncios', () => {
  const as = extrairAnuncios(HTML);
  it('um anúncio por cartão, com título, descrição e anunciante', () => {
    expect(as).toHaveLength(5);
    expect(as[0]).toMatchObject({ titulo: 'Pintor', anunciante: 'Fulana de Tal', temEmail: true });
    expect(as[4].descricao).toBe('Preciso de um pintor. Pintura em 3 portas & 1 quarto.');
  });
  it('telefone vem da linha própria ou, na falta, da descrição', () => {
    expect(as[4].telefone).toBe('11 2400-1234');
    expect(as[3].telefone).toBe('11 91234-5678');
    expect(as[0].telefone).toBe(null);
  });
  it('NUNCA devolve o e-mail (o site o entrega ofuscado e não decodificamos)', () => {
    expect(JSON.stringify(as)).not.toMatch(/@|cfemail|abcdef/);
    expect(readFileSync(join(__dirname, '..', 'lib/api/_services/mural-condominio.ts'), 'utf8')).not.toMatch(/parseInt\([^)]*16\)|fromCharCode/);
  });
  it('preço de enfeite ("R$ 1,00", "Combinar") não é guardado', () => {
    expect(as[0].preco).toBe(null);
    expect(precoUtil('Combinar')).toBe(null);
    expect(precoUtil('R$ 700,00')).toBe('R$ 700,00');
    expect(precoUtil('R$ 1.200,00')).toBe('R$ 1.200,00');
  });
});

describe('ehPedidoDePintor', () => {
  it('quem PROCURA pintor entra', () => {
    expect(ehPedidoDePintor('Pintor', 'Procuro pintor para um orçamento')).toBe(true);
    expect(ehPedidoDePintor('Preciso pintor', 'Pintura em 3 portas')).toBe(true);
    expect(ehPedidoDePintor('Indicação', 'Alguém indica pintor de confiança?')).toBe(true);
  });
  it('quem OFERECE pintura fica de fora', () => {
    expect(ehPedidoDePintor('Pinturas em geral', 'Faça já seu orçamento sem compromisso')).toBe(false);
    expect(ehPedidoDePintor('Pintor', 'Sou pintor, faço pintura residencial')).toBe(false);
  });
  it('anúncio de outro assunto e menção solta a pintura ficam de fora', () => {
    expect(ehPedidoDePintor('Alugo apartamento', 'Procuro apartamento pra alugar')).toBe(false);
    expect(ehPedidoDePintor('Vendo quadro', 'Pintura a óleo, R$ 300')).toBe(false);
    expect(ehPedidoDePintor('Vendo pintinhos', 'Procuro quem queira')).toBe(false);
  });
});

describe('linhaDaOportunidade', () => {
  it('entra como pedido a conferir, com o link do mural e sem e-mail', async () => {
    const [a] = extrairAnuncios(HTML);
    const l = await linhaDaOportunidade(fonte, a);
    expect(l).toMatchObject({ tipo: 'pedido', status: 'conferir', regime: 'orcamento', cidade: 'Guarulhos', fonte_url: fonte.url, contato: null });
    expect(l.contato_obs).toMatch(/abrir o link/);
    expect(l.descricao).toContain('Anunciante: Fulana de Tal.');
    expect(l.chave).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a chave é estável pro mesmo anúncio e muda com a fonte', async () => {
    const [a] = extrairAnuncios(HTML);
    expect(await chaveDoAnuncio(fonte.url, a)).toBe(await chaveDoAnuncio(fonte.url, { ...a, preco: 'x' }));
    expect(await chaveDoAnuncio('https://outro.exemplo.com.br/classificados', a)).not.toBe(await chaveDoAnuncio(fonte.url, a));
  });
});

describe('POST /api/oportunidades/varrer', () => {
  const env = { ...process.env };
  let chamadas: { url: string; init?: RequestInit }[];

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    process.env.PUSH_INTERNAL_SECRET = 'segredo-interno';
    chamadas = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      chamadas.push({ url: u, init });
      if (u.includes('/rpc/check_rate_limit')) return new Response(JSON.stringify({ allowed: true }), { status: 200 });
      if (u.includes('/rest/v1/oportunidade_fontes?select')) return new Response(JSON.stringify([fonte]), { status: 200 });
      if (u === fonte.url) return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      if (u.includes('/rest/v1/oportunidades?on_conflict=chave')) return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 201 });
      return new Response(null, { status: 204 });
    }));
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const chamar = async (headers: Record<string, string>) => {
    const { POST } = await import('@/app/api/oportunidades/varrer/route');
    return POST(new Request('https://app.test/api/oportunidades/varrer', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}',
    }) as unknown as NextRequest);
  };

  it('pelo cron: lê o mural, grava SÓ os pedidos de pintor e carimba a fonte', async () => {
    const res = await chamar({ 'x-internal-secret': 'segredo-interno' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, fontes: 1, anuncios: 5, pedidos: 3, novos: 2, falhas: 0 });
    const mural = chamadas.find((c) => c.url === fonte.url)!;
    expect((mural.init!.headers as Record<string, string>)['User-Agent']).toMatch(/QueroUmaCorBot/);
    const gravacao = chamadas.find((c) => c.url.includes('on_conflict=chave'))!;
    expect((gravacao.init!.headers as Record<string, string>).Prefer).toContain('resolution=ignore-duplicates');
    const linhas = JSON.parse(String(gravacao.init!.body)) as { titulo: string; tipo: string; status: string }[];
    expect(linhas.map((l) => l.titulo)).toEqual(['Pintor', 'Diarista e pintor', 'Preciso pintor']);
    expect(linhas.every((l) => l.tipo === 'pedido' && l.status === 'conferir')).toBe(true);
    expect(chamadas.some((c) => c.init?.method === 'PATCH' && c.url.includes('oportunidade_fontes?id=eq.f1'))).toBe(true);
  });

  it('sem segredo e sem token de admin: recusa e não lê mural nenhum', async () => {
    const res = await chamar({ 'x-internal-secret': 'errado' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(chamadas.some((c) => c.url === fonte.url)).toBe(false);
  });

  it('mural fora do ar conta como falha e não derruba os outros', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/rpc/')) return new Response(JSON.stringify({ allowed: true }), { status: 200 });
      if (u.includes('oportunidade_fontes?select')) return new Response(JSON.stringify([fonte]), { status: 200 });
      if (u === fonte.url) return new Response('x', { status: 503 });
      return new Response(null, { status: 204 });
    });
    const res = await chamar({ 'x-internal-secret': 'segredo-interno' });
    expect(await res.json()).toMatchObject({ ok: true, falhas: 1, novos: 0 });
  });
});

describe('SQL das fontes', () => {
  const sql = readFileSync(join(__dirname, '..', '..', 'migrations', '2026-11-10-c-oportunidades-fontes.sql'), 'utf8');
  it('fontes só pra admin, chave única e cron diário pela rota certa', () => {
    expect(sql).toMatch(/oportunidade_fontes_admin_all[^;]*\(SELECT public\.is_portal_admin\(\)\)/);
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_oportunidades_chave');
    expect(sql).toContain("'/api/oportunidades/varrer'");
    expect(sql).toMatch(/cron\.schedule\('oportunidades-varredura', '17 11 \* \* \*'/);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.run_oportunidades_varredura() FROM PUBLIC, anon, authenticated');
  });
});
