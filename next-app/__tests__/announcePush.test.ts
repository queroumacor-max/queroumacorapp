// "📲 Enviar push" dos Avisos (2026-11-06).
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  publicosValidos,
  rolesDoPublico,
  payloadDoAviso,
  escolherDestinatarios,
  pessoasValidas,
  destinatariosPorId,
  MAX_PESSOAS_ESCOLHIDAS,
} from '@/lib/api/_services/announce-push';

describe('publicosValidos', () => {
  it('descarta valor desconhecido e "todos" engole o resto', () => {
    expect(publicosValidos(['pintor', 'hacker', 'cliente'])).toEqual(['pintor', 'cliente']);
    expect(publicosValidos(['pintor', 'todos'])).toEqual(['todos']);
    expect(publicosValidos('todos')).toEqual([]);
    expect(publicosValidos([])).toEqual([]);
  });
});

describe('rolesDoPublico', () => {
  it('todos = sem filtro', () => {
    expect(rolesDoPublico(['todos'])).toBeNull();
  });
  it('inclui os sinônimos antigos gravados no banco', () => {
    expect(rolesDoPublico(['automotivo'])).toEqual(['automotivo', 'funileiro']);
    expect(rolesDoPublico(['arquiteto'])).toEqual(['arquiteto', 'engenheiro']);
    expect(rolesDoPublico(['grafiteiro', 'cliente'])).toEqual(['grafiteiro', 'graffiti', 'cliente']);
  });
});

describe('payloadDoAviso', () => {
  it('título inteiro, mensagem numa linha e cortada com reticências, leva ao /notificacoes', () => {
    const p = payloadDoAviso({ id: 'abc', title: ' 🎁 Sorteio ', message: 'linha 1\n\nlinha 2 ' + 'x'.repeat(300) });
    expect(p.title).toBe('🎁 Sorteio');
    expect(p.body.startsWith('linha 1 linha 2')).toBe(true);
    expect(p.body.length).toBeLessThanOrEqual(160);
    expect(p.body.endsWith('…')).toBe(true);
    expect(p.url).toBe('/notificacoes');
    expect(p.tag).toBe('aviso-abc');
  });
});

describe('escolherDestinatarios', () => {
  it('só quem bate com o público E tem push ativo (aparelho ou navegador)', async () => {
    const chamadas: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      chamadas.push(url);
      const body = url.includes('/profiles?')
        ? [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
        : url.includes('push_device_tokens')
          ? [{ user_id: 'a' }, { user_id: 'z' }]
          : [{ user_id: 'c' }];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await escolherDestinatarios({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', fetchImpl }, ['automotivo']);
    expect(r.perfis).toBe(3);
    expect(r.ids.sort()).toEqual(['a', 'c']);
    const perfis = chamadas.find((u) => u.includes('/profiles?'))!;
    expect(decodeURIComponent(perfis)).toContain('role=in.("automotivo","funileiro")');
  });

  it('falha de consulta estoura (nunca manda pra lista pela metade)', async () => {
    const fetchImpl = vi.fn(async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(
      escolherDestinatarios({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', fetchImpl }, ['todos']),
    ).rejects.toThrow();
  });
});

describe('pessoa específica', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  it('pessoasValidas só aceita uuid, sem repetir, até o teto', () => {
    expect(pessoasValidas([A, A.toUpperCase(), 'x; drop', 5, B])).toEqual([A, B]);
    expect(pessoasValidas('abc')).toEqual([]);
    const muitos = Array.from({ length: 30 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
    expect(pessoasValidas(muitos)).toHaveLength(MAX_PESSOAS_ESCOLHIDAS);
  });
  it('destinatariosPorId filtra por id e só devolve quem tem push', async () => {
    const chamadas: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      chamadas.push(url);
      const body = url.includes('/profiles?') ? [{ id: A }, { id: B }] : url.includes('push_device_tokens') ? [{ user_id: B }] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await destinatariosPorId({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', fetchImpl }, [A, B]);
    expect(r).toEqual({ perfis: 2, ids: [B] });
    expect(chamadas.every((u) => u.includes(`in.(${A},${B})`))).toBe(true);
  });
});

describe('portal', () => {
  const src = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  it('cada aviso tem o botão e o modal chama a rota de admin', () => {
    expect(src).toContain('📲 Enviar push');
    expect(src).toContain("fetch('/api/admin/announce-push'");
    expect(existsSync(join(process.cwd(), 'app/api/admin/announce-push/route.ts'))).toBe(true);
  });
  it('tem o modo pessoa específica com busca por nome ou @tag', () => {
    expect(src).toContain('👤 Pessoa específica');
    expect(src).toContain("'name.ilike.%' + q + '%,tag.ilike.%' + q + '%'");
    expect(src).toContain('pessoas: pessoas.map((p) => p.id)');
  });
  it('a lista do dropdown bate com os públicos do servidor', async () => {
    const { PUBLICOS_PUSH } = await import('@/lib/api/_services/announce-push');
    const chaves = [...src.matchAll(/\{ key: '([a-z]+)', label: '[^']+' \}/g)].map((m) => m[1]);
    expect(chaves).toEqual([...PUBLICOS_PUSH]);
  });
});
