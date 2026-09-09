// lib/api/_services/admin-stats.ts — "Uso do app": quem faz o que na
// plataforma (2026-09-09, pedido do usuário: "tela de estatística/relatório
// mostrando dashboard em relação ao uso do app: quem postou mais fotos,
// vídeos, colocou à venda, teve mais curtidas, convidou mais pessoas, pediu
// material na loja, camisa, uso das IAs, fez orçamentos").
//
// Por que é uma rota com SERVICE ROLE e não uma consulta do portal:
// `ai_usage`, `referrals` e `points` têm RLS "cada um vê o seu", então o
// admin logado no portal (chave anon + sessão) veria só as próprias linhas
// — ranking vazio parecendo "ninguém usa". Aqui o servidor lê tudo, agrega
// e devolve só o resumo por pessoa. Nenhum SQL novo pra isso.
//
// `montarRelatorio` é PURA (arrays → relatório) e testada em
// `__tests__/services/admin-stats.test.ts`; `buscarTabela` é a paginação
// (PostgREST corta em 1000 linhas e não avisa — lição dos leads).

import { ServiceError } from '../security';

export type Linha = Record<string, unknown>;

export interface DadosBrutos {
  profiles: Linha[];
  posts: Linha[];
  likes: Linha[];
  comments: Linha[];
  referrals: Linha[];
  orders: Linha[];
  logos: Linha[];
  aiUsage: Linha[];
  quotes: Linha[];
  reviews: Linha[];
  follows: Linha[];
}

export interface PessoaDoRelatorio {
  id: string;
  nome: string;
  tag: string | null;
  avatar: string | null;
  papel: string | null;
  cidade: string | null;
  fotos: number;
  videos: number;
  venda: number;
  curtidas: number;       // recebidas nos posts dela
  comentarios: number;    // recebidos nos posts dela
  comentou: number;       // que ela escreveu
  seguidores: number;
  indicacoes: number;
  pedidos: number;        // pedidos na loja (orders)
  itensPedidos: number;
  camisetas: number;      // pedidos com camiseta personalizada
  logos: number;          // brand_logos (gerou/enviou logo = quer camisa)
  ia: number;             // chamadas de IA (todas as features)
  iaPorFeature: Record<string, number>;
  orcamentosFeitos: number;   // como profissional (painter_id)
  orcamentosPedidos: number;  // como cliente (client_id)
  avaliacoes: number;         // recebidas
  notaMedia: number | null;
  ultimaAtividade: string | null;
  atividade: number;      // pontuação pra ordenar "quem mais usa"
}

export interface Relatorio {
  desde: string | null;
  geradoEm: string;
  totais: {
    pessoas: number; ativas: number; fotos: number; videos: number; venda: number;
    curtidas: number; comentarios: number; indicacoes: number; pedidos: number;
    camisetas: number; logos: number; ia: number; orcamentos: number; avaliacoes: number;
  };
  iaPorFeature: Array<{ feature: string; chamadas: number; pessoas: number }>;
  rankings: Record<string, Array<{ id: string; nome: string; tag: string | null; avatar: string | null; papel: string | null; n: number }>>;
  pessoas: PessoaDoRelatorio[];
  truncado: string[];
}

const TAMANHO_PAGINA = 1000;
const PAGINAS_PARALELO = 4;
const MAX_PAGINAS = 40;   // 40 mil linhas por tabela; passou disso, avisa `truncado`
const TIMEOUT_MS = 12000;

/** Lê uma tabela inteira pelo REST com service role, paginando. */
export async function buscarTabela(args: {
  supaUrl: string;
  serviceKey: string;
  tabela: string;
  select: string;
  filtros?: string[];
  maxPaginas?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ rows: Linha[]; truncado: boolean }> {
  const f = args.fetchImpl || fetch;
  const maxPaginas = args.maxPaginas ?? MAX_PAGINAS;
  const qs = [`select=${encodeURIComponent(args.select)}`].concat(args.filtros || []).join('&');
  const url = `${args.supaUrl}/rest/v1/${args.tabela}?${qs}`;
  const headers = { apikey: args.serviceKey, Authorization: `Bearer ${args.serviceKey}`, Prefer: 'count=exact' };
  const pagina = async (n: number): Promise<{ rows: Linha[]; total: number | null }> => {
    const de = n * TAMANHO_PAGINA;
    const res = await f(url, { headers: { ...headers, Range: `${de}-${de + TAMANHO_PAGINA - 1}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new ServiceError(`${args.tabela}: ${res.status} ${t.slice(0, 160)}`, 502);
    }
    const rows = (await res.json()) as Linha[];
    const cr = res.headers.get('content-range') || '';
    const m = /\/(\d+)$/.exec(cr);
    return { rows: Array.isArray(rows) ? rows : [], total: m ? Number(m[1]) : null };
  };
  const primeira = await pagina(0);
  const paginas: Linha[][] = [primeira.rows];
  const total = primeira.total ?? primeira.rows.length;
  const nPaginas = Math.ceil(total / TAMANHO_PAGINA);
  const faltando: number[] = [];
  for (let n = 1; n < Math.min(nPaginas, maxPaginas); n++) faltando.push(n);
  let cursor = 0;
  const trabalhador = async () => {
    while (cursor < faltando.length) {
      const n = faltando[cursor++];
      paginas[n] = (await pagina(n)).rows;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAGINAS_PARALELO, faltando.length) }, trabalhador));
  const rows: Linha[] = [];
  for (const p of paginas) if (p) rows.push(...p);
  return { rows, truncado: nPaginas > maxPaginas };
}

const ehVideo = (url: unknown, tipo: unknown): boolean =>
  tipo === 'video' || /\.(mp4|webm|mov|m4v|ogg|ogv)(\?|#|$)/i.test(String(url || ''));

/** Item de pedido que é a camiseta personalizada do app (`shirt-<cor>-<tam>`). */
export const ehItemDeCamiseta = (it: unknown): boolean => {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  const p = (o.product && typeof o.product === 'object' ? (o.product as Record<string, unknown>) : o);
  const id = String(p.id ?? o.id ?? o.product_id ?? '');
  const nome = String(p.name ?? o.name ?? '');
  return /^shirt-/.test(id) || /camiseta personalizada/i.test(nome);
};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const maisRecente = (a: string | null, b: unknown): string | null => {
  const s = str(b);
  if (!s) return a;
  return !a || s > a ? s : a;
};

/** Agrega os arrays crus num relatório por pessoa + rankings. Pura. */
export function montarRelatorio(d: DadosBrutos, opts: { desde?: string | null; topN?: number; truncado?: string[] } = {}): Relatorio {
  const topN = opts.topN ?? 10;
  const pessoas = new Map<string, PessoaDoRelatorio>();
  const pessoa = (id: unknown): PessoaDoRelatorio | null => {
    const k = str(id);
    if (!k) return null;
    let p = pessoas.get(k);
    if (!p) {
      p = { id: k, nome: '(sem perfil)', tag: null, avatar: null, papel: null, cidade: null, fotos: 0, videos: 0, venda: 0,
        curtidas: 0, comentarios: 0, comentou: 0, seguidores: 0, indicacoes: 0, pedidos: 0, itensPedidos: 0, camisetas: 0,
        logos: 0, ia: 0, iaPorFeature: {}, orcamentosFeitos: 0, orcamentosPedidos: 0, avaliacoes: 0, notaMedia: null,
        ultimaAtividade: null, atividade: 0 };
      pessoas.set(k, p);
    }
    return p;
  };
  for (const pr of d.profiles) {
    const p = pessoa(pr.id);
    if (!p) continue;
    p.nome = str(pr.name) || str(pr.business_name) || (str(pr.tag) ? '@' + pr.tag : '(sem nome)');
    p.tag = str(pr.tag) || str(pr.username);
    p.avatar = str(pr.avatar_url);
    p.papel = str(pr.role) || str(pr.user_type);
    p.cidade = str(pr.city);
  }
  // Posts: fotos × vídeos × à venda; guarda o autor de cada post pras
  // curtidas/comentários RECEBIDOS.
  const autorDoPost = new Map<string, string>();
  for (const po of d.posts) {
    if (po.deleted_at) continue;
    const p = pessoa(po.user_id);
    if (!p) continue;
    if (str(po.id)) autorDoPost.set(String(po.id), p.id);
    if (ehVideo(po.media_url, po.media_type)) p.videos++; else p.fotos++;
    if (po.for_sale === true) p.venda++;
    p.ultimaAtividade = maisRecente(p.ultimaAtividade, po.created_at);
  }
  for (const l of d.likes) {
    const autor = autorDoPost.get(String(l.post_id));
    if (autor) { const p = pessoa(autor); if (p) p.curtidas++; }
    const quem = pessoa(l.user_id);
    if (quem) quem.ultimaAtividade = maisRecente(quem.ultimaAtividade, l.created_at);
  }
  for (const c of d.comments) {
    if (c.deleted_at) continue;
    const autor = autorDoPost.get(String(c.post_id));
    if (autor) { const p = pessoa(autor); if (p) p.comentarios++; }
    const quem = pessoa(c.user_id);
    if (quem) { quem.comentou++; quem.ultimaAtividade = maisRecente(quem.ultimaAtividade, c.created_at); }
  }
  for (const f of d.follows) { const p = pessoa(f.following_id); if (p) p.seguidores++; }
  for (const r of d.referrals) {
    const p = pessoa(r.referrer_id);
    if (p) { p.indicacoes++; p.ultimaAtividade = maisRecente(p.ultimaAtividade, r.created_at); }
  }
  for (const o of d.orders) {
    const p = pessoa(o.user_id);
    if (!p) continue;
    p.pedidos++;
    const itens = Array.isArray(o.items) ? (o.items as unknown[]) : [];
    p.itensPedidos += itens.length;
    if (itens.some(ehItemDeCamiseta)) p.camisetas++;
    p.ultimaAtividade = maisRecente(p.ultimaAtividade, o.created_at);
  }
  for (const lg of d.logos) {
    const p = pessoa(lg.user_id);
    if (p) { p.logos++; p.ultimaAtividade = maisRecente(p.ultimaAtividade, lg.created_at); }
  }
  const featureTotal = new Map<string, { chamadas: number; pessoas: Set<string> }>();
  for (const u of d.aiUsage) {
    const p = pessoa(u.user_id);
    if (!p) continue;
    const feat = str(u.feature) || 'outro';
    const n = Math.max(1, Number(u.cost_units) || 1);
    p.ia += n;
    p.iaPorFeature[feat] = (p.iaPorFeature[feat] || 0) + n;
    p.ultimaAtividade = maisRecente(p.ultimaAtividade, u.used_at);
    let ft = featureTotal.get(feat);
    if (!ft) { ft = { chamadas: 0, pessoas: new Set() }; featureTotal.set(feat, ft); }
    ft.chamadas += n; ft.pessoas.add(p.id);
  }
  for (const q of d.quotes) {
    if (q.deleted_at) continue;
    const pintor = pessoa(q.painter_id);
    if (pintor) { pintor.orcamentosFeitos++; pintor.ultimaAtividade = maisRecente(pintor.ultimaAtividade, q.created_at); }
    const cliente = pessoa(q.client_id);
    if (cliente) { cliente.orcamentosPedidos++; cliente.ultimaAtividade = maisRecente(cliente.ultimaAtividade, q.created_at); }
  }
  const somaNotas = new Map<string, number>();
  for (const r of d.reviews) {
    const p = pessoa(r.painter_id);
    if (!p) continue;
    p.avaliacoes++;
    const nota = Number(r.rating);
    if (Number.isFinite(nota)) somaNotas.set(p.id, (somaNotas.get(p.id) || 0) + nota);
    const quem = pessoa(r.reviewer_id);
    if (quem) quem.ultimaAtividade = maisRecente(quem.ultimaAtividade, r.created_at);
  }
  for (const p of pessoas.values()) {
    const soma = somaNotas.get(p.id);
    p.notaMedia = p.avaliacoes && soma !== undefined ? Math.round((soma / p.avaliacoes) * 10) / 10 : null;
    // Peso de cada gesto: publicar e orçar valem mais que curtir/comentar;
    // pedido na loja é o que a Cali Colors mais quer ver.
    p.atividade = p.fotos * 3 + p.videos * 4 + p.venda * 2 + p.comentou + p.indicacoes * 5
      + p.pedidos * 6 + p.camisetas * 3 + p.logos * 2 + p.ia + p.orcamentosFeitos * 4 + p.orcamentosPedidos * 3;
  }
  const lista = [...pessoas.values()].sort((a, b) => b.atividade - a.atividade || a.nome.localeCompare(b.nome));
  const rank = (campo: keyof PessoaDoRelatorio) =>
    lista.filter(p => (p[campo] as number) > 0).sort((a, b) => (b[campo] as number) - (a[campo] as number)).slice(0, topN)
      .map(p => ({ id: p.id, nome: p.nome, tag: p.tag, avatar: p.avatar, papel: p.papel, n: p[campo] as number }));
  const soma = (campo: keyof PessoaDoRelatorio) => lista.reduce((s, p) => s + ((p[campo] as number) || 0), 0);
  return {
    desde: opts.desde || null,
    geradoEm: new Date().toISOString(),
    totais: {
      pessoas: lista.length,
      ativas: lista.filter(p => p.atividade > 0).length,
      fotos: soma('fotos'), videos: soma('videos'), venda: soma('venda'),
      curtidas: d.likes.length, comentarios: d.comments.filter(c => !c.deleted_at).length,
      indicacoes: d.referrals.length, pedidos: d.orders.length, camisetas: soma('camisetas'),
      logos: d.logos.length, ia: soma('ia'), orcamentos: d.quotes.filter(q => !q.deleted_at).length,
      avaliacoes: d.reviews.length,
    },
    iaPorFeature: [...featureTotal.entries()].map(([feature, v]) => ({ feature, chamadas: v.chamadas, pessoas: v.pessoas.size }))
      .sort((a, b) => b.chamadas - a.chamadas),
    rankings: {
      fotos: rank('fotos'), videos: rank('videos'), venda: rank('venda'), curtidas: rank('curtidas'),
      comentarios: rank('comentarios'), seguidores: rank('seguidores'), indicacoes: rank('indicacoes'),
      pedidos: rank('pedidos'), camisetas: rank('camisetas'), logos: rank('logos'), ia: rank('ia'),
      orcamentosFeitos: rank('orcamentosFeitos'), orcamentosPedidos: rank('orcamentosPedidos'),
      avaliacoes: rank('avaliacoes'), atividade: rank('atividade'),
    },
    pessoas: lista,
    truncado: opts.truncado || [],
  };
}

/** Busca tudo e monta o relatório. `desde` (ISO) limita pelo created_at. */
export async function gerarRelatorioDeUso(args: {
  supaUrl: string;
  serviceKey: string;
  desde?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<Relatorio> {
  const desde = args.desde && !Number.isNaN(Date.parse(args.desde)) ? new Date(args.desde).toISOString() : null;
  const periodo = (col: string) => (desde ? [`${col}=gte.${encodeURIComponent(desde)}`] : []);
  const base = { supaUrl: args.supaUrl, serviceKey: args.serviceKey, fetchImpl: args.fetchImpl };
  const tabelas: Array<[keyof DadosBrutos, string, string, string[]]> = [
    ['profiles', 'profiles', 'id,name,business_name,tag,username,avatar_url,role,user_type,city', []],
    ['posts', 'posts', 'id,user_id,media_url,media_type,for_sale,created_at,deleted_at', periodo('created_at')],
    ['likes', 'likes', 'post_id,user_id,created_at', periodo('created_at')],
    ['comments', 'comments', 'post_id,user_id,created_at,deleted_at', periodo('created_at')],
    ['referrals', 'referrals', 'referrer_id,created_at', periodo('created_at')],
    ['orders', 'orders', 'user_id,items,created_at', periodo('created_at')],
    ['logos', 'brand_logos', 'user_id,created_at', periodo('created_at')],
    ['aiUsage', 'ai_usage', 'user_id,feature,cost_units,used_at', periodo('used_at')],
    ['quotes', 'quotes', 'painter_id,client_id,created_at,deleted_at', periodo('created_at')],
    ['reviews', 'reviews', 'painter_id,reviewer_id,rating,created_at', periodo('created_at')],
    ['follows', 'follows', 'following_id', []],
  ];
  const dados = { profiles: [], posts: [], likes: [], comments: [], referrals: [], orders: [], logos: [], aiUsage: [], quotes: [], reviews: [], follows: [] } as DadosBrutos;
  const truncado: string[] = [];
  const falhas: string[] = [];
  await Promise.all(tabelas.map(async ([chave, tabela, select, filtros]) => {
    try {
      const r = await buscarTabela({ ...base, tabela, select, filtros });
      dados[chave] = r.rows;
      if (r.truncado) truncado.push(tabela);
    } catch (e) {
      // Uma tabela fora do ar (ou coluna que não existe) não derruba o
      // relatório inteiro: a métrica dela sai zerada e o nome vai no aviso.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('admin-stats:', tabela, msg);
      falhas.push(`${tabela} (${msg.slice(0, 80)})`);
    }
  }));
  if (falhas.length === tabelas.length) throw new ServiceError('Nenhuma tabela respondeu: ' + falhas[0], 502);
  const rel = montarRelatorio(dados, { desde, truncado: truncado.concat(falhas.map(f => 'falhou: ' + f)) });
  return rel;
}
