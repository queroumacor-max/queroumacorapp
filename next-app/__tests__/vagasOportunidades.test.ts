// Vagas e oportunidades (2026-11-10): a equipe cadastra e classifica no
// portal; vaga ativa aparece no app, pedido de cliente nunca.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDoAnuncio, fonteSegura, linkDoContato, localDaVaga, rotuloDoRegime } from '@/lib/vagas';
import { ehTabelaAusente } from '@/lib/services/vagas';

const raiz = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');
const sql = readFileSync(join(raiz, '..', 'migrations', '2026-11-10-b-oportunidades.sql'), 'utf8');

describe('lib/vagas', () => {
  it('WhatsApp vira wa.me com 55 e mensagem citando a vaga', () => {
    const l = linkDoContato({ contato: '(11) 96655-8012', contato_whatsapp: true, titulo: 'Pintor predial' });
    expect(l).toMatch(/^https:\/\/wa\.me\/5511966558012\?text=/);
    expect(decodeURIComponent(l!)).toContain('Pintor predial');
  });
  it('telefone comum vira tel:, e número inválido não vira link', () => {
    expect(linkDoContato({ contato: '11 2400-1234', contato_whatsapp: false, titulo: 'x' })).toBe('tel:+551124001234');
    expect(linkDoContato({ contato: 'ramal 12', contato_whatsapp: true, titulo: 'x' })).toBe(null);
    expect(linkDoContato({ contato: null, contato_whatsapp: true, titulo: 'x' })).toBe(null);
  });
  it('fonte só vira link se for https', () => {
    expect(fonteSegura('https://www.infojobs.com.br/vaga')).toBe('https://www.infojobs.com.br/vaga');
    expect(fonteSegura('javascript:alert(1)')).toBe(null);
    expect(fonteSegura('http://exemplo.com')).toBe(null);
    expect(fonteSegura('')).toBe(null);
  });
  it('data do anúncio sai em dd/mm/aaaa sem passar por fuso; local junta bairro e cidade', () => {
    expect(dataDoAnuncio('2026-09-23')).toBe('23/09/2026');
    expect(dataDoAnuncio(null)).toBe(null);
    expect(localDaVaga({ bairro: 'Vila Aeroporto', cidade: 'Guarulhos' })).toBe('Vila Aeroporto, Guarulhos');
  });
  it('regime vira rótulo; desconhecido ou vazio não aparece', () => {
    expect(rotuloDoRegime('clt')).toBe('CLT');
    expect(rotuloDoRegime('orcamento')).toBe(null);
    expect(rotuloDoRegime(null)).toBe(null);
  });
  it('tabela ausente é reconhecida (a tela fica vazia em vez de quebrar)', () => {
    expect(ehTabelaAusente({ code: '42P01', message: 'x' })).toBe(true);
    expect(ehTabelaAusente({ code: 'PGRST205', message: 'x' })).toBe(true);
    expect(ehTabelaAusente({ message: 'permission denied' })).toBe(false);
  });
});

describe('SQL de oportunidades', () => {
  it('usuário comum só lê vaga ativa; pedido de cliente não tem policy pública', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    const publica = sql.match(/CREATE POLICY oportunidades_vaga_ativa_select[^;]*;/)![0];
    expect(publica).toContain("FOR SELECT TO authenticated USING (tipo = 'vaga' AND status = 'ativa')");
    const policies = sql.match(/CREATE POLICY[^;]*;/g) || [];
    expect(policies.length).toBe(2);
    expect(sql).toContain('REVOKE ALL ON public.oportunidades FROM anon');
    expect(sql).not.toMatch(/TO (anon|public)\b/i);
  });
  it('a policy de admin embrulha is_portal_admin e o link exige https', () => {
    expect(sql).toMatch(/oportunidades_admin_all[^;]*USING \(\(SELECT public\.is_portal_admin\(\)\)\) WITH CHECK \(\(SELECT public\.is_portal_admin\(\)\)\)/);
    expect(sql).toContain("fonte_url ~* '^https://'");
  });
  it('o arquivo não carrega telefone de ninguém (a carga inicial vai pelo chat/portal)', () => {
    expect(sql).not.toMatch(/INSERT INTO/i);
  });
});

describe('colunas da 2ª leva (regime, conferido_em)', () => {
  it('entram por ALTER idempotente e o serviço refaz a consulta sem elas', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS regime');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS conferido_em');
    const svc = ler('lib/services/vagas.ts');
    expect(svc).toContain('consultar(COLUNAS_BASE)');
  });
});

describe('app', () => {
  it('o serviço filtra vaga ativa mesmo pra admin (que a RLS deixa ver tudo)', () => {
    const svc = ler('lib/services/vagas.ts');
    expect(svc).toContain(".eq('tipo', 'vaga')");
    expect(svc).toContain(".eq('status', 'ativa')");
  });
  it('a tela abre contato e fonte por abrirLinkExterno, nunca por navegação de documento', () => {
    const tela = ler('app/vagas/VagasView.tsx');
    expect(tela).toContain('abrirLinkExterno(link)');
    expect(tela).not.toMatch(/window\.location|<a\s[^>]*href=\{(link|fonte)\}/);
  });
  it('cliente não vê o tile Vagas', () => {
    expect(ler('app/perfil/BusinessGrid.tsx')).toContain("if (t.sheet === 'vagas') return showAdmin || userRole !== 'cliente';");
  });
});

describe('portal', () => {
  const jsx = ler('public/portal/app.jsx');
  const trecho = jsx.split('// [teste:oportunidades-inicio]')[1].split('// [teste:oportunidades-fim]')[0];
  const h = new Function(trecho + ';return {lerAnuncio, fonteUrlValida, oportunidadeVisivelNoApp, duplicatasDe};')() as {
    lerAnuncio: (t: string) => { tipo: string; regime: string; contato: string; remuneracao: string; whatsapp: boolean };
    duplicatasDe: (c: string, l: { id: string; contato: string }[], ign?: string | null) => { id: string }[];
    fonteUrlValida: (u: string) => boolean;
    oportunidadeVisivelNoApp: (o: { tipo: string; status: string }) => boolean;
  };

  it('anúncio de emprego é sugerido como vaga, com telefone, salário e WhatsApp', () => {
    const r = h.lerAnuncio('Vaga temporária de Pintor Predial. Salário R$ 2.612,74 por mês, vale-transporte. Envie o currículo pelo WhatsApp (11) 96655-8012.');
    expect(r.tipo).toBe('vaga');
    expect(r.regime).toBe('temporario');
    expect(r.contato).toBe('(11) 96655-8012');
    expect(r.remuneracao).toContain('R$ 2.612,74');
    expect(r.whatsapp).toBe(true);
  });
  it('morador pedindo indicação é sugerido como pedido', () => {
    const r = h.lerAnuncio('Moradora do bloco B: alguém indica pintor? Preciso de pintor para a sala. Tel 11 97261-0001');
    expect(r.tipo).toBe('pedido');
    expect(r.regime).toBe('orcamento');
    expect(r.contato).toBe('11 97261-0001');
    expect(r.whatsapp).toBe(false);
  });
  it('anúncio de mural só com e-mail: o e-mail vira o contato', () => {
    const r = h.lerAnuncio('Procuro pintor para apartamento de 36 m2. Contato: fulano.silva@exemplo.com');
    expect(r.tipo).toBe('pedido');
    expect(r.contato).toBe('fulano.silva@exemplo.com');
  });
  it('os murais seguem como links, e o código registra que a leitura automática depende de autorização', () => {
    expect(jsx).toContain('OPORT_MURAIS');
    expect(jsx).toMatch(/Disallow: \//);
    expect(jsx).toMatch(/plataforma autorizou/);
  });
  it('texto sem pista não chuta classificação', () => {
    expect(h.lerAnuncio('Bom dia a todos').tipo).toBe('');
  });
  it('só vaga ATIVA é visível no app; pedido nunca', () => {
    expect(h.oportunidadeVisivelNoApp({ tipo: 'vaga', status: 'ativa' })).toBe(true);
    expect(h.oportunidadeVisivelNoApp({ tipo: 'vaga', status: 'conferir' })).toBe(false);
    expect(h.oportunidadeVisivelNoApp({ tipo: 'pedido', status: 'ativa' })).toBe(false);
  });
  it('avisa de duplicata pelo telefone, mesmo com máscara diferente, sem contar o próprio registro', () => {
    const lista = [{ id: 'a', contato: '(11) 96655-8012' }, { id: 'b', contato: '11 91348-4655' }];
    expect(h.duplicatasDe('5511966558012', lista).map((o) => o.id)).toEqual(['a']);
    expect(h.duplicatasDe('(11) 96655-8012', lista, 'a')).toEqual([]);
    expect(h.duplicatasDe('', lista)).toEqual([]);
  });
  it('publicar carimba a data da checagem, e a escrita sobrevive ao banco sem as colunas novas', () => {
    expect(jsx).toMatch(/status === 'ativa' \? \{ status, conferido_em: new Date\(\)\.toISOString\(\) \}/);
    expect(jsx).toContain('oportunidadesService.faltaColunaNova(r.error)');
  });
  it('link do anúncio: vazio ou https', () => {
    expect(h.fonteUrlValida('')).toBe(true);
    expect(h.fonteUrlValida('https://x.com/a')).toBe(true);
    expect(h.fonteUrlValida('javascript:alert(1)')).toBe(false);
  });
  it('tem a tela no menu, com badge do que falta conferir', () => {
    expect(jsx).toContain("id:'oportunidades'");
    expect(jsx).toMatch(/from\('oportunidades'\)[^\n]*eq\('status', 'conferir'\)/);
  });
  it('o trecho testável não tem JSX (senão o arquivo vira "skipped")', () => {
    expect(trecho).not.toMatch(/<[A-Za-z]/);
  });
});
