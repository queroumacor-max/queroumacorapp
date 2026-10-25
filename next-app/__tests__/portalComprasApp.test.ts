// Portal: "Compras no app" (2026-10-25). Avalia os helpers puros do fonte
// do portal e trava que a tela está no menu e lê a rota de servidor.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let fonte = '';
type Compra = Record<string, unknown> & { sandbox?: boolean; pessoa?: Record<string, unknown> | null };
let filtrarCompras: (l: Compra[], f: Record<string, unknown>) => Compra[];
let csvDasCompras: (l: Compra[]) => string;
let statusDaCompra: (s: string) => { rot: string };

beforeAll(() => {
  fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  const ini = fonte.indexOf('// [teste:compras-inicio]');
  const fim = fonte.indexOf('// [teste:compras-fim]');
  expect(ini).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(ini);
  ({ filtrarCompras, csvDasCompras, statusDaCompra } = new Function(
    `${fonte.slice(ini, fim)}; return { filtrarCompras, csvDasCompras, statusDaCompra };`,
  )());
});

const compras: Compra[] = [
  { id: 1, produto: 'quote_1', produtoRotulo: '1 orçamento', status: 'applied', plataforma: 'app_store', sandbox: true, transacao: 'app_store:9', pessoa: { nome: 'Ana', tag: 'ana', email: 'ana@x.com', telefone: '5511999' }, valor: { amount: 1, currency: 'BRL', estimado: true } },
  { id: 2, produto: 'quotes_unlimited', produtoRotulo: 'PRO mensal', status: 'active', plataforma: 'play_store', sandbox: false, transacao: 'rc-sub:1', pessoa: { nome: '=Bia', tag: 'bia' }, valor: null },
];

describe('Compras no app', () => {
  it('está no menu e chama /api/admin/billing (que existe)', () => {
    expect(fonte).toContain("{ id:'compras', icon:'💳', label:'Compras no app'");
    expect(fonte).toContain("fetch('/api/admin/billing'");
    expect(existsSync(join(process.cwd(), 'app/api/admin/billing/route.ts'))).toBe(true);
  });
  it('filtros: teste, produto, loja e busca por e-mail/telefone/transação', () => {
    expect(filtrarCompras(compras, { teste: false }).map((c) => c.id)).toEqual([2]);
    expect(filtrarCompras(compras, { teste: true, produto: 'quote_1' }).map((c) => c.id)).toEqual([1]);
    expect(filtrarCompras(compras, { teste: true, loja: 'play_store' }).map((c) => c.id)).toEqual([2]);
    expect(filtrarCompras(compras, { teste: true, busca: 'ana@x' }).map((c) => c.id)).toEqual([1]);
    expect(filtrarCompras(compras, { teste: true, busca: 'rc-sub' }).map((c) => c.id)).toEqual([2]);
  });
  it('status desconhecido aparece cru, não some', () => {
    expect(statusDaCompra('refunded').rot).toBe('Reembolsada');
    expect(statusDaCompra('xyz').rot).toBe('xyz');
  });
  it('CSV escapa fórmula e marca valor estimado', () => {
    const csv = csvDasCompras(compras);
    expect(csv).toContain('"\'=Bia"');
    expect(csv.split('\n')[1]).toContain('"sim"');
  });
});
