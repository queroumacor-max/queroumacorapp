// "Uso do app" (2026-09-09): agregação pura + paginação do REST + rota.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { montarRelatorio, buscarTabela, ehItemDeCamiseta, type DadosBrutos } from '@/lib/api/_services/admin-stats';

const vazio = (): DadosBrutos => ({ profiles: [], posts: [], likes: [], comments: [], referrals: [], orders: [], logos: [], aiUsage: [], quotes: [], reviews: [], follows: [] });

describe('montarRelatorio', () => {
  it('conta fotos × vídeos × à venda por autor, e curtidas/comentários RECEBIDOS pelo dono do post', () => {
    const d = vazio();
    d.profiles = [{ id: 'a', name: 'Ana', tag: 'ana', role: 'pintor' }, { id: 'b', name: 'Bia', tag: 'bia' }];
    d.posts = [
      { id: 'p1', user_id: 'a', media_url: 'x/1.jpg', for_sale: true, created_at: '2026-09-01T00:00:00Z' },
      { id: 'p2', user_id: 'a', media_url: 'x/2.mp4', media_type: null, created_at: '2026-09-02T00:00:00Z' },
      { id: 'p3', user_id: 'a', media_url: 'x/3', media_type: 'video', created_at: '2026-09-03T00:00:00Z' },
      { id: 'p4', user_id: 'b', media_url: 'x/4.png', deleted_at: '2026-09-03T00:00:00Z' },
    ];
    d.likes = [{ post_id: 'p1', user_id: 'b' }, { post_id: 'p2', user_id: 'b' }, { post_id: 'zzz', user_id: 'b' }];
    d.comments = [{ post_id: 'p1', user_id: 'b' }, { post_id: 'p1', user_id: 'b', deleted_at: 'x' }];
    const r = montarRelatorio(d);
    const ana = r.pessoas.find(p => p.id === 'a')!;
    const bia = r.pessoas.find(p => p.id === 'b')!;
    expect([ana.fotos, ana.videos, ana.venda]).toEqual([1, 2, 1]);
    expect(ana.curtidas).toBe(2);
    expect(ana.comentarios).toBe(1);
    expect(bia.fotos).toBe(0);            // post apagado não conta
    expect(bia.comentou).toBe(1);
    expect(bia.curtiu).toBe(3);           // curtida DADA conta como atividade
    expect(bia.atividade).toBeGreaterThan(0);
    expect(ana.ultimaAtividade).toBe('2026-09-03T00:00:00Z');
    expect(r.rankings.fotos[0]).toMatchObject({ id: 'a', nome: 'Ana', n: 1 });
    expect(r.rankings.curtidas[0].n).toBe(2);
    expect(r.totais.fotos).toBe(1);
    expect(r.totais.videos).toBe(2);
  });

  it('indicações, pedidos (com camiseta), logos, IA por feature, orçamentos e avaliações', () => {
    const d = vazio();
    d.profiles = [{ id: 'a', name: 'Ana' }, { id: 'c', name: 'Caio', role: 'cliente' }];
    d.referrals = [{ referrer_id: 'a' }, { referrer_id: 'a' }, { referrer_id: null }];
    d.orders = [
      { user_id: 'a', items: [{ product: { id: 'shirt-#fff-M', name: 'Camiseta Personalizada (M)' }, qty: 2 }, { product: { id: 'p9', name: 'Tinta' } }] },
      { user_id: 'a', items: [{ product: { id: 'p9', name: 'Tinta' } }] },
      { user_id: 'c', items: 'não é lista' },
    ];
    d.logos = [{ user_id: 'a' }];
    d.aiUsage = [
      { user_id: 'a', feature: 'alice', cost_units: 1 }, { user_id: 'a', feature: 'alice', cost_units: 2 },
      { user_id: 'a', feature: 'caption' }, { user_id: 'c', feature: 'alice' },
    ];
    d.quotes = [{ painter_id: 'a', client_id: 'c' }, { painter_id: 'a', client_id: null }, { painter_id: 'a', client_id: 'c', deleted_at: 'x' }];
    d.reviews = [{ painter_id: 'a', reviewer_id: 'c', rating: 5 }, { painter_id: 'a', reviewer_id: 'c', rating: 4 }];
    d.follows = [{ following_id: 'a' }, { following_id: 'a' }];
    const r = montarRelatorio(d);
    const ana = r.pessoas.find(p => p.id === 'a')!;
    const caio = r.pessoas.find(p => p.id === 'c')!;
    expect(ana.indicacoes).toBe(2);
    expect(ana.pedidos).toBe(2);
    expect(ana.itensPedidos).toBe(3);
    expect(ana.camisetas).toBe(1);
    expect(ana.logos).toBe(1);
    expect(ana.ia).toBe(4);
    expect(ana.iaPorFeature).toEqual({ alice: 3, caption: 1 });
    expect(ana.orcamentosFeitos).toBe(2);
    expect(caio.orcamentosPedidos).toBe(1);
    expect(caio.pedidos).toBe(1);
    expect(ana.avaliacoes).toBe(2);
    expect(ana.notaMedia).toBe(4.5);
    expect(ana.seguidores).toBe(2);
    expect(r.iaPorFeature).toEqual([{ feature: 'alice', chamadas: 4, pessoas: 2 }, { feature: 'caption', chamadas: 1, pessoas: 1 }]);
    expect(r.totais.indicacoes).toBe(3);
    expect(r.totais.camisetas).toBe(1);
    expect(r.pessoas[0].id).toBe('a');   // mais ativa primeiro
    expect(r.totais.ativas).toBe(2);
  });

  it('carrossel conta TODAS as fotos (media_urls), post antigo conta uma', () => {
    const d = vazio();
    d.posts = [
      { id: 'p1', user_id: 'a', media_url: 'x/1.jpg', media_urls: ['x/1.jpg', 'x/2.jpg', 'x/3.jpg'] },
      { id: 'p2', user_id: 'a', media_url: 'x/9.jpg', media_urls: null },
      { id: 'p3', user_id: 'a', media_url: 'x/v.mp4', media_urls: ['x/v.mp4'] },
    ];
    const r = montarRelatorio(d);
    expect(r.pessoas[0].fotos).toBe(4);
    expect(r.pessoas[0].videos).toBe(1);
  });
  it('com período: post antigo não conta, mas a curtida de hoje nele é creditada ao dono', () => {
    const d = vazio();
    d.profiles = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bia' }];
    d.posts = [{ id: 'velho', user_id: 'a', media_url: 'x/1.jpg', created_at: '2025-01-01T00:00:00Z' }];
    d.likes = [{ post_id: 'velho', user_id: 'b', created_at: '2026-09-08T00:00:00Z' }];
    d.comments = [{ post_id: 'velho', user_id: 'b', created_at: '2026-09-08T00:00:00Z' }];
    const r = montarRelatorio(d, { desde: '2026-09-01T00:00:00Z' });
    const ana = r.pessoas.find(p => p.id === 'a')!;
    expect(ana.fotos).toBe(0);
    expect(ana.curtidas).toBe(1);
    expect(ana.comentarios).toBe(1);
    expect(r.totais.fotos).toBe(0);
    expect(r.rankings.curtidas[0]).toMatchObject({ id: 'a', n: 1 });
  });
  it('quem aparece nas tabelas sem perfil entra como "(sem perfil)" e não derruba nada', () => {
    const d = vazio();
    d.posts = [{ id: 'p1', user_id: 'fantasma', media_url: 'a.jpg' }];
    const r = montarRelatorio(d);
    expect(r.pessoas[0]).toMatchObject({ id: 'fantasma', nome: '(sem perfil)', fotos: 1 });
  });

  it('ranking limita ao topN e só lista quem tem > 0', () => {
    const d = vazio();
    d.profiles = Array.from({ length: 15 }, (_, i) => ({ id: 'u' + i, name: 'U' + i }));
    d.posts = d.profiles.slice(0, 12).flatMap((p, i) => Array.from({ length: i + 1 }, (_, j) => ({ id: p.id + '-' + j, user_id: p.id, media_url: 'a.jpg' })));
    const r = montarRelatorio(d, { topN: 5 });
    expect(r.rankings.fotos.length).toBe(5);
    expect(r.rankings.fotos[0].n).toBe(12);
    expect(r.rankings.videos).toEqual([]);
  });
});

describe('ehItemDeCamiseta', () => {
  it('reconhece o id shirt-* do ShirtCustomizer e o nome, em item plano ou aninhado', () => {
    expect(ehItemDeCamiseta({ product: { id: 'shirt-#1a1a2e-G', name: 'x' } })).toBe(true);
    expect(ehItemDeCamiseta({ id: 'shirt-#fff-M' })).toBe(true);
    expect(ehItemDeCamiseta({ name: 'Camiseta Personalizada (M, Preta)' })).toBe(true);
    expect(ehItemDeCamiseta({ product: { id: 'abc', name: 'Tinta' } })).toBe(false);
    expect(ehItemDeCamiseta(null)).toBe(false);
  });
});

describe('buscarTabela', () => {
  it('pagina pelo Range/content-range e junta em ordem', async () => {
    const chamadas: string[] = [];
    const total = 2500;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = String((init!.headers as Record<string, string>).Range);
      chamadas.push(range);
      const [de, ate] = range.split('-').map(Number);
      const rows = [];
      for (let i = de; i <= Math.min(ate, total - 1); i++) rows.push({ id: i });
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-range': `${de}-${Math.min(ate, total - 1)}/${total}` } });
    }) as unknown as typeof fetch;
    const r = await buscarTabela({ supaUrl: 'https://x.supabase.co', serviceKey: 'svc', tabela: 'likes', select: 'post_id', filtros: ['created_at=gte.2026'], fetchImpl });
    expect(r.rows.length).toBe(total);
    expect(r.rows.map(x => x.id)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(r.truncado).toBe(false);
    expect(chamadas).toEqual(['0-999', '1000-1999', '2000-2999']);
    const url = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0][0];
    // `order=id` sempre: paginação sem ordem estável repete/pula linha.
    expect(url).toBe('https://x.supabase.co/rest/v1/likes?select=post_id&created_at=gte.2026&order=id');
  });
  it('marca truncado quando passa do teto de páginas', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = String((init!.headers as Record<string, string>).Range);
      const [de] = range.split('-').map(Number);
      return new Response(JSON.stringify([{ id: de }]), { status: 200, headers: { 'content-range': `${de}-${de}/9000` } });
    }) as unknown as typeof fetch;
    const r = await buscarTabela({ supaUrl: 'https://x', serviceKey: 's', tabela: 't', select: 'id', maxPaginas: 2, fetchImpl });
    expect(r.truncado).toBe(true);
    expect(r.rows.length).toBe(2);
  });
  it('erro do PostgREST vira ServiceError 502 com o corpo', async () => {
    const fetchImpl = vi.fn(async () => new Response('column x does not exist', { status: 400 })) as unknown as typeof fetch;
    await expect(buscarTabela({ supaUrl: 'https://x', serviceKey: 's', tabela: 'ai_usage', select: 'x', fetchImpl })).rejects.toThrow(/ai_usage: 400 column x/);
  });
});

describe('POST /api/admin/stats', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const mkReq = (body: unknown): NextRequest => new Request('https://app.test/api/admin/stats', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as unknown as NextRequest;
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', ADMIN_EMAILS: 'boss@x.com' };
  });
  afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

  it('não-admin leva 403; admin recebe o relatório com o período', async () => {
    // URLs registradas AQUI e afirmadas DEPOIS da chamada: um `expect` dentro
    // do fetch mockado seria engolido pelo catch por tabela do serviço.
    let desdeVisto = '';
    let urlFollows = '';
    let urlPosts = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        const tok = String((init!.headers as Record<string, string>).Authorization);
        return Promise.resolve(new Response(JSON.stringify({ id: 'c', email: tok.includes('boss') ? 'boss@x.com' : 'zé@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 }));
      }
      if (url.includes('/rpc/check_rate_limit')) return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      if (url.includes('/rest/v1/likes')) desdeVisto = url;
      if (url.includes('/rest/v1/follows')) urlFollows = url;
      if (url.includes('/rest/v1/posts')) { urlPosts = url; return Promise.resolve(new Response(JSON.stringify([{ id: 'p', user_id: 'c', media_url: 'a.jpg', created_at: '2026-09-01T00:00:00Z' }]), { status: 200, headers: { 'content-range': '0-0/1' } })); }
      if (url.includes('/rest/v1/profiles')) return Promise.resolve(new Response(JSON.stringify([{ id: 'c', name: 'Chefe' }]), { status: 200, headers: { 'content-range': '0-0/1' } }));
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': '*/0' } }));
    });
    const { POST } = await import('@/app/api/admin/stats/route');
    const nao = await POST(mkReq({ accessToken: 'ze-token' }));
    expect(nao.status).toBe(403);
    const sim = await POST(mkReq({ accessToken: 'boss-token', desde: '2026-08-01T00:00:00.000Z' }));
    expect(sim.status).toBe(200);
    const body = await sim.json();
    expect(body.ok).toBe(true);
    expect(body.desde).toBe('2026-08-01T00:00:00.000Z');
    expect(desdeVisto).toContain('created_at=gte.2026-08-01T00%3A00%3A00.000Z');
    // posts vêm SEM corte de período (dono do post fora do período).
    expect(urlPosts).toContain('/rest/v1/posts?');
    expect(urlPosts).not.toContain('created_at=gte');
    // `follows` não tem `id` no banco vivo (chave composta): pagina pelo par.
    expect(urlFollows).toContain('order=follower_id,following_id');
    expect(body.truncado).toEqual([]);
    expect(body.pessoas[0]).toMatchObject({ id: 'c', nome: 'Chefe', fotos: 1 });
    expect(body.rankings.fotos[0].n).toBe(1);
  });

  it('uma tabela quebrada não derruba o relatório: sai zerada e listada em `truncado`', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) return Promise.resolve(new Response(JSON.stringify({ id: 'c', email: 'boss@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), { status: 200 }));
      if (url.includes('/rpc/check_rate_limit')) return Promise.resolve(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      if (url.includes('/rest/v1/ai_usage')) return Promise.resolve(new Response('relation does not exist', { status: 404 }));
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': '*/0' } }));
    });
    const { POST } = await import('@/app/api/admin/stats/route');
    const res = await POST(mkReq({ accessToken: 't' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncado.some((t: string) => t.startsWith('falhou: ai_usage'))).toBe(true);
    expect(body.totais.ia).toBe(0);
  });
});
