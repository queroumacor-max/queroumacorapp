// lib/api/_services/whatsapp-ai-runner.ts — cola entre o webhook da
// Evolution e a IA. Roda quando chega mensagem de cliente e decide:
// responder sozinho, escalar pro humano, ou não fazer nada.
//
// Tudo aqui é BEST-EFFORT: qualquer falha volta silenciosa, porque o
// webhook precisa devolver 200 de qualquer jeito (senão a Evolution
// re-entrega em loop) e a mensagem do cliente já foi salva.
//
// Ordem das decisões (a primeira que bater, manda):
//   1. opt-out ("PARE")        → desliga a IA pra sempre nessa conversa
//   2. IA desligada            → não faz nada
//   3. fora do horário comercial → não faz nada (responde no dia seguinte)
//   4. teto diário estourado   → não faz nada (anti-loop)
//   5. gera resposta           → envia; se escalou, desliga a IA e alerta

import { getServiceKey, getSupabaseUrl } from '../security';
import { filtroTelefoneContem } from './_untrusted';
import {
  generateAiReply,
  descreverRegistroDeTemplate,
  isAiConfigured,
  isBusinessHour,
  isOptOut,
  ehRecusaDeAbordagem,
  textoRecusaAgradecida,
  diaBrt,
  MAX_AUTO_REPLIES_PER_DAY,
  parseHoursSetting,
  shouldSendAway,
  textoAusencia,
  type ConversationTurn,
  type LeadContext,
} from './whatsapp-ai';
// Envio pelo canal ÚNICO (Dualhook/Cloud API) desde 2026-09-05 — a Evolution
// foi aposentada. Aqui a janela de 24h da Meta NÃO é problema: tudo neste
// arquivo é reação a uma mensagem que o cliente ACABOU de mandar, então a
// janela está aberta por definição.
import { persistWhatsAppMessage, sendWhatsAppText } from './whatsapp';

const DB_TIMEOUT_MS = 8000;

function rest(path: string): string {
  return `${getSupabaseUrl().replace(/\/$/, '')}/rest/v1/${path}`;
}
function headers(extra?: Record<string, string>): Record<string, string> {
  const k = getServiceKey() || '';
  return {
    apikey: k,
    Authorization: `Bearer ${k}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}
async function dbGet<T>(path: string): Promise<T[]> {
  const r = await fetch(rest(path), {
    headers: headers(),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });
  if (!r.ok) return [];
  return (await r.json()) as T[];
}

interface AiState {
  wa_id: string;
  // NULL = "nunca foi decidido nesta conversa" → vale o padrão global.
  // Existe porque VÁRIAS escritas criam a linha de raspão (registro da
  // última decisão, marca de follow-up) e, com NOT NULL DEFAULT false,
  // essas linhas desligavam a IA sem ninguém ter pedido.
  enabled: boolean | null;
  replies_today: number;
  replies_date: string | null;
  opted_out?: boolean | null;
  away_at?: string | null;
}

/**
 * Grava a ÚLTIMA DECISÃO da IA na conversa. Sem isso, quando ela fica
 * quieta o operador não tem como saber se foi horário, teto diário,
 * chave desligada ou erro — e o silêncio vira caça ao fantasma (foi o
 * que aconteceu em 2026-08-29). O portal mostra esse texto embaixo da
 * chave. Best-effort: falhar aqui não pode atrapalhar o atendimento.
 */
async function registrarDecisao(waId: string, why: string): Promise<void> {
  await fetch(rest('whatsapp_ai_state?on_conflict=wa_id'), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ wa_id: waId, last_why: why.slice(0, 120), last_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  }).catch(() => {});
}

/** Resolve a chave da conversa: linha própria > padrão global > off. */
export async function isAiEnabledFor(waId: string): Promise<{ enabled: boolean; state: AiState | null }> {
  const rows = await dbGet<AiState>(
    `whatsapp_ai_state?wa_id=eq.${encodeURIComponent(waId)}&select=wa_id,enabled,replies_today,replies_date,opted_out,away_at`,
  );
  if (rows.length > 0 && typeof rows[0].enabled === 'boolean') {
    return { enabled: rows[0].enabled, state: rows[0] };
  }
  const cfg = await loadConfig();
  return { enabled: cfg.default_on, state: rows[0] || null };
}

/**
 * Config da IA (Wave 47) — tabela própria, NÃO `app_settings`: aquela
 * guarda segredo de sistema e o portal precisa escrever esta aqui.
 */
async function loadConfig(): Promise<{
  hours: string;
  default_on: boolean;
  away_on: boolean;
  away_text: string | null;
  prompt: string | null;
}> {
  type Cfg = {
    hours: string;
    default_on: boolean;
    away_on: boolean | null;
    away_text: string | null;
    prompt?: string | null;
  };
  // `prompt` é coluna nova (2026-09-08). Se o SQL ainda não rodou, o
  // PostgREST responde 42703 pro select inteiro e o dbGet devolve [] — e aí
  // horário, padrão e ausência voltariam ao default sem ninguém ver. Por
  // isso a segunda tentativa sem a coluna: recurso novo não derruba o que
  // já funciona por SQL pendente.
  let rows = await dbGet<Cfg>(`whatsapp_ai_config?id=eq.1&select=hours,default_on,away_on,away_text,prompt`);
  if (!rows.length) {
    rows = await dbGet<Cfg>(`whatsapp_ai_config?id=eq.1&select=hours,default_on,away_on,away_text`);
  }
  return {
    hours: rows[0]?.hours || '8-19',
    default_on: rows[0]?.default_on === true,
    away_on: rows[0]?.away_on !== false,
    away_text: rows[0]?.away_text || null,
    prompt: rows[0]?.prompt || null,
  };
}

async function setAiEnabled(waId: string, enabled: boolean, optedOut?: boolean): Promise<void> {
  await fetch(rest('whatsapp_ai_state?on_conflict=wa_id'), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({
      wa_id: waId,
      enabled,
      ...(optedOut === undefined ? {} : { opted_out: optedOut }),
      updated_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  }).catch(() => {});
}

async function bumpReplyCount(waId: string, state: AiState | null): Promise<void> {
  const hoje = diaBrt();
  const zerou = !state || state.replies_date !== hoje;
  await fetch(rest('whatsapp_ai_state?on_conflict=wa_id'), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({
      // Sem `enabled` de propósito: contar resposta não é decidir a chave.
      wa_id: waId,
      replies_today: zerou ? 1 : (state?.replies_today || 0) + 1,
      replies_date: hoje,
      updated_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  }).catch(() => {});
}

/**
 * Cria o alerta — ou ATUALIZA o que já está aberto pra este número.
 *
 * Sem isso, cliente insistindo gerava um alerta por mensagem e o portal
 * virava enxurrada; pior, o operador não via que a pessoa está esperando
 * há tempo. Agora um alerta por conversa, com a contagem de espera.
 */
export async function createAlert(input: {
  kind: 'preco' | 'orcamento' | 'humano';
  waId: string;
  leadId?: string | null;
  title: string;
  body?: string;
  /** O cliente JÁ ouviu "retornamos em breve" (mensagem de ausência) —
   *  a varredura de follow-up não precisa repetir a promessa. */
  jaAvisado?: boolean;
}): Promise<void> {
  const abertos = await dbGet<{ id: string; created_at: string; title: string }>(
    `portal_alerts?wa_id=eq.${encodeURIComponent(input.waId)}&resolved=is.false&select=id,created_at,title&order=created_at.asc&limit=1`,
  );
  const aberto = abertos[0];
  if (aberto) {
    // Já tem pendência: atualiza a espera em vez de empilhar alerta novo.
    const min = Math.max(
      0,
      Math.round((Date.now() - new Date(aberto.created_at).getTime()) / 60000),
    );
    await fetch(rest(`portal_alerts?id=eq.${encodeURIComponent(aberto.id)}`), {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        title: `${aberto.title.replace(/ · aguardando .*$/, '')} · aguardando há ${min} min`,
        body: input.body || null,
      }),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    }).catch(() => {});
    return;
  }
  await fetch(rest('portal_alerts'), {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({
      kind: input.kind,
      wa_id: input.waId,
      lead_id: input.leadId || null,
      title: input.title,
      body: input.body || null,
      ...(input.jaAvisado ? { followed_up_at: new Date().toISOString() } : {}),
    }),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  }).catch(() => {});
}

/** Existe pendência aberta (promessa de retorno) nesta conversa? */
async function temPendenciaAberta(waId: string): Promise<boolean> {
  const rows = await dbGet<{ id: string }>(
    `portal_alerts?wa_id=eq.${encodeURIComponent(waId)}&resolved=is.false&select=id&limit=1`,
  );
  return rows.length > 0;
}

/** Quando uma PESSOA respondeu por último nesta conversa (a IA grava
 *  `sent_by` NULL — é o único discriminador que existe). */
async function ultimaRespostaHumana(waId: string): Promise<string | null> {
  const rows = await dbGet<{ created_at: string }>(
    `whatsapp_messages?wa_id=eq.${encodeURIComponent(waId)}&direction=eq.out&sent_by=not.is.null&select=created_at&order=created_at.desc&limit=1`,
  );
  return rows[0]?.created_at || null;
}

/**
 * MENSAGEM DE AUSÊNCIA. A IA não vai responder (fora do horário ou chave
 * desligada) — mas o cliente não pode achar que falou com a parede. Vai
 * UMA cortesia da loja: quem somos, obrigado, retornamos em breve.
 *
 * Trava tripla pra não virar chateação: nada pra quem pediu PARE, no
 * máximo uma a cada 12h por conversa, e silêncio total se uma pessoa
 * respondeu ali nas últimas 2h (ela está no volante).
 *
 * Cria também o alerta no portal — é assim que a loja fica sabendo que
 * alguém escreveu de madrugada, e é o que faz a varredura de follow-up
 * cobrar depois ("sem resposta há Xh"). O alerta já nasce marcado como
 * "cliente avisado", senão a varredura mandaria a mesma promessa de novo.
 */
async function enviarAusencia(opts: {
  waId: string;
  motivo: 'horario' | 'desligada';
  state: AiState | null;
  cfg: { hours: string; away_on: boolean; away_text: string | null };
}): Promise<boolean> {
  if (!opts.cfg.away_on) return false;
  const humano = await ultimaRespostaHumana(opts.waId);
  const pode = shouldSendAway({
    optedOut: opts.state?.opted_out === true,
    awayAt: opts.state?.away_at || null,
    lastHumanOutAt: humano,
  });
  if (!pode) return false;

  const body = textoAusencia({
    motivo: opts.motivo,
    janela: parseHoursSetting(opts.cfg.hours),
    custom: opts.cfg.away_text,
  });
  const sent = await sendWhatsAppText({ to: opts.waId, body });
  await persistWhatsAppMessage({
    origin: 'ia',
    direction: 'out',
    waId: opts.waId,
    messageId: sent.messageId,
    type: 'text',
    body,
  });
  await fetch(rest('whatsapp_ai_state?on_conflict=wa_id'), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ wa_id: opts.waId, away_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  }).catch(() => {});
  await createAlert({
    kind: 'humano',
    waId: opts.waId,
    title:
      opts.motivo === 'horario'
        ? 'Cliente escreveu fora do horário'
        : 'Cliente escreveu (IA desligada nesta conversa)',
    jaAvisado: true,
  });
  return true;
}

/** Últimas trocas da conversa, em ordem cronológica. */
async function loadTurns(waId: string): Promise<ConversationTurn[]> {
  const rows = await dbGet<{
    direction: string;
    body: string | null;
    transcript: string | null;
    created_at: string;
  }>(
    `whatsapp_messages?wa_id=eq.${encodeURIComponent(waId)}&select=direction,body,transcript,created_at&order=created_at.desc&limit=10`,
  );
  return rows
    .reverse()
    // Áudio vira o texto do Whisper: sem isso a IA lia "[áudio]" e
    // respondia no vácuo. Marcador de mídia sem transcrição fica de fora.
    .map((r) => ({
      direction: (r.direction === 'out' ? 'out' : 'in') as 'in' | 'out',
      // Registro de template vira a mensagem de apresentação, senão a IA
      // lê "[template x] {{1}}=…" e não sabe que a loja começou a conversa.
      body: descreverRegistroDeTemplate((r.transcript || r.body || '').trim()),
    }))
    .filter((t) => t.body && !/^\[(áudio|imagem|vídeo|figurinha|documento)\]$/i.test(t.body));
}

/** Lead correspondente ao número (casamento pelos últimos 8 dígitos). */
async function loadLead(waId: string): Promise<{ id: string; ctx: LeadContext } | null> {
  // Só consulta com 8 dígitos limpos: a cauda crua do wa_id com `*` dentro
  // virava `ilike.**` e trazia um lead qualquer pro prompt da IA.
  const filtro = filtroTelefoneContem(waId);
  if (!filtro) return null;
  const rows = await dbGet<{
    id: string;
    name: string | null;
    phone: string | null;
    category: string | null;
    segment: string | null;
    city: string | null;
    neighborhood: string | null;
  }>(`leads?phone=${filtro}&select=id,name,phone,category,segment,city,neighborhood&limit=1`);
  const l = rows[0];
  if (!l) return null;
  return {
    id: l.id,
    ctx: {
      name: l.name,
      category: l.category,
      segment: l.segment,
      city: l.city,
      neighborhood: l.neighborhood,
    },
  };
}

/**
 * Marca o lead como "não abordar de novo".
 *
 * Sem isso, `whatsapp_ai_state.opted_out` cala a IA e o follow-up, mas o
 * botão "Abordar" da lista de leads continua oferecendo o contato — e o
 * operador dispara de novo, sem saber, pra quem acabou de dizer não.
 *
 * Tolera a coluna ausente (a migration pode não ter rodado ainda): o
 * opt-out no `whatsapp_ai_state` já valeu, e recusar aqui derrubaria o
 * atendimento por causa de SQL pendente — a lição de `quotes.post_id`.
 */
async function marcarLeadOptOut(waId: string): Promise<boolean> {
  // Mesma trava do loadLead — aqui é um PATCH com service role: um `from`
  // de `********` marcaria TODOS os leads como opt-out numa request.
  const filtro = filtroTelefoneContem(waId);
  if (!filtro) return false;
  try {
    const r = await fetch(
      rest(`leads?phone=${filtro}`),
      {
        method: 'PATCH',
        headers: headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ opted_out_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(DB_TIMEOUT_MS),
      }
    );
    if (!r.ok) {
      console.warn('[whatsapp-ia] não marquei o lead como opt-out:', r.status, (await r.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[whatsapp-ia] opt-out do lead falhou:', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Ponto de entrada chamado pelo webhook depois de gravar a mensagem
 * recebida. Nunca lança — devolve o que aconteceu, pra log.
 */
export async function maybeAutoReply(opts: {
  waId: string;
  text: string;
}): Promise<{ acted: boolean; why: string }> {
  const r = await decidirEAgir(opts);
  // Deixa rastro na conversa, seja qual for o desfecho.
  await registrarDecisao(opts.waId, (r.acted ? '✓ ' : '· ') + r.why);
  return r;
}

async function decidirEAgir(opts: {
  waId: string;
  text: string;
}): Promise<{ acted: boolean; why: string }> {
  try {
    if (!getSupabaseUrl() || !getServiceKey()) return { acted: false, why: 'sem service key' };

    // 1. Opt-out manda em tudo, inclusive fora do horário.
    if (isOptOut(opts.text)) {
      // `opted_out` é definitivo: além de calar a IA, tira o número da
      // varredura de follow-up (que ignora até a chave manual).
      await setAiEnabled(opts.waId, false, true);
      await createAlert({
        kind: 'humano',
        waId: opts.waId,
        title: 'Cliente pediu PARE',
        body: 'A IA foi desligada nesta conversa. Não enviar mais mensagens para este número.',
      });
      return { acted: true, why: 'opt-out' };
    }

    // 1b. Tocou em "Não tenho interesse" no template de abordagem. É
    // opt-out igual ao PARE, com uma diferença: essa pessoa respondeu a
    // uma mensagem NOSSA, então sumir sem dizer nada é grosseria. Vai um
    // agradecimento curto — e o lead sai da lista de abordagem, senão o
    // botão "Abordar" ofereceria o contato de novo amanhã.
    if (ehRecusaDeAbordagem(opts.text)) {
      await setAiEnabled(opts.waId, false, true);
      const noLead = await marcarLeadOptOut(opts.waId);
      // A janela está aberta: ela acabou de tocar no botão. O envio vem
      // DEPOIS de gravar o opt-out e num try próprio — falhar em agradecer
      // não pode fazer o número voltar pra lista.
      try {
        const corpo = textoRecusaAgradecida();
        const sent = await sendWhatsAppText({ to: opts.waId, body: corpo });
        await persistWhatsAppMessage({
          origin: 'ia',
          direction: 'out',
          waId: opts.waId,
          messageId: sent.messageId,
          type: 'text',
          body: corpo,
        });
      } catch (e) {
        console.warn('[whatsapp-ia] não consegui agradecer a recusa:', e instanceof Error ? e.message : e);
      }
      await createAlert({
        kind: 'humano',
        waId: opts.waId,
        title: 'Lead disse que não tem interesse',
        body:
          'Respondeu pelo botão do template. A IA foi desligada e o número saiu ' +
          'da abordagem' + (noLead ? '.' : ' — mas NÃO consegui marcar o lead (confira a coluna leads.opted_out_at).'),
      });
      return { acted: true, why: 'recusou a abordagem — agradeci e tirei da lista' };
    }

    const { enabled, state } = await isAiEnabledFor(opts.waId);
    const cfg = await loadConfig();

    // IA desligada: ninguém fica no vácuo — vai a cortesia da loja.
    if (!enabled) {
      const avisou = await enviarAusencia({ waId: opts.waId, motivo: 'desligada', state, cfg });
      return {
        acted: avisou,
        why: avisou ? 'IA desligada — mandei a mensagem de ausência' : 'IA desligada nesta conversa',
      };
    }
    if (!isAiConfigured()) return { acted: false, why: 'OPENAI_API_KEY ausente' };

    // Janela de atendimento (whatsapp_ai_config.hours): "8-19" padrão,
    // "0-24" pra atender sempre.
    const janela = parseHoursSetting(cfg.hours);
    if (!isBusinessHour(new Date(), janela)) {
      const avisou = await enviarAusencia({ waId: opts.waId, motivo: 'horario', state, cfg });
      const fora = `fora do horário de atendimento (${janela.start}h-${janela.end}h BRT)`;
      return { acted: avisou, why: avisou ? `${fora} — mandei a mensagem de ausência` : fora };
    }

    const hoje = diaBrt();
    const jaHoje = state && state.replies_date === hoje ? state.replies_today : 0;
    if (jaHoje >= MAX_AUTO_REPLIES_PER_DAY) {
      return { acted: false, why: 'teto diário de respostas atingido' };
    }

    const [turns, lead, pendente] = await Promise.all([
      loadTurns(opts.waId),
      loadLead(opts.waId),
      temPendenciaAberta(opts.waId),
    ]);
    const result = await generateAiReply({
      lead: lead?.ctx || null,
      turns,
      pendenciaAberta: pendente,
      promptBase: cfg.prompt,
    });
    if (!result.reply) return { acted: false, why: 'IA não produziu resposta' };

    // Envia. A janela de 24h está aberta: o cliente acabou de escrever.
    const sent = await sendWhatsAppText({ to: opts.waId, body: result.reply });
    await persistWhatsAppMessage({
      origin: 'ia',
      direction: 'out',
      waId: opts.waId,
      messageId: sent.messageId,
      type: 'text',
      body: result.reply,
    });
    await bumpReplyCount(opts.waId, state);

    if (result.escalate) {
      // Chama gente MAS NÃO desliga a IA (2026-08-29). Desligar por causa
      // de UM assunto matava a conversa inteira: o cliente perguntava
      // preço, a IA prometia retorno e depois ficava muda pra "oi",
      // "tinta?" — vácuo total até alguém abrir o portal. Agora ela segue
      // atendendo o resto e só o preço/orçamento espera a pessoa.
      // Pra assumir o volante de vez, existe a chave manual na conversa.
      await createAlert({
        kind: result.reason || 'humano',
        waId: opts.waId,
        leadId: lead?.id || null,
        title:
          result.reason === 'preco'
            ? 'Cliente pediu PREÇO'
            : result.reason === 'orcamento'
              ? 'Cliente pediu ORÇAMENTO'
              : 'Conversa precisa de atendimento humano',
        body: (opts.text || '').slice(0, 300),
      });
      return { acted: true, why: 'respondeu e escalou (' + (result.reason || 'humano') + ')' };
    }

    return { acted: true, why: 'respondeu automaticamente' };
  } catch (e) {
    console.warn('whatsapp-ai-runner:', e instanceof Error ? e.message : e);
    return { acted: false, why: 'erro interno' };
  }
}
