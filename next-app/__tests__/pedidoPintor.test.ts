// Pedido de pintor pela página pública /pedir (2026-11-10).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import {
  origemDoPedido,
  telefoneDoPedido,
  validarPedidoPintor,
} from '@/lib/pedidoPintor';

const raiz = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

const bom = {
  servico: 'Pintura interna',
  descricao: 'Apartamento de 60 m², dois quartos e sala.',
  cidade: 'Guarulhos',
  bairro: 'Pimentas',
  prazo: 'Nos próximos 30 dias',
  nome: 'Maria Souza',
  telefone: '(11) 91234-5678',
  consentimento: true,
  origem: 'facebook',
};

describe('validarPedidoPintor', () => {
  it('aceita o pedido completo e normaliza o telefone com 55', () => {
    const r = validarPedidoPintor(bom);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pedido.telefone).toBe('5511912345678');
      expect(r.pedido.origem).toBe('facebook');
      expect(r.pedido).not.toHaveProperty('consentimento');
    }
  });

  it('recusa sem a autorização de repassar o contato', () => {
    const r = validarPedidoPintor({ ...bom, consentimento: 'true' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.campo).toBe('consentimento');
  });

  it('recusa serviço fora da lista, descrição curta e telefone inválido', () => {
    expect(validarPedidoPintor({ ...bom, servico: 'Hackear' }).ok).toBe(false);
    expect(validarPedidoPintor({ ...bom, descricao: 'oi' }).ok).toBe(false);
    expect(validarPedidoPintor({ ...bom, telefone: '1234' }).ok).toBe(false);
  });

  it('prazo fora da lista vira null em vez de barrar o pedido', () => {
    const r = validarPedidoPintor({ ...bom, prazo: 'amanhã cedo' });
    expect(r.ok && r.pedido.prazo).toBe(null);
  });

  it('corta texto longo e tira caractere de controle', () => {
    const r = validarPedidoPintor({ ...bom, nome: 'Ana\u0000 Lima', descricao: 'x'.repeat(5000) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pedido.nome).toBe('Ana Lima');
      expect(r.pedido.descricao.length).toBe(1500);
    }
  });
});

describe('telefoneDoPedido / origemDoPedido', () => {
  it('celular e fixo BR, com ou sem 55', () => {
    expect(telefoneDoPedido('11 91234-5678')).toBe('5511912345678');
    expect(telefoneDoPedido('+55 11 91234-5678')).toBe('5511912345678');
    expect(telefoneDoPedido('1124001234')).toBe('551124001234');
  });
  it('11 dígitos sem o 9 no terceiro não é celular BR', () => {
    expect(telefoneDoPedido('16503154274')).toBe(null);
  });
  it('origem só aceita letra, número, hífen e sublinhado', () => {
    expect(origemDoPedido('QR-Loja')).toBe('qr-loja');
    expect(origemDoPedido('<script>')).toBe('script');
    expect(origemDoPedido('')).toBe(null);
  });
});

describe('POST /api/pedidos-pintor', () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/rpc/check_rate_limit')) {
        return new Response(JSON.stringify({ allowed: true }), { status: 200 });
      }
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const chamar = async (corpo: unknown) => {
    const { POST } = await import('@/app/api/pedidos-pintor/route');
    const req = new Request('https://app.test/api/pedidos-pintor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }) as unknown as NextRequest;
    return POST(req);
  };
  const inserts = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/rest/v1/pedidos_pintor'));

  it('grava o pedido válido com service role e não devolve dado pessoal', async () => {
    const res = await chamar(bom);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(inserts()).toHaveLength(1);
    const [, init] = inserts()[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer service');
    const gravado = JSON.parse(String(init.body));
    expect(gravado.telefone).toBe('5511912345678');
    expect(gravado).not.toHaveProperty('status');
    expect(gravado).not.toHaveProperty('site');
  });

  it('campo-isca preenchido: responde ok e NÃO grava', async () => {
    const res = await chamar({ ...bom, site: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(0);
  });

  it('pedido inválido → 400 com o campo, sem gravar', async () => {
    const res = await chamar({ ...bom, telefone: '123' });
    expect(res.status).toBe(400);
    expect((await res.json()).campo).toBe('telefone');
    expect(inserts()).toHaveLength(0);
  });

  it('JSON quebrado → 400', async () => {
    expect((await chamar('{nao-json')).status).toBe(400);
  });

  it('banco recusou (ex.: tabela ausente) → 503 com texto amigável', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/rpc/')
        ? new Response(JSON.stringify({ allowed: true }), { status: 200 })
        : new Response('{"code":"PGRST205"}', { status: 404 }),
    );
    const res = await chamar(bom);
    expect(res.status).toBe(503);
    expect((await res.json()).error).not.toMatch(/PGRST|relation/);
  });
});

describe('página /pedir e SQL', () => {
  it('a página é pública: não usa AppShell (que exige login)', () => {
    expect(ler('app/pedir/page.tsx')).not.toMatch(/import[^\n]*AppShell/);
    expect(ler('app/pedir/PedirForm.tsx')).not.toMatch(/import[^\n]*AppShell/);
  });
  it('está no sitemap', () => {
    expect(ler('app/sitemap.ts')).toContain("entry('/pedir'");
  });
  it('a tabela não tem policy de INSERT e as policies embrulham is_portal_admin', () => {
    const sql = readFileSync(join(raiz, '..', 'migrations', '2026-11-10-pedidos-pintor.sql'), 'utf8');
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|ALL)/i);
    const policies = sql.match(/CREATE POLICY[^;]*;/g) || [];
    expect(policies.length).toBe(3);
    for (const p of policies) expect(p).toContain('(SELECT public.is_portal_admin())');
  });
  it('o portal tem a tela e o badge de pedidos novos', () => {
    const jsx = ler('public/portal/app.jsx');
    expect(jsx).toContain("id:'pedidos-pintor'");
    expect(jsx).toContain("badgeKey:'pedidosPintor'");
    expect(jsx).toMatch(/from\('pedidos_pintor'\)[^\n]*eq\('status', 'novo'\)/);
  });
  it('helpers do portal: texto pro pintor e link com origem', () => {
    const jsx = ler('public/portal/app.jsx');
    const trecho = jsx.split('// [teste:pedido-pintor-inicio]')[1].split('// [teste:pedido-pintor-fim]')[0];
    const fn = new Function("const LINK_PEDIR='https://www.queroumacor.com.br/pedir';" + trecho + ';return {textoDoPedidoParaPintor, linkPedirComOrigem};');
    const h = fn() as {
      textoDoPedidoParaPintor: (p: Record<string, string>) => string;
      linkPedirComOrigem: (c: string, o: string) => string;
    };
    expect(h.linkPedirComOrigem('São Paulo', 'QR Loja!')).toBe('https://www.queroumacor.com.br/pedir?cidade=S%C3%A3o%20Paulo&o=qrloja');
    expect(h.linkPedirComOrigem('', '')).toBe('https://www.queroumacor.com.br/pedir');
    const t = h.textoDoPedidoParaPintor({ servico: 'Pintura interna', cidade: 'Guarulhos', bairro: 'Pimentas', descricao: 'Apto', nome: 'Maria', telefone: '5511912345678' });
    expect(t).toContain('Pimentas, Guarulhos');
    expect(t).toContain('wa.me/5511912345678');
  });
});
