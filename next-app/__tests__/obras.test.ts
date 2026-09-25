import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diasDaSemana, resumoDaObra, rotuloDia, textoEscalaWhatsApp, waDigitos } from '@/lib/obras';
import { categoriaDoLancamento, gastosPorCategoria } from '@/lib/categoriasGasto';
import { normalizarTag } from '@/lib/services/obras';

describe('diasDaSemana', () => {
  it('seg a sáb da semana do dia (quinta 24/09/2026)', () => {
    expect(diasDaSemana('2026-09-24')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
  });
  it('domingo pertence à semana que termina nele', () => {
    expect(diasDaSemana('2026-09-27')[0]).toBe('2026-09-21');
  });
  it('anda semanas e vira o mês', () => {
    expect(diasDaSemana('2026-09-24', 1)[0]).toBe('2026-09-28');
    expect(diasDaSemana('2026-09-24', 2)[3]).toBe('2026-10-08');
  });
  it('rótulo do dia', () => {
    expect(rotuloDia('2026-09-24').curto).toBe('qui 24/09');
  });
});

describe('categorias de gasto', () => {
  it('coluna vence o prefixo; prefixo antigo é entendido; resto é "sem"', () => {
    expect(categoriaDoLancamento({ categoria: 'veiculo', service_type: 'Material: x' })).toBe('veiculo');
    expect(categoriaDoLancamento({ service_type: 'Mão de obra: diária Diego' })).toBe('mao_de_obra');
    expect(categoriaDoLancamento({ service_type: 'material: tinta' })).toBe('material');
    expect(categoriaDoLancamento({ service_type: 'Pintura cozinha' })).toBe('sem');
    expect(categoriaDoLancamento({ categoria: 'cerveja' })).toBe('sem');
  });
  it('soma só custos, maior primeiro', () => {
    const g = gastosPorCategoria([
      { categoria: 'material', material_cost: 100 },
      { categoria: 'material', material_cost: '50.5' },
      { categoria: 'transporte', material_cost: 200 },
      { categoria: 'transporte', material_cost: 0 },
    ]);
    expect(g.map((x) => [x.id, x.total])).toEqual([['transporte', 200], ['material', 150.5]]);
  });
});

describe('resumoDaObra', () => {
  it('estima mão de obra pela escala quando não foi lançada', () => {
    const r = resumoDaObra(10000, [{ categoria: 'material', material_cost: 2000 }], [{ diaria: 200 }, { diaria: 200 }, { diaria: null }]);
    expect(r.maoDeObraEstimada).toBe(400);
    expect(r.lucro).toBe(7600);
  });
  it('mão de obra lançada substitui a estimativa (não conta duas vezes)', () => {
    const r = resumoDaObra(10000, [{ categoria: 'mao_de_obra', material_cost: 1000 }], [{ diaria: 200 }]);
    expect(r.maoDeObraEstimada).toBe(0);
    expect(r.lucro).toBe(9000);
  });
});

describe('WhatsApp e @tag', () => {
  it('waDigitos segue a regra do celular BR (3º dígito 9)', () => {
    expect(waDigitos('(11) 98765-4321')).toBe('5511987654321');
    expect(waDigitos('1133334444')).toBe('551133334444');
    expect(waDigitos('16503154274')).toBe('16503154274');
    expect(waDigitos('123')).toBeNull();
  });
  it('texto da escala', () => {
    const t = textoEscalaWhatsApp('Diego Martins', 'Léo', [{ dia: '2026-09-24', obra: 'Fachada', horario: '07:30', endereco: 'R. A, 1' }]);
    expect(t).toBe('Oi Diego! Sua escala com Léo:\n• qui 24/09 — Fachada — 07:30 — R. A, 1');
  });
  it('normalizarTag limpa @, caixa e símbolos', () => {
    expect(normalizarTag(' @Fulano.Pinta ')).toBe('fulano.pinta');
    expect(normalizarTag("@a'; drop")).toBe('adrop');
  });
});

describe('SQL da Gestão de Obras segue as regras das auditorias', () => {
  const dir = join(__dirname, '../../migrations');
  const b = readFileSync(join(dir, '2026-09-24-b-gestao-obras-tabelas.sql'), 'utf8');
  const c = readFileSync(join(dir, '2026-09-24-c-gestao-obras-funcoes.sql'), 'utf8');
  const a = readFileSync(join(dir, '2026-09-24-a-quotes-update-so-pintor.sql'), 'utf8');

  it('RLS nas 3 tabelas e anon revogado', () => {
    for (const t of ['obras', 'obra_equipe', 'obra_escala']) {
      expect(b).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    }
    expect(b).toMatch(/REVOKE ALL ON public\.obras, public\.obra_equipe, public\.obra_escala FROM anon/);
  });

  it('auth.uid() / is_portal_admin() em policy sempre embrulhados em (SELECT …)', () => {
    const policies = b.slice(b.indexOf('CREATE POLICY'));
    const semSelect = policies.match(/(?<!SELECT )(auth\.uid\(\)|public\.is_portal_admin\(\))/g) ?? [];
    expect(semSelect).toEqual([]);
  });

  it('subqueries correlacionadas qualificadas (lição do pentest 09-18)', () => {
    expect(b).toContain('o.id = obra_escala.obra_id');
    expect(b).toContain('m.id = obra_escala.equipe_id');
    expect(b).toContain('q.id = obras.quote_id');
  });

  it('toda SECURITY DEFINER tem search_path', () => {
    const defs = c.match(/LANGUAGE \w+ (?:STABLE )?SECURITY DEFINER[^\n]*/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(8);
    for (const d of defs) expect(d).toContain('SET search_path = public');
  });

  it('RPCs não abertas pra anon; trigger impede gestor de ativar usuário do app', () => {
    expect(c).toMatch(/REVOKE ALL ON FUNCTION public\.minha_agenda_obras\(date, date\) FROM PUBLIC, anon/);
    expect(c).toContain("NEW.status := 'convidado'");
    expect(c).toContain('public.blocked_between(NEW.gestor_id, NEW.membro_id)');
    expect(c).toContain('public.is_email_verified()');
  });

  it('funcionário não tem policy direta (só RPC) — nenhuma policy cita membro_id', () => {
    const policies = b.slice(b.indexOf('CREATE POLICY'), b.indexOf('ALTER TABLE public.jobs'));
    expect(policies).not.toContain('membro_id');
  });

  it('quotes: UPDATE só do pintor (cliente fora)', () => {
    expect(a).toContain('painter_id = (SELECT auth.uid())');
    expect(a).not.toMatch(/CREATE POLICY[\s\S]*client_id/);
  });
});

describe('SQL do acesso do cliente à obra segue as regras das auditorias', () => {
  const dir = join(__dirname, '../../migrations');
  const d = readFileSync(join(dir, '2026-09-25-obra-cliente.sql'), 'utf8');

  it('toda SECURITY DEFINER tem search_path', () => {
    const defs = d.match(/LANGUAGE \w+ (?:STABLE )?SECURITY DEFINER[^\n]*/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(5);
    for (const def of defs) expect(def).toContain('SET search_path = public');
  });

  it('vínculo com cliente respeita e-mail confirmado, bloqueio e rate limit (mesma trava do convite de equipe)', () => {
    expect(d).toContain('public.is_email_verified()');
    expect(d).toContain('public.blocked_between(NEW.owner_id, NEW.client_id)');
    expect(d).toContain("public.check_rate_limit(NEW.owner_id::text, 'obra-cliente-link', 20, 60)");
  });

  it('gestor não pode se vincular como cliente da própria obra', () => {
    expect(d).toContain('NEW.client_id = NEW.owner_id');
  });

  it('RPCs do cliente não abertas pra anon', () => {
    expect(d).toMatch(/REVOKE ALL ON FUNCTION public\.minhas_obras_cliente\(\) FROM PUBLIC, anon/);
    expect(d).toMatch(/REVOKE ALL ON FUNCTION public\.obra_equipe_cliente\(uuid\) FROM PUBLIC, anon/);
    expect(d).toMatch(/REVOKE ALL ON FUNCTION public\.obra_agenda_cliente\(uuid, date, date\) FROM PUBLIC, anon/);
  });

  it('RPCs do cliente nunca selecionam valor nem observações da obra', () => {
    const rpcs = d.slice(d.indexOf('CREATE OR REPLACE FUNCTION public.minhas_obras_cliente'));
    expect(rpcs).not.toMatch(/\bo\.valor\b/);
    expect(rpcs).not.toMatch(/\bo\.observacoes\b/);
  });

  it('agenda e equipe do cliente sempre filtram pelo próprio vínculo (o.client_id = auth.uid())', () => {
    const agenda = d.slice(d.indexOf('CREATE OR REPLACE FUNCTION public.obra_agenda_cliente'));
    const equipe = d.slice(d.indexOf('CREATE OR REPLACE FUNCTION public.obra_equipe_cliente'), d.indexOf('CREATE OR REPLACE FUNCTION public.obra_agenda_cliente'));
    expect(agenda).toContain('o.client_id = auth.uid()');
    expect(equipe).toContain('o.client_id = auth.uid()');
  });
});
