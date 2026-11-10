// mural-condominio.ts — lê os murais de classificados de condomínio
// (plataforma Vida de Síndico) e separa os anúncios em que alguém PROCURA
// pintor. Chamado 1x/dia pelo cron (POST /api/oportunidades/varrer) e pelo
// botão "Ler agora" do portal.
//
// AUTORIZAÇÃO: o robots.txt desses sites termina em `User-agent: * /
// Disallow: /`. A leitura só existe porque o usuário informou, em
// 2026-11-10, que a plataforma autorizou. Sem isso, não ligar pra site novo.
//
// O QUE NÃO FAZEMOS, de propósito:
//  - NÃO decodificamos o e-mail: o site o entrega ofuscado (proteção
//    anti-coleta da Cloudflare, `data-cfemail`). O registro leva o link do
//    mural e a pessoa da equipe vê o e-mail lá.
//  - NÃO guardamos anúncio que não seja pedido de pintor (aluguel, venda,
//    oferta de serviço): o resto do mural não é assunto nosso.
//  - Nada disso vai pro app: entra como tipo='pedido', status='conferir'.

import { isPubliclyRoutableHttpsUrl } from '@/lib/api/ssrf-guard';

export const USER_AGENT_DA_VARREDURA =
  'QueroUmaCorBot/1.0 (+https://www.queroumacor.com.br; loja@calicolors.com.br)';
const TETO_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
// 12 por rodada, 4 de cada vez: cada mural custa até 3 chamadas (página,
// gravação, carimbo) e páginas chegam a ~2 MB — 20 em paralelo passaria do
// limite de subrequisições do plano gratuito do Worker (50) e pesaria na
// memória. O cron roda de 4 em 4 horas e o rodízio cobre o resto.
const MAX_FONTES = 12;
const EM_PARALELO = 4;

export interface AnuncioDoMural {
  titulo: string;
  descricao: string;
  preco: string | null;
  anunciante: string | null;
  telefone: string | null;
  temEmail: boolean;
}

function texto(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // `&amp;` por ÚLTIMO: decodificado antes, "&amp;lt;" viraria "<" (duas
    // decodificações do mesmo texto).
    .replace(/&amp;/g, '&')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function campo(card: string, classe: string): string {
  const m = new RegExp(`class="${classe}"[^>]*>([\\s\\S]*?)</div>`).exec(card);
  return m ? texto(m[1]) : '';
}

function linha(card: string, rotulo: string): string {
  const m = new RegExp(
    `<span class="label">\\s*${rotulo}:(?:&nbsp;|\\s)*</span>([\\s\\S]*?)</div>`,
    'i',
  ).exec(card);
  return m ? texto(m[1]) : '';
}

const FONE_NO_TEXTO = /\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/;

/**
 * O campo Preço é obrigatório no mural, então vem lixo de quem só queria
 * publicar ("R$ 1,00", "..", "Combinar"). Só guarda valor em reais de verdade.
 */
export function precoUtil(preco: string): string | null {
  const m = /R\$\s*([\d.]+)(?:,\d{2})?/.exec(preco);
  if (!m) return null;
  return Number(m[1].replace(/\./g, '')) >= 50 ? preco.slice(0, 80) : null;
}

/** Cada cartão `.anuncio_conteudo` do HTML vira um anúncio. */
export function extrairAnuncios(html: string): AnuncioDoMural[] {
  const out: AnuncioDoMural[] = [];
  const partes = html.split('<div class="anuncio_conteudo">').slice(1);
  for (const parte of partes) {
    const card = parte.split('class="mostrar-menos')[0];
    const titulo = campo(card, 'titulo_int').slice(0, 120);
    const descricao = campo(card, 'descricao_int').slice(0, 1000);
    if (!titulo && !descricao) continue;
    const preco = linha(card, 'Pre[çc]o');
    const anunciante = linha(card, 'Contato');
    // Sem a linha "Telefone", muita gente escreve o número na descrição.
    const telefone = linha(card, 'Telefone') || (FONE_NO_TEXTO.exec(descricao)?.[0] ?? '');
    out.push({
      titulo,
      descricao,
      preco: precoUtil(preco),
      anunciante: anunciante ? anunciante.slice(0, 80) : null,
      telefone: telefone ? telefone.slice(0, 40) : null,
      temEmail: /class="label">\s*E-mail:/i.test(card),
    });
  }
  return out;
}

const semAcento = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * "Alguém PROCURA pintor" × "alguém OFERECE pintura". O mural tem os dois
 * ("Pinturas em geral — faça já seu orçamento"); só o primeiro é pedido.
 * Na dúvida (fala de pintura sem sinal de procura) NÃO entra: melhor perder
 * um pedido do que encher o portal de propaganda de concorrente.
 */
export function ehPedidoDePintor(titulo: string, descricao: string): boolean {
  const t = semAcento(`${titulo} ${descricao}`);
  // Variações e serviços vizinhos pedidos pelo usuário em 10/11/2026
  // ("pintei", "repintura", textura, grafiato, massa corrida, verniz).
  const falaDePintura =
    /\b(re)?pint(or|ora|ores|ar|ura|uras|ei|ando|ada|adas|ado|ados)\b/.test(t) ||
    // "Tudo que pode estar relacionado a pintura" (decisão do usuário).
    /\b(texturas?|texturizad[oa]s?|grafiato|marmorato|cimento queimado|massa corrida|massa acrilica|emass(ar|amento)|lix(ar|amento)|selador|verniz|enverniz(ar|amento)|stain|esmalte|laca|laque(ar|acao|ado|ada)|epoxi|latex|tintas?|demaos?|cai(ar|acao)|retoques?|grafit(e|es|eiro|eira|agem)|impermeabiliz(ar|acao|ante))\b/.test(t);
  if (!falaDePintura) return false;
  const oferta =
    /\b(faco|fazemos|ofereco|oferecemos|aplico|aplicamos|realizo|realizamos|trabalho com|trabalhamos|faca ja|orcamento conosco|sem compromisso|pinturas em geral|servicos de pintura|sou pintor|somos)\b/.test(
      t,
    );
  const procura =
    /\b(procuro|procura-se|procurando|preciso|precisando|precisamos|necessito|alguem indica|indicacao|indicacoes|indiquem|indicam|indica|conhece|conhecem|recomenda|recomendam|recomendacao|quem faz|quem faca|contratar|quero pintar|gostaria de pintar|busco)\b/.test(
      t,
    );
  return procura && !oferta;
}

export async function chaveDoAnuncio(fonteUrl: string, a: AnuncioDoMural): Promise<string> {
  const base = `${fonteUrl}|${semAcento(a.titulo)}|${semAcento(a.descricao)}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface FonteDeMural {
  id: string;
  nome: string;
  url: string;
  cidade: string | null;
  bairro: string | null;
}

/** Linha de `oportunidades` pra um pedido achado no mural. */
export async function linhaDaOportunidade(fonte: FonteDeMural, a: AnuncioDoMural) {
  const partes = [a.descricao, a.anunciante ? `Anunciante: ${a.anunciante}.` : '']
    .filter(Boolean)
    .join(' ');
  return {
    tipo: 'pedido',
    status: 'conferir',
    regime: 'orcamento',
    titulo: (a.titulo || 'Pedido de pintor').slice(0, 120),
    cidade: fonte.cidade,
    bairro: fonte.bairro,
    descricao: partes.slice(0, 1500) || null,
    remuneracao: a.preco,
    contato: a.telefone,
    contato_whatsapp: false,
    contato_obs: a.telefone
      ? null
      : a.temEmail
        ? 'E-mail no mural: abrir o link do anúncio.'
        : 'Contato no mural: abrir o link do anúncio.',
    fonte: `Mural ${fonte.nome}`.slice(0, 60),
    fonte_url: fonte.url,
    chave: await chaveDoAnuncio(fonte.url, a),
  };
}

async function baixar(url: string): Promise<string> {
  if (!isPubliclyRoutableHttpsUrl(url)) throw new Error('endereço não permitido');
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT_DA_VARREDURA, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Redirect pode levar pra outro host: confere o destino final também.
  if (res.url && !isPubliclyRoutableHttpsUrl(res.url)) throw new Error('redirecionou pra endereço não permitido');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tamanho = Number(res.headers.get('content-length') || 0);
  if (tamanho > TETO_BYTES) throw new Error('página grande demais');
  return lerComTeto(res, TETO_BYTES);
}

/**
 * Lê o corpo AOS PEDAÇOS e para no teto. `res.text()` carregaria tudo antes
 * de conferir o tamanho — resposta chunked ou comprimida não tem
 * Content-Length confiável, e várias fontes baixam ao mesmo tempo no Worker.
 */
export async function lerComTeto(res: Response, teto: number): Promise<string> {
  if (!res.body) {
    const t = await res.text();
    if (t.length > teto) throw new Error('página grande demais');
    return t;
  }
  const leitor = res.body.getReader();
  const dec = new TextDecoder();
  let total = 0;
  let html = '';
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      throw new Error('página grande demais');
    }
    html += dec.decode(value, { stream: true });
  }
  return html + dec.decode();
}

export interface ResultadoDaVarredura {
  fontes: number;
  anuncios: number;
  pedidos: number;
  novos: number;
  falhas: number;
}

interface Banco {
  supaUrl: string;
  serviceKey: string;
}

function cabecalhos(b: Banco, extra: Record<string, string> = {}) {
  return {
    apikey: b.serviceKey,
    Authorization: `Bearer ${b.serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function lerUmaFonte(b: Banco, fonte: FonteDeMural) {
  const anuncios = extrairAnuncios(await baixar(fonte.url));
  const pedidos = anuncios.filter((a) => ehPedidoDePintor(a.titulo, a.descricao));
  let novos = 0;
  if (pedidos.length) {
    const linhas = await Promise.all(pedidos.map((a) => linhaDaOportunidade(fonte, a)));
    // ON CONFLICT (chave) DO NOTHING: anúncio já visto não volta nem perde o
    // status que a equipe deu. `return=representation` conta só os NOVOS.
    const res = await fetch(`${b.supaUrl}/rest/v1/oportunidades?on_conflict=chave`, {
      method: 'POST',
      headers: cabecalhos(b, { Prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify(linhas),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`banco recusou (${res.status})`);
    const gravadas = (await res.json().catch(() => [])) as unknown[];
    novos = Array.isArray(gravadas) ? gravadas.length : 0;
  }
  return { anuncios: anuncios.length, pedidos: pedidos.length, novos };
}

export async function varrerMurais(b: Banco): Promise<ResultadoDaVarredura> {
  const base = b.supaUrl.replace(/\/$/, '');
  const banco = { ...b, supaUrl: base };
  const r = await fetch(
    `${base}/rest/v1/oportunidade_fontes?select=id,nome,url,cidade,bairro&ativo=eq.true&order=lida_em.asc.nullsfirst,created_at.asc&limit=${MAX_FONTES}`,
    { headers: cabecalhos(banco), signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) throw new Error(`não consegui ler as fontes (${r.status})`);
  // Ordem = a que está há mais tempo sem ler primeiro (nunca lida na frente).
  // Com mais fontes ativas do que MAX_FONTES, cada leitura pega as seguintes
  // da fila em vez de repetir sempre as mesmas e deixar o resto sem ler.
  const fontes = (await r.json()) as FonteDeMural[];
  const total: ResultadoDaVarredura = { fontes: fontes.length, anuncios: 0, pedidos: 0, novos: 0, falhas: 0 };

  const lerECarimbar = async (fonte: FonteDeMural) => {
      let resultado: string;
      try {
        const x = await lerUmaFonte(banco, fonte);
        total.anuncios += x.anuncios;
        total.pedidos += x.pedidos;
        total.novos += x.novos;
        resultado = `${x.anuncios} anúncios lidos, ${x.pedidos} pedidos de pintor, ${x.novos} novos`;
      } catch (e) {
        total.falhas += 1;
        resultado = `Falhou: ${e instanceof Error ? e.message : 'erro'}`.slice(0, 300);
      }
      // Best-effort: não conseguir carimbar a fonte não invalida a leitura.
      await fetch(`${base}/rest/v1/oportunidade_fontes?id=eq.${fonte.id}`, {
        method: 'PATCH',
        headers: cabecalhos(banco, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ lida_em: new Date().toISOString(), resultado }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
  };
  for (let i = 0; i < fontes.length; i += EM_PARALELO) {
    await Promise.all(fontes.slice(i, i + EM_PARALELO).map(lerECarimbar));
  }
  return total;
}
