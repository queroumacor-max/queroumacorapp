// lib/api/_services/whatsapp-followup.ts — VARREDURA DE FOLLOW-UP.
//
// Até aqui tudo dependia de o cliente escrever de novo: se ele sumia, ou
// se a loja esquecia de responder um pedido de preço, ninguém era
// lembrado. Esta varredura olha TODAS as conversas já existentes (não só
// as novas) e faz três coisas:
//
//   1. ALERTA PARADO   — pendência aberta há X horas sem NENHUMA resposta
//                        de gente. Atualiza o alerta pra "sem resposta há
//                        Xh". Não manda nada pro cliente; é cutucão
//                        interno, e vale a qualquer hora do dia.
//   2. COBRANÇA        — a mesma pendência, uma ÚNICA vez, avisa o cliente
//                        que o pedido está na fila. Só em horário de
//                        atendimento.
//   3. REENGAJAMENTO   — a loja falou por último e o cliente sumiu há
//                        N horas (inclui o lead que nunca respondeu a
//                        abordagem). Um toque, no máximo um por semana
//                        por conversa.
//
// Quem NÃO recebe nada: quem pediu PARE (`opted_out`) e a conversa em que
// o operador desligou a chave da IA na mão (ele assumiu o volante).
//
// Regra da loja continua valendo: nenhum texto daqui fala preço, valor,
// desconto ou orçamento — os dois modelos de mensagem são fixos e
// testados contra `replyLeaksPrice`.

import { getServiceKey, getSupabaseUrl } from '../security';
import { filtroTelefoneContem } from './_untrusted';
import { isBusinessHour, parseHoursSetting } from './whatsapp-ai';
// Envio pelo canal ÚNICO (Dualhook/Cloud API) desde 2026-09-05.
import {
  escolherTemplate,
  isForaDaJanela24h,
  persistWhatsAppMessage,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from './whatsapp';

const DB_TIMEOUT_MS = 8000;

/** Quanto tempo pra trás a varredura enxerga. Conversa mais velha que
 *  isso é fria — cutucar depois de um mês é spam, não follow-up. */
export const SWEEP_WINDOW_DAYS = 30;
/** Teto de mensagens ENVIADAS por varredura (o alerta interno não conta).
 *  Rede de segurança: se algo der errado na conta de horas, o estrago é
 *  de 10 mensagens, não da base inteira. */
export const MAX_SENDS_PER_SWEEP = 10;
/** Uma conversa não recebe dois toques automáticos na mesma semana. */
export const NUDGE_COOLDOWN_DAYS = 7;

export const DEFAULT_FOLLOWUP_HOURS = 3;
export const DEFAULT_NUDGE_HOURS = 48;

// ── Tipos ────────────────────────────────────────────────────────────

export interface ConvSnapshot {
  waId: string;
  /** Última mensagem da conversa (qualquer direção). */
  lastMsgAt: string;
  lastMsgDirection: 'in' | 'out';
  /** Última resposta de GENTE (out com sent_by preenchido). A IA grava
   *  sent_by NULL — é assim que separamos "a loja respondeu" de "o robô
   *  respondeu". */
  lastHumanOutAt: string | null;
  nome?: string | null;
  alert?: { id: string; createdAt: string; title: string; followedUpAt: string | null } | null;
  state?: { optedOut: boolean; enabled: boolean | null; followupAt: string | null } | null;
}

export interface SweepConfig {
  followupOn: boolean;
  followupHours: number;
  nudgeHours: number;
  /** Estamos dentro da janela de atendimento? Fora dela só o alerta
   *  interno roda — cliente não recebe mensagem de madrugada. */
  podeEnviar: boolean;
}

export type FollowupAction =
  | { kind: 'alerta'; waId: string; alertId: string; horas: number; titulo: string }
  | { kind: 'cobranca'; waId: string; alertId: string; horas: number }
  | { kind: 'reengajamento'; waId: string; horas: number };

// ── Planejador (puro — é o que os testes cobrem) ─────────────────────

function horasEntre(now: Date, iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (now.getTime() - t) / 3600000);
}

/** Tira o sufixo de espera pra não empilhar "aguardando há 10 min ·
 *  sem resposta há 3h · sem resposta há 4h" a cada varredura. */
export function tituloBase(title: string): string {
  return (title || '')
    .replace(/^⏰\s*/, '')
    .replace(/\s*·\s*(aguardando|sem resposta) há .*$/i, '')
    .trim();
}

export function tituloEspera(title: string, horas: number): string {
  const h = Math.floor(horas);
  const quanto = h >= 24 ? `${Math.floor(h / 24)}d` : `${h}h`;
  return `⏰ ${tituloBase(title)} · sem resposta há ${quanto}`;
}

/**
 * Decide o que fazer com cada conversa. Sem I/O: recebe a fotografia do
 * banco e devolve a lista de ações, já respeitando o teto de envios.
 */
export function planFollowups(
  convs: ConvSnapshot[],
  cfg: SweepConfig,
  now: Date,
): FollowupAction[] {
  if (!cfg.followupOn) return [];
  const acoes: FollowupAction[] = [];
  let enviadas = 0;

  // Conversa mais recente primeiro: se o teto de envios estourar, quem
  // fica de fora é a mais fria.
  const ordenadas = [...convs].sort(
    (a, b) => new Date(b.lastMsgAt).getTime() - new Date(a.lastMsgAt).getTime(),
  );

  for (const c of ordenadas) {
    if (c.state?.optedOut) continue;
    if (c.state?.enabled === false) continue; // operador assumiu a conversa

    if (c.alert) {
      const horas = horasEntre(now, c.alert.createdAt);
      if (horas < cfg.followupHours) continue;
      const respondido =
        !!c.lastHumanOutAt &&
        new Date(c.lastHumanOutAt).getTime() > new Date(c.alert.createdAt).getTime();
      if (respondido) continue;

      acoes.push({
        kind: 'alerta',
        waId: c.waId,
        alertId: c.alert.id,
        horas,
        titulo: tituloEspera(c.alert.title, horas),
      });
      if (cfg.podeEnviar && !c.alert.followedUpAt && enviadas < MAX_SENDS_PER_SWEEP) {
        acoes.push({ kind: 'cobranca', waId: c.waId, alertId: c.alert.id, horas });
        enviadas++;
      }
      // Pendência aberta não recebe reengajamento: seria falar duas vezes.
      continue;
    }

    // Reengajamento: a bola está com o CLIENTE (a loja falou por último) e
    // ele não voltou. Cobre também o lead que nunca respondeu à abordagem.
    if (c.lastMsgDirection !== 'out') continue;
    const silencio = horasEntre(now, c.lastMsgAt);
    if (silencio < cfg.nudgeHours) continue;
    if (silencio > SWEEP_WINDOW_DAYS * 24) continue;
    if (c.state?.followupAt && horasEntre(now, c.state.followupAt) < NUDGE_COOLDOWN_DAYS * 24) {
      continue;
    }
    if (!cfg.podeEnviar || enviadas >= MAX_SENDS_PER_SWEEP) continue;
    acoes.push({ kind: 'reengajamento', waId: c.waId, horas: silencio });
    enviadas++;
  }

  return acoes;
}

// ── Textos (fixos de propósito: nada de preço sai daqui) ─────────────

function primeiroNome(nome?: string | null): string {
  const n = (nome || '').trim().split(/\s+/)[0] || '';
  return n && n.length <= 20 ? ` ${n}` : '';
}

export function textoCobranca(nome?: string | null): string {
  return (
    `Oi${primeiroNome(nome)}! Passando pra avisar que seu pedido está com a nossa equipe aqui na ` +
    `Cali Colors 🎨 Assim que tiver a resposta certinha, eu te retorno por aqui. ` +
    `Se precisar de mais alguma coisa enquanto isso, é só me chamar.`
  );
}

export function textoReengajamento(nome?: string | null): string {
  // Sem o rodapé "responda PARE" (2026-08-29, decisão da loja). A palavra
  // continua valendo do lado de cá: quem responde isso vira `opted_out` e
  // não recebe mais nada — só deixou de ser anunciada.
  return (
    `Oi${primeiroNome(nome)}, tudo bem? Aqui é da Cali Colors 🎨 ` +
    `Passando pra saber se ficou alguma dúvida sobre o que conversamos. ` +
    `Me conta o que você precisa pintar que eu te ajudo a escolher o produto certo.`
  );
}

// ── Execução ─────────────────────────────────────────────────────────

function rest(path: string): string {
  return `${getSupabaseUrl().replace(/\/$/, '')}/rest/v1/${path}`;
}
function headers(extra?: Record<string, string>): Record<string, string> {
  const k = getServiceKey() || '';
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(extra || {}) };
}
async function dbGet<T>(path: string): Promise<T[]> {
  const r = await fetch(rest(path), { headers: headers(), signal: AbortSignal.timeout(DB_TIMEOUT_MS) });
  if (!r.ok) return [];
  return (await r.json()) as T[];
}

interface MsgRow {
  wa_id: string;
  direction: string;
  sent_by: string | null;
  profile_name: string | null;
  created_at: string;
}

/** Monta a fotografia por conversa a partir das mensagens da janela. */
export function snapshotFromMessages(rows: MsgRow[]): Map<string, ConvSnapshot> {
  const map = new Map<string, ConvSnapshot>();
  for (const r of rows) {
    if (!r.wa_id) continue;
    const dir: 'in' | 'out' = r.direction === 'out' ? 'out' : 'in';
    const atual = map.get(r.wa_id);
    const snap: ConvSnapshot = atual || {
      waId: r.wa_id,
      lastMsgAt: r.created_at,
      lastMsgDirection: dir,
      lastHumanOutAt: null,
      nome: null,
    };
    if (new Date(r.created_at).getTime() >= new Date(snap.lastMsgAt).getTime()) {
      snap.lastMsgAt = r.created_at;
      snap.lastMsgDirection = dir;
    }
    if (dir === 'out' && r.sent_by) {
      if (!snap.lastHumanOutAt || new Date(r.created_at) > new Date(snap.lastHumanOutAt)) {
        snap.lastHumanOutAt = r.created_at;
      }
    }
    if (dir === 'in' && r.profile_name && !snap.nome) snap.nome = r.profile_name;
    map.set(r.wa_id, snap);
  }
  return map;
}

export interface SweepResult {
  ok: boolean;
  ran: boolean;
  why?: string;
  conversas: number;
  alertas: number;
  cobrancas: number;
  reengajamentos: number;
  /**
   * Quantos NÃO saíram por estarem fora da janela de 24h da Meta. Contador
   * próprio, separado de `erros`, porque não é falha nossa nem transitória:
   * é o limite da Cloud API, e só some com template aprovado. Somar isso em
   * `erros` esconderia a causa num balde que ninguém lê.
   */
  foraDaJanela: number;
  erros: string[];
}

/**
 * Roda a varredura inteira. Best-effort: nunca lança — o chamador pode
 * ser um cron do banco, e falha aqui não pode virar retry em cascata.
 */
export async function runFollowupSweep(opts?: {
  now?: Date;
  dryRun?: boolean;
}): Promise<SweepResult> {
  const now = opts?.now || new Date();
  const vazio: SweepResult = {
    ok: true,
    ran: false,
    conversas: 0,
    alertas: 0,
    cobrancas: 0,
    reengajamentos: 0,
    foraDaJanela: 0,
    erros: [],
  };
  try {
    if (!getSupabaseUrl() || !getServiceKey()) {
      return { ...vazio, ok: false, why: 'sem service key' };
    }

    const cfgRows = await dbGet<{
      hours: string | null;
      followup_on: boolean | null;
      followup_hours: number | null;
      nudge_hours: number | null;
    }>('whatsapp_ai_config?id=eq.1&select=hours,followup_on,followup_hours,nudge_hours');
    const cfgRow = cfgRows[0] || {};
    const cfg: SweepConfig = {
      followupOn: cfgRow.followup_on !== false,
      followupHours: Number(cfgRow.followup_hours) > 0 ? Number(cfgRow.followup_hours) : DEFAULT_FOLLOWUP_HOURS,
      nudgeHours: Number(cfgRow.nudge_hours) > 0 ? Number(cfgRow.nudge_hours) : DEFAULT_NUDGE_HOURS,
      podeEnviar: isBusinessHour(now, parseHoursSetting(cfgRow.hours || '8-19')),
    };
    if (!cfg.followupOn) return { ...vazio, why: 'follow-up desligado no portal' };

    const desde = new Date(now.getTime() - SWEEP_WINDOW_DAYS * 86400000).toISOString();
    const [msgs, states, alerts] = await Promise.all([
      dbGet<MsgRow>(
        `whatsapp_messages?created_at=gte.${encodeURIComponent(desde)}&select=wa_id,direction,sent_by,profile_name,created_at&order=created_at.asc&limit=5000`,
      ),
      dbGet<{ wa_id: string; enabled: boolean; opted_out: boolean | null; followup_at: string | null }>(
        'whatsapp_ai_state?select=wa_id,enabled,opted_out,followup_at&limit=2000',
      ),
      dbGet<{ id: string; wa_id: string | null; title: string; created_at: string; followed_up_at: string | null }>(
        'portal_alerts?resolved=is.false&wa_id=not.is.null&select=id,wa_id,title,created_at,followed_up_at&order=created_at.asc&limit=200',
      ),
    ]);

    const snaps = snapshotFromMessages(msgs);
    for (const s of states) {
      const c = snaps.get(s.wa_id);
      if (c) c.state = { optedOut: s.opted_out === true, enabled: s.enabled, followupAt: s.followup_at };
    }
    for (const a of alerts) {
      const c = a.wa_id ? snaps.get(a.wa_id) : null;
      if (c && !c.alert) {
        c.alert = { id: a.id, createdAt: a.created_at, title: a.title, followedUpAt: a.followed_up_at };
      }
    }

    const convs = [...snaps.values()];
    const acoes = planFollowups(convs, cfg, now);
    const res: SweepResult = { ...vazio, ran: true, conversas: convs.length };
    if (opts?.dryRun) {
      for (const a of acoes) {
        if (a.kind === 'alerta') res.alertas++;
        else if (a.kind === 'cobranca') res.cobrancas++;
        else res.reengajamentos++;
      }
      return res;
    }

    for (const a of acoes) {
      try {
        if (a.kind === 'alerta') {
          await fetch(rest(`portal_alerts?id=eq.${encodeURIComponent(a.alertId)}`), {
            method: 'PATCH',
            headers: headers({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ title: a.titulo.slice(0, 200) }),
            signal: AbortSignal.timeout(DB_TIMEOUT_MS),
          });
          res.alertas++;
          continue;
        }

        const snap = snaps.get(a.waId);
        const nome = (await nomeDoContato(a.waId)) || snap?.nome || null;
        const body = a.kind === 'cobranca' ? textoCobranca(nome) : textoReengajamento(nome);

        // JANELA DE 24h (2026-09-05): este arquivo existe pra falar com quem
        // SUMIU — ou seja, quase sempre FORA da janela. A Cloud API recusa
        // texto livre aí (131047 → 422); só template aprovado passa, e não
        // há nenhum cadastrado no WhatsApp Manager. Isso NÃO é erro
        // transitório: tentar de novo na próxima varredura dá o mesmo
        // resultado. Marcamos como tentado pra não martelar o mesmo contato
        // de hora em hora, e contamos à parte pra a tela poder dizer POR QUE
        // o follow-up não está saindo — em vez de somar num balde de "erros"
        // que ninguém lê. O Baileys não tinha esse limite; a troca de canal
        // trouxe.
        let sent: { messageId: string };
        let tipo: 'text' | 'template' = 'text';
        let templateUsado: string | null = null;
        let corpoRegistrado: string | null = body;
        try {
          sent = await sendWhatsAppText({ to: a.waId, body });
        } catch (e) {
          if (!isForaDaJanela24h(e)) throw e;
          // Fechada: cai pro template aprovado. Quem decide se dá pra usar
          // o de variável é `escolherTemplate` — sem nome utilizável ele
          // devolve o fixo, pra nunca mandar "{{1}}" vazio.
          //
          // Deixamos o texto livre TENTAR primeiro em vez de calcular a
          // janela aqui: quem tem o relógio é a Meta, e uma previsão nossa
          // baseada no que o webhook gravou pode divergir (mensagem que não
          // chegou ao banco, relógio diferente). O 131047 é a resposta
          // autoritativa — usá-la como gatilho custa uma chamada e nunca
          // erra pro lado de mandar o que não entrega.
          const escolha = escolherTemplate(nome);
          try {
            sent = await sendWhatsAppTemplate({
              to: a.waId,
              template: escolha.template,
              languageCode: 'pt_BR',
              components: escolha.components,
            });
          } catch (e2) {
            // Nem o template saiu (template removido do painel, cota de
            // marketing, número inválido). Conta à parte e marca como
            // tentado — repetir de hora em hora daria o mesmo resultado.
            res.foraDaJanela++;
            res.erros.push(
              `${a.kind} ${a.waId}: template ${escolha.template} recusado: ` +
                (e2 instanceof Error ? e2.message : String(e2)),
            );
            await marcarFollowup(a.waId, a.kind, now);
            continue;
          }
          tipo = 'template';
          templateUsado = escolha.template;
          // Guarda o que a pessoa REALMENTE recebeu, não o texto livre que
          // não saiu — senão o histórico do portal mente sobre o que foi
          // enviado.
          corpoRegistrado = escolha.nome
            ? `[template ${escolha.template}] {{1}}=${escolha.nome}`
            : `[template ${escolha.template}]`;
        }
        await persistWhatsAppMessage({
          origin: 'ia',
          direction: 'out',
          waId: a.waId,
          messageId: sent.messageId,
          type: tipo,
          body: corpoRegistrado,
          template: templateUsado ?? undefined,
        });
        if (a.kind === 'cobranca') {
          await fetch(rest(`portal_alerts?id=eq.${encodeURIComponent(a.alertId)}`), {
            method: 'PATCH',
            headers: headers({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ followed_up_at: now.toISOString() }),
            signal: AbortSignal.timeout(DB_TIMEOUT_MS),
          });
          res.cobrancas++;
        } else {
          res.reengajamentos++;
        }
        await marcarFollowup(a.waId, a.kind, now);
      } catch (e) {
        res.erros.push(`${a.kind} ${a.waId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await fetch(rest('whatsapp_ai_config?on_conflict=id'), {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({
        id: 1,
        last_sweep_at: now.toISOString(),
        last_sweep_note:
          `${res.conversas} conversas · ${res.alertas} alerta(s) · ` +
          `${res.cobrancas} cobrança(s) · ${res.reengajamentos} reengajamento(s)` +
          (cfg.podeEnviar ? '' : ' · fora do horário (só alertas)') +
          (res.erros.length ? ` · ${res.erros.length} erro(s)` : ''),
      }),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    }).catch(() => {});

    return res;
  } catch (e) {
    return { ...vazio, ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

/** Nome pra personalizar: lead da prospecção primeiro, depois usuário. */
async function nomeDoContato(waId: string): Promise<string | null> {
  // Cauda de 8 DÍGITOS ou nada: `*` no wa_id casaria qualquer nome de
  // qualquer perfil e ele iria pra mensagem de um estranho.
  const filtro = filtroTelefoneContem(waId);
  if (!filtro) return null;
  const leads = await dbGet<{ name: string | null }>(`leads?phone=${filtro}&select=name&limit=1`);
  if (leads[0]?.name) return leads[0].name;
  const profs = await dbGet<{ name: string | null }>(
    `profiles?phone=${filtro}&select=name&limit=1`,
  );
  return profs[0]?.name || null;
}

async function marcarFollowup(waId: string, kind: string, now: Date): Promise<void> {
  await fetch(rest('whatsapp_ai_state?on_conflict=wa_id'), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({
      wa_id: waId,
      followup_at: now.toISOString(),
      followup_kind: kind,
      updated_at: now.toISOString(),
    }),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  }).catch(() => {});
}
