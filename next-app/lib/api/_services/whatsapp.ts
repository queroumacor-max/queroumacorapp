// lib/api/_services/whatsapp.ts — cliente do WhatsApp Cloud API (Meta Graph).
//
// A Cali Colors tem um número oficial na Cloud API (+55 11 95976-5031,
// app "CaliColors Integracao API"). Este service encapsula o envio de
// mensagens via `https://api.dualhook.com/<versão>/<PHONE_NUMBER_ID>/messages`
// (o Dualhook espelha o contrato da Cloud API — mesmo path, mesmo corpo,
// mesmo formato de resposta; muda a base e o Bearer)
// com Bearer auth.
//
// Config (edge do Cloudflare — SEMPRE via `getRuntimeEnv`, nunca
// `process.env` direto; ver lib/api/env.ts):
//   - `DUALHOOK_API_KEY`         (secret) — Outbound API key do Dualhook
//     (`dh_live_…`). NUNCA commitar; vive só no painel do CF Pages.
//     Substituiu o `WHATSAPP_ACCESS_TOKEN` em 2026-09-05: com o número em
//     Coexistence gerenciado pelo app Meta do Dualhook, o token do NOSSO app
//     não tem permissão nesse phone_number_id. O envio passa por eles.
//   - `WHATSAPP_PHONE_NUMBER_ID` — opcional; default abaixo (não é secret).
//   - `WHATSAPP_WABA_ID`         — opcional; default abaixo (não é secret).
//   - `WHATSAPP_WEBHOOK_AUTH_MODE` — `payload` (default) ou `hmac`. Ver
//     abaixo em "Webhook: autenticação do POST".
//   - `META_APP_SECRET`          (secret) — só no modo `hmac`.
//   - `WHATSAPP_WEBHOOK_URL_SECRET` (secret) — obrigatório no modo `payload`:
//     string alta-entropia que vai na query da URL cadastrada no Dualhook
//     (`.../api/whatsapp/webhook?token=<secret>`). É o que prova que a
//     chamada veio de quem conhece a URL (Meta via Dualhook), já que o
//     payload sozinho é forjável (WABA/phone id são públicos).
//   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — string escolhida por nós, conferida
//     no GET de verificação do webhook (Meta manda de volta). Com Dualhook,
//     é o Verify Token gerado no painel deles (Webhook Override).
//
// Webhook: autenticação do POST. Desde a migração pro Dualhook (Coexistence
// via Embedded Signup), o header `X-Hub-Signature-256` é assinado pelo app
// Meta DO DUALHOOK, cujo App Secret não é exposto — logo o HMAC com o nosso
// `META_APP_SECRET` NUNCA bate. A recomendação do Dualhook é validar o
// FORMATO do payload (`isExpectedWebhookPayload`): envelope
// `whatsapp_business_account`, `entry[].id` = nosso WABA e
// `metadata.phone_number_id` = nosso número — MAIS o segredo de URL
// (`WHATSAPP_WEBHOOK_URL_SECRET`), porque IDs no corpo não autenticam
// remetente. O modo `hmac` fica disponível pra voltar ao app próprio (sem
// Dualhook) sem mexer em código.
//
// Regra da janela de 24h da Meta: mensagem de TEXTO livre só chega pra quem
// mandou mensagem pro número nas últimas 24h; fora da janela é obrigatório
// usar TEMPLATE aprovado. O erro 131047 do Graph indica exatamente isso —
// traduzimos pra mensagem acionável.

import { getRuntimeEnv } from '../env';
import { normalizeWhatsAppTarget } from './whatsapp-evo';
import { getServiceKey, getSupabaseUrl, ServiceError } from '../security';

// O Dualhook espelha o contrato da Cloud API: mesmo path
// `/<versão>/<PHONE_NUMBER_ID>/messages`, mesmo corpo, mesma forma de erro.
// Só a base e o header de auth mudam — por isso os builders de payload não
// precisaram de nenhuma alteração.
export const DUALHOOK_API_BASE = 'https://api.dualhook.com';
export const GRAPH_API_VERSION = 'v25.0';

/**
 * IDs do WhatsApp Business da Cali Colors. NÃO são secrets (aparecem em URL
 * de API e no painel da Meta) — ficam como default pra reduzir setup a uma
 * env só (o token). Env correspondente sobrescreve se o número mudar.
 *
 * ATENÇÃO ao que estes números significam: o TELEFONE é o mesmo de sempre.
 * O que mudou em 2026-09-05 foi o REGISTRO — ao entrar em Coexistence pelo
 * Dualhook, a Meta emitiu um `phone_number_id` e uma WABA novos pro mesmo
 * aparelho. Os IDs antigos (`109293361953640` / `102067872689175`, do
 * cadastro direto da Cali Colors) não recebem nem enviam mais nada.
 *
 * Por que eles PRECISAVAM sair daqui: um default errado não falha, ele
 * MENTE. No envio, a URL apontava pra um número que não é nosso e o
 * Dualhook recusava; no recebimento era pior — `isExpectedWebhookPayload`
 * comparava o envelope contra a WABA velha e devolvia 403 pra TODA entrega,
 * ou seja, silêncio total no portal, sem erro em lugar nenhum. As envs
 * continuam podendo sobrescrever, mas agora o caminho sem env é o certo.
 */
export const DEFAULT_PHONE_NUMBER_ID = '1220273824510260'; // Dualhook (Coexistence)
export const DEFAULT_WABA_ID = '1320667299892030'; // WABA da conexão Dualhook

const GRAPH_TIMEOUT_MS = 15000;

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
}

/** Lê a config de runtime. Throw 503 se a chave não estiver no ambiente. */
export function getWhatsAppConfig(): WhatsAppConfig {
  const token = getRuntimeEnv('DUALHOOK_API_KEY') || '';
  if (!token) {
    throw new ServiceError(
      'envio de WhatsApp não configurado (DUALHOOK_API_KEY ausente)',
      503
    );
  }
  const phoneNumberId =
    getRuntimeEnv('WHATSAPP_PHONE_NUMBER_ID') || DEFAULT_PHONE_NUMBER_ID;
  return { token, phoneNumberId };
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(getRuntimeEnv('DUALHOOK_API_KEY'));
}

/** WABA ID do runtime (env sobrescreve o default da Cali Colors). */
export function getWabaId(): string {
  return getRuntimeEnv('WHATSAPP_WABA_ID') || DEFAULT_WABA_ID;
}

/** Phone Number ID do runtime, sem exigir o access token (uso no webhook). */
export function getPhoneNumberId(): string {
  return getRuntimeEnv('WHATSAPP_PHONE_NUMBER_ID') || DEFAULT_PHONE_NUMBER_ID;
}

export type WebhookAuthMode = 'payload' | 'hmac';

/** Modo de autenticação do POST do webhook. Qualquer valor ≠ `hmac` → `payload`. */
export function getWebhookAuthMode(): WebhookAuthMode {
  return getRuntimeEnv('WHATSAPP_WEBHOOK_AUTH_MODE') === 'hmac' ? 'hmac' : 'payload';
}

/**
 * Normaliza telefone brasileiro pra E.164 sem `+` (formato que o Graph
 * espera em `to`). Aceita `(11) 95976-5031`, `11959765031`,
 * `5511959765031`, `+55 11 95976-5031`… Retorna null se não parecer um
 * número BR válido.
 */
export function normalizeBrPhone(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return null;
  // Já com DDI 55: DDD (2) + 8 ou 9 dígitos.
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  // Sem DDI: DDD (2) + 8 (fixo) ou 9 (celular) dígitos.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return null;
}

// ─── Payloads (puros, testáveis) ────────────────────────────────────────────

export interface TemplateComponent {
  type: string;
  parameters?: unknown[];
  [key: string]: unknown;
}

export function buildTextPayload(to: string, body: string): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  };
}

export function buildTemplatePayload(
  to: string,
  templateName: string,
  languageCode: string,
  components?: TemplateComponent[]
): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components && components.length > 0 ? { components } : {}),
    },
  };
}

// ─── Envio ──────────────────────────────────────────────────────────────────

export interface SendResult {
  messageId: string;
  /** wa_id do destinatário como a Meta normalizou (pode diferir do `to`). */
  waId: string;
}

interface GraphMessagesResponse {
  messages?: Array<{ id?: string }>;
  contacts?: Array<{ wa_id?: string }>;
  error?: { message?: string; code?: number; error_subcode?: number };
}

/** POST no /messages do Dualhook. Payload já montado pelos builders acima. */
export async function sendWhatsAppMessage(
  payload: Record<string, unknown>
): Promise<SendResult> {
  const { token, phoneNumberId } = getWhatsAppConfig();
  const url = `${DUALHOOK_API_BASE}/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
  } catch {
    // 500, não 502: ver o comentário do bloco de erro abaixo — o Cloudflare
    // troca o corpo do 502 pela página dele e a explicação some.
    console.error('dualhook_send_failed', { status: 0, body: 'network' });
    throw new ServiceError('falha de rede ao chamar a API do Dualhook', 500, {
      upstreamStatus: 0,
    });
  }

  // Lê o corpo como TEXTO primeiro: em falha ele vai inteiro pro log, e a
  // resposta do Dualhook nem sempre é JSON (proxy, HTML de erro, corpo
  // vazio). `res.json()` engoliria justamente o caso que mais precisa ser
  // visto.
  const rawText = await res.text().catch(() => '');
  let data: GraphMessagesResponse = {};
  try {
    data = JSON.parse(rawText) as GraphMessagesResponse;
  } catch {
    /* corpo não-JSON cai na checagem de status abaixo */
  }

  if (!res.ok || data.error) {
    // NUNCA 502/504 daqui pra baixo: o Cloudflare SUBSTITUI o corpo dessas
    // duas pela página de erro dele, e a mensagem que explica a falha se
    // perde no caminho — quem está no portal vê "502 Bad gateway" e não
    // sabe se foi credencial, janela de 24h ou número errado. Erro 4xx do
    // Dualhook vira 400 (a culpa é da nossa requisição), o resto vira 500.
    // O `upstreamStatus` viaja no corpo (ServiceError.extra) pra tela poder
    // mostrar o número real.
    console.error('dualhook_send_failed', { status: res.status, body: rawText });

    const upstreamStatus = res.status;
    const extra = { upstreamStatus };
    const httpStatus = res.status >= 400 && res.status < 500 ? 400 : 500;
    const code = data.error?.code;

    // 131047: fora da janela de 24h — texto livre não entrega, precisa de
    // template aprovado. Erro mais comum na prática; mensagem acionável.
    // Fica em 422 de propósito: é status próprio, não é substituído pelo
    // Cloudflare, e a tela já o distingue de falha genérica.
    if (code === 131047 || data.error?.error_subcode === 131047) {
      throw new ServiceError(
        'destinatário fora da janela de 24h — use um template aprovado',
        422,
        extra
      );
    }
    // 132001: template inexistente ou não aprovado pra este idioma. O
    // detalhe da Meta é genérico ("Template name does not exist"), e sem
    // dizer o que conferir a pessoa vai procurar no lugar errado — o nome
    // vive no painel do Dualhook, e o par nome+idioma tem que bater EXATO.
    if (code === 132001 || data.error?.error_subcode === 132001) {
      throw new ServiceError(
        'template não encontrado ou não aprovado — confira nome e idioma no painel do Dualhook',
        422,
        extra
      );
    }
    // 190: credencial expirada/revogada. Chega tanto do Dualhook quanto,
    // repassado, da Meta — a ação agora é regenerar a Outbound API key no
    // painel do Dualhook, não o token no painel da Meta.
    if (code === 190 || res.status === 401 || res.status === 403) {
      throw new ServiceError(
        'credencial do Dualhook inválida ou expirada (regenerar a Outbound API key)',
        httpStatus,
        extra
      );
    }
    const detail = (data.error?.message || `HTTP ${res.status}`).slice(0, 200);
    throw new ServiceError(`Dualhook recusou o envio: ${detail}`, httpStatus, extra);
  }

  return {
    messageId: data.messages?.[0]?.id || '',
    waId: data.contacts?.[0]?.wa_id || '',
  };
}

export async function sendWhatsAppText(opts: {
  to: string;
  body: string;
}): Promise<SendResult> {
  // `normalizeWhatsAppTarget`, NÃO `normalizeBrPhone` (2026-09-05). O
  // segundo cola '55' em qualquer coisa com 10-11 dígitos: o contato dos
  // EUA `16503154274` virava `5516503154274`, inexistente. Foi exatamente
  // isso que causou o 502 de 2026-08-28 no caminho da Evolution, e com o
  // Dualhook virando canal ÚNICO o mesmo erro voltaria por aqui.
  const to = normalizeWhatsAppTarget(opts.to);
  if (!to) throw new ServiceError('telefone de destino inválido', 400);
  return sendWhatsAppMessage(buildTextPayload(to, opts.body));
}

/**
 * `true` quando a falha é "fora da janela de 24h" da Meta (131047 → 422).
 * Quem envia em LOTE precisa distinguir isso de erro de verdade: não
 * adianta tentar de novo na próxima varredura, só um template aprovado
 * resolve. Sem essa distinção o follow-up martela o mesmo contato de hora
 * em hora, pra sempre.
 */
export function isForaDaJanela24h(e: unknown): boolean {
  return e instanceof ServiceError && e.status === 422;
}

export async function sendWhatsAppTemplate(opts: {
  to: string;
  template: string;
  languageCode?: string;
  components?: TemplateComponent[];
}): Promise<SendResult> {
  // MESMA regra do `sendWhatsAppText`: `normalizeWhatsAppTarget`, NUNCA
  // `normalizeBrPhone`. O segundo cola '55' em qualquer coisa com 10-11
  // dígitos — foi o que virou o contato dos EUA `16503154274` em
  // `5516503154274` e causou o 502 de 2026-08-28. Aqui passou despercebido
  // quando o texto foi corrigido (2026-09-05), e o caminho de template é
  // justamente o da ABORDAGEM DE LEAD, onde número estrangeiro aparece de
  // verdade — a planilha importada tinha um.
  const to = normalizeWhatsAppTarget(opts.to);
  if (!to) throw new ServiceError('telefone de destino inválido', 400);
  return sendWhatsAppMessage(
    buildTemplatePayload(to, opts.template, opts.languageCode || 'pt_BR', opts.components)
  );
}

// ─── Templates aprovados ────────────────────────────────────────────────────
//
// Dois templates aprovados na Meta (ambos Marketing, pt_BR):
//   - `calicolors`      — texto fixo, sem variável;
//   - `calicolors_nome` — {{1}} = primeiro nome de quem recebe.
//
// O de nome é o padrão: mensagem que chama a pessoa pelo nome tem resposta
// melhor e parece menos disparo em massa. Mas ele SÓ pode ser usado com um
// nome de verdade — `{{1}}` vazio faria a Meta mandar "Oi ," pro cliente,
// ou recusar o envio. Por isso o fallback existe e é obrigatório.
export const TEMPLATE_SEM_NOME = 'calicolors';
export const TEMPLATE_COM_NOME = 'calicolors_nome';
/**
 * Template de três variáveis: {{1}} nome, {{2}} CIDADE, {{3}} segmento
 * ("Vi que você atende em {{2}} e trabalha com {{3}}"). Mensagem que diz a
 * cidade e o ramo da pessoa é a que menos parece disparo em massa — mas ela
 * depende de dado que parte da base não tem, então o fallback pro de nome é
 * obrigatório, não opcional.
 *
 * Era "bairro" até 2026-09-07; a decisão do usuário é CIDADE, que quase
 * todo lead tem (bairro faltava na maioria). O nome é o que a Meta aprovou.
 */
export const TEMPLATE_COM_CIDADE = 'calicolors_abordagem_v2';

/** Template padrão da abordagem. Env sobrescreve sem deploy. */
export function getTemplateAbordagem(): string {
  return getRuntimeEnv('WHATSAPP_TEMPLATE_ABORDAGEM') || TEMPLATE_COM_NOME;
}

/**
 * Template de 3 variáveis, ou null quando ele não está liberado.
 *
 * É OPT-IN pela env (`WHATSAPP_TEMPLATE_ABORDAGEM_CIDADE`), e isso não é
 * burocracia: template não aprovado na Meta faz o envio voltar 132001, e
 * ligar por padrão quebraria a abordagem de TODO lead que tem cidade e
 * segmento — a maioria da base importada. Aprovou lá, seta a env aqui e
 * liga sem deploy.
 */
export function getTemplateAbordagemCidade(): string | null {
  return getRuntimeEnv('WHATSAPP_TEMPLATE_ABORDAGEM_CIDADE') || null;
}

/**
 * Valor utilizável pra uma variável de template, ou null.
 *
 * Mesma régua do `primeiroNome`, pelo mesmo motivo: `{{2}}` vazio faz a
 * Meta entregar "atende em  " ou recusar o envio. Recusa também os
 * marcadores que a base importada usa no lugar do dado ("—", "n/a"), que
 * chegariam ao cliente como texto literal.
 */
export function valorDeVariavel(bruto: string | null | undefined): string | null {
  const limpo = (bruto || '').trim().replace(/\s+/g, ' ');
  if (limpo.length < 2) return null;
  if (!/[\p{L}]/u.test(limpo)) return null;
  if (/^(n\/?a|nao informado|não informado|sem (cidade|bairro|segmento)|indefinido)$/i.test(limpo)) {
    return null;
  }
  return limpo.slice(0, 60);
}

/**
 * Primeiro nome utilizável pra `{{1}}`, ou null.
 *
 * Devolve null pra qualquer coisa que não sirva como tratamento: vazio, só
 * espaço, ou um "nome" que na verdade é o telefone (a base tem lead cujo
 * `name` é o próprio número, vindo da importação). Mandar "Oi 11987654321"
 * é pior do que não mandar nome nenhum.
 */
export function primeiroNome(bruto: string | null | undefined): string | null {
  const limpo = (bruto || '').trim().replace(/\s+/g, ' ');
  if (!limpo) return null;
  // Só dígitos/pontuação de telefone → não é nome.
  if (!/[\p{L}]/u.test(limpo)) return null;
  const primeiro = limpo.split(' ')[0];
  // Uma letra só ("J") não é tratamento; melhor cair no template sem nome.
  if (primeiro.length < 2) return null;
  return primeiro.slice(0, 60);
}

export interface EscolhaDeTemplate {
  template: string;
  components?: TemplateComponent[];
  /** Nome usado no {{1}}, pra registrar no histórico. */
  nome: string | null;
}

/**
 * Escolhe o template e monta os `components`.
 *
 * Com nome utilizável → o de variável. Sem nome → o fixo. Nunca manda
 * `{{1}}` vazio: a regra vive AQUI, num lugar só, porque ela é a mesma pro
 * botão de abordagem, pra tela de WhatsApp e pro follow-up — e se cada um
 * decidisse por conta, um deles acabaria mandando "Oi ,".
 */
export function escolherTemplate(
  nomeBruto: string | null | undefined,
  preferido?: string,
  dados?: { cidade?: string | null; segmento?: string | null }
): EscolhaDeTemplate {
  const nome = primeiroNome(nomeBruto);
  if (!nome) return { template: TEMPLATE_SEM_NOME, nome: null };

  // Degrau de cima: nome + cidade + segmento. Falta UM e desce pro de
  // nome — meia personalização não existe, {{2}} vazio é envio recusado
  // ou frase quebrada na tela do cliente. `preferido` (o operador
  // escolheu na tela) manda mais que o degrau automático.
  const cidade = valorDeVariavel(dados?.cidade);
  const segmento = valorDeVariavel(dados?.segmento);
  const comCidade = getTemplateAbordagemCidade();
  if (!preferido && comCidade && cidade && segmento) {
    return {
      template: comCidade,
      nome,
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: nome },
            { type: 'text', text: cidade },
            { type: 'text', text: segmento },
          ],
        },
      ],
    };
  }
  return {
    template: preferido || getTemplateAbordagem(),
    nome,
    components: [{ type: 'body', parameters: [{ type: 'text', text: nome }] }],
  };
}

// ─── Persistência (SQL Wave 38: tabela whatsapp_messages) ───────────────────

export interface PersistWhatsAppMessageInput {
  /** De onde saiu a mensagem 'out': portal (gente), ia (automática) ou
   *  celular (digitada no aparelho — só o webhook enxerga essa). */
  origin?: 'portal' | 'ia' | 'celular' | null;
  direction: 'in' | 'out';
  waId: string;
  profileName?: string;
  /** wamid da Meta. UNIQUE no banco — retry de webhook não duplica linha. */
  messageId?: string;
  type?: string;
  body?: string;
  template?: string;
  /** UUID do admin que enviou (só direction='out'). */
  sentBy?: string;
  /** Epoch em SEGUNDOS como a Meta manda (string). */
  waTimestamp?: string;
  /** Caminho do arquivo no bucket `whatsapp-media` (foto/áudio/vídeo). */
  mediaUrl?: string | null;
  mediaMime?: string | null;
  /** Texto do áudio (Whisper) — o que a IA lê no lugar do "[áudio]". */
  transcript?: string | null;
}

const PERSIST_TIMEOUT_MS = 8000;

/**
 * Grava uma mensagem (recebida ou enviada) em `whatsapp_messages` via REST
 * com service_role. BEST-EFFORT: retorna false em qualquer falha (tabela
 * ainda não criada, env ausente, rede) — persistir nunca pode custar o 200
 * do webhook nem uma mensagem já enviada com sucesso.
 */
export async function persistWhatsAppMessage(
  input: PersistWhatsAppMessageInput
): Promise<boolean> {
  try {
    const url = getSupabaseUrl();
    const serviceKey = getServiceKey();
    if (!url || !serviceKey) return false;

    let waTimestamp: string | null = null;
    if (input.waTimestamp && /^\d+$/.test(input.waTimestamp)) {
      const d = new Date(Number(input.waTimestamp) * 1000);
      if (!Number.isNaN(d.getTime())) waTimestamp = d.toISOString();
    }

    const row = {
      direction: input.direction,
      wa_id: input.waId,
      profile_name: input.profileName || null,
      message_id: input.messageId || null, // '' vira NULL (UNIQUE permite múltiplos)
      type: input.type || 'text',
      body: input.body || null,
      template: input.template || null,
      sent_by: input.sentBy || null,
      // Origem do envio (2026-08-30): 'portal' | 'ia' | 'celular'. É o que
      // permite marcar no portal quem está tocando cada conversa — antes
      // IA e celular eram indistinguíveis (os dois gravavam sent_by NULL).
      ...(input.origin ? { origin: input.origin } : {}),
      wa_timestamp: waTimestamp,
      ...(input.mediaUrl ? { media_url: input.mediaUrl } : {}),
      ...(input.mediaMime ? { media_mime: input.mediaMime } : {}),
      ...(input.transcript ? { transcript: input.transcript } : {}),
    };

    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/whatsapp_messages?on_conflict=message_id`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          // ignore-duplicates: retry de webhook da Meta (mesmo wamid) vira no-op.
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(PERSIST_TIMEOUT_MS),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Grava o status de entrega na linha da mensagem que saiu.
 *
 * PATCH por `message_id` (o wamid), que já é UNIQUE. Não cria linha: status
 * de mensagem que não temos (enviada por outro caminho, ou anterior ao
 * histórico) simplesmente não tem onde pousar, e inventar uma linha sem
 * corpo poluiria a conversa.
 *
 * Best-effort, como toda a escrituração do webhook: falhar aqui não pode
 * custar o 200 pra Meta. E TOLERA A COLUNA AUSENTE de propósito — se a
 * migration ainda não rodou, o PATCH volta 42703/400 e a função devolve
 * false; a mensagem segue sendo entregue e gravada normalmente, só sem o
 * ✓✓. Mesma lição do `quotes.post_id` e do `leads.city`: recurso novo não
 * pode quebrar o que já funcionava por causa de SQL pendente.
 */
export async function persistStatusEntrega(
  st: AtualizacaoDeStatus
): Promise<boolean> {
  try {
    const url = getSupabaseUrl();
    const serviceKey = getServiceKey();
    if (!url || !serviceKey || !st.messageId) return false;

    let quando: string | null = null;
    if (st.timestamp && /^\d+$/.test(st.timestamp)) {
      const d = new Date(Number(st.timestamp) * 1000);
      if (!Number.isNaN(d.getTime())) quando = d.toISOString();
    }

    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/whatsapp_messages` +
        `?message_id=eq.${encodeURIComponent(st.messageId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          delivery_status: st.status,
          delivery_status_at: quando || new Date().toISOString(),
          delivery_error: st.erro,
          delivery_error_code: st.erroCodigo,
          delivery_error_title: st.erroTitulo,
        }),
        signal: AbortSignal.timeout(PERSIST_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      // Log com o corpo: é assim que "o ✓✓ não aparece" deixa de ser
      // mistério — a resposta diz se é coluna ausente ou outra coisa.
      const corpo = await res.text().catch(() => '');
      console.warn(
        `[whatsapp-status] PATCH falhou (${res.status}) msg=${st.messageId}: ${corpo.slice(0, 200)}`
      );
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Abordagem de lead: o que a Meta confirmou, gravado NO LEAD ─────────────
//
// INCIDENTE (2026-09-09): uma leva de abordagens saiu do portal, a API
// aceitou todas (200 com wamid), o portal marcou cada lead como
// `contactado` — e minutos depois a Meta devolveu `failed` 131026 (Message
// undeliverable) pra boa parte delas. A tela de Leads dizia "contactado" pra
// gente que nunca recebeu nada, e não havia como separar quem recebeu de
// quem deu erro sem abrir conversa por conversa.
//
// A causa: "a API aceitou" e "a mensagem chegou" são momentos diferentes, e
// o portal tratava o primeiro como o segundo. A confirmação de verdade é o
// aviso de status que a Meta manda DEPOIS, no webhook (sent/delivered/read/
// failed) — e esse aviso pousava só em `whatsapp_messages`, longe do lead.
//
// Agora o lead carrega a própria abordagem:
//   abordagem_message_id  wamid do último envio (é por ele que o status acha o lead)
//   abordagem_status      'accepted' (API aceitou, sem confirmação ainda) |
//                         'sent' | 'delivered' | 'read' | 'failed'
//   abordagem_error       motivo da Meta, só em 'failed'
//   abordagem_at          quando o último status chegou
//
// E `leads.status` só vira `contactado` quando a Meta confirma (sent ou
// melhor); `failed` que chega depois desfaz o `contactado`. Quem escreve é
// o SERVIDOR (rota de envio + webhook), não o portal: o webhook precisa
// achar o lead pelo wamid, e o wamid só existe depois do envio.
//
// Tudo best-effort e TOLERANTE À COLUNA AUSENTE (mesma regra de
// `persistStatusEntrega`): se o SQL de 2026-09-09 ainda não rodou, o PATCH
// volta 42703/400, a função devolve false e o envio segue funcionando —
// só sem o vínculo. Recurso novo não derruba o que já funciona.

export type StatusDeAbordagem = 'accepted' | StatusEntrega;

/** Ordem dos status do lead: só andamos pra frente (`failed` é desfecho). */
const PESO_ABORDAGEM: Record<StatusDeAbordagem, number> = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/**
 * Filtro PostgREST que deixa passar só a linha cujo status atual é MENOR
 * que `novo` (ou nulo). Serve pra um `sent` atrasado não desfazer um
 * `delivered` — a Meta entrega fora de ordem e reenvia.
 */
export function filtroSoAvanca(novo: StatusDeAbordagem): string {
  const maiores = (Object.keys(PESO_ABORDAGEM) as StatusDeAbordagem[]).filter(
    (s) => PESO_ABORDAGEM[s] >= PESO_ABORDAGEM[novo]
  );
  return `or=(abordagem_status.is.null,abordagem_status.not.in.(${maiores.join(',')}))`;
}

function cabecalhosServiceRole(serviceKey: string, prefer: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  };
}

/**
 * Rota de envio: amarra o wamid ao lead assim que a API aceita. Sem isto o
 * status que chega no webhook não tem como saber de qual lead é.
 *
 * NÃO mexe em `leads.status`: aceito pela API ainda não é contato — foi
 * exatamente essa confusão que gerou o incidente.
 */
export async function vincularAbordagemAoLead(input: {
  leadId: string;
  messageId: string;
}): Promise<boolean> {
  try {
    const url = getSupabaseUrl();
    const serviceKey = getServiceKey();
    if (!url || !serviceKey || !input.leadId || !input.messageId) return false;
    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/leads?id=eq.${encodeURIComponent(input.leadId)}`,
      {
        method: 'PATCH',
        headers: cabecalhosServiceRole(serviceKey, 'return=minimal'),
        body: JSON.stringify({
          abordagem_message_id: input.messageId,
          abordagem_status: 'accepted',
          abordagem_error: null,
          abordagem_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(PERSIST_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      console.warn(
        `[whatsapp-lead] vínculo falhou (${res.status}) lead=${input.leadId}: ${corpo.slice(0, 200)}`
      );
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type ResultadoStatusDoLead =
  | 'sem-lead'
  | 'atualizado'
  | 'contactado'
  | 'desfeito'
  | 'falhou';

/**
 * Webhook: leva o aviso de entrega até o lead dono do wamid e decide o
 * funil.
 *
 *   sent/delivered/read  → grava o status; lead `novo` vira `contactado`.
 *   failed               → grava status + motivo; lead `contactado` VOLTA a
 *                          `novo` (ele nunca recebeu). Qualificado/convertido
 *                          /perdido não são tocados — são decisão de gente.
 *
 * Devolve 'sem-lead' quando nenhuma linha tem esse wamid: mensagem que não
 * era abordagem de lead (aba WhatsApp, IA, follow-up), ou o vínculo da rota
 * de envio ainda não pousou — o chamador pode tentar de novo.
 */
export async function persistStatusDoLead(
  st: AtualizacaoDeStatus
): Promise<ResultadoStatusDoLead> {
  try {
    const url = getSupabaseUrl();
    const serviceKey = getServiceKey();
    if (!url || !serviceKey || !st.messageId) return 'falhou';
    const base = `${url.replace(/\/$/, '')}/rest/v1/leads`;

    let quando: string | null = null;
    if (st.timestamp && /^\d+$/.test(st.timestamp)) {
      const d = new Date(Number(st.timestamp) * 1000);
      if (!Number.isNaN(d.getTime())) quando = d.toISOString();
    }

    const res = await fetch(
      `${base}?abordagem_message_id=eq.${encodeURIComponent(st.messageId)}` +
        `&${filtroSoAvanca(st.status)}&select=id,status`,
      {
        method: 'PATCH',
        headers: cabecalhosServiceRole(serviceKey, 'return=representation'),
        body: JSON.stringify({
          abordagem_status: st.status,
          abordagem_error: st.status === 'failed' ? st.erro || 'falha sem detalhe' : null,
          abordagem_at: quando || new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(PERSIST_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      console.warn(
        `[whatsapp-lead] status falhou (${res.status}) msg=${st.messageId}: ${corpo.slice(0, 200)}`
      );
      return 'falhou';
    }
    const linhas = (await res.json().catch(() => [])) as Array<{ id: string; status: string | null }>;
    if (!Array.isArray(linhas) || linhas.length === 0) return 'sem-lead';

    // Só o funil muda com condição: `status=eq.` no filtro garante que um
    // operador que já moveu o lead pra qualificado não é atropelado.
    const de = st.status === 'failed' ? 'contactado' : 'novo';
    const para = st.status === 'failed' ? 'novo' : 'contactado';
    const alvo = linhas.find((l) => (l.status || 'novo') === de);
    if (!alvo) return 'atualizado';
    const flip = await fetch(
      `${base}?id=eq.${encodeURIComponent(alvo.id)}` +
        (de === 'novo' ? `&or=(status.is.null,status.eq.novo)` : `&status=eq.${de}`),
      {
        method: 'PATCH',
        headers: cabecalhosServiceRole(serviceKey, 'return=minimal'),
        body: JSON.stringify({ status: para }),
        signal: AbortSignal.timeout(PERSIST_TIMEOUT_MS),
      }
    );
    if (!flip.ok) return 'atualizado';
    return para === 'contactado' ? 'contactado' : 'desfeito';
  } catch {
    return 'falhou';
  }
}

// ─── Webhook: verificação de assinatura ─────────────────────────────────────

/**
 * Valida o header `X-Hub-Signature-256` do webhook da Meta:
 * `sha256=<hex do HMAC-SHA256(app_secret, rawBody)>`. Comparação
 * constant-time. Edge-safe (só crypto.subtle).
 */
export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice('sha256='.length).toLowerCase();

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(appSecret) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(rawBody) as unknown as BufferSource)
  );
  let expected = '';
  for (let i = 0; i < mac.length; i++) {
    expected += mac[i].toString(16).padStart(2, '0');
  }

  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Webhook: segredo de URL (modo Dualhook) ────────────────────────────────

/** Compara duas strings em tempo constante (evita timing leak do token). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Confere o `?token=` da URL do webhook contra `WHATSAPP_WEBHOOK_URL_SECRET`.
 * Retorna 'ok' | 'missing-config' | 'invalid'. Sem env configurada é
 * fail-closed (503 no caller) — nunca aceitar sem segredo no modo payload.
 */
export function checkWebhookUrlSecret(
  url: URL,
  configured: string | undefined
): 'ok' | 'missing-config' | 'invalid' {
  if (!configured) return 'missing-config';
  const provided = url.searchParams.get('token') || '';
  return safeEqual(provided, configured) ? 'ok' : 'invalid';
}

// ─── Webhook: validação do formato do payload (modo Dualhook) ────────────────

/**
 * Confere se o envelope é o que a Meta manda pro NOSSO número: objeto
 * `whatsapp_business_account`, ao menos um `entry` e TODOS os entries com
 * `id` = nosso WABA, `changes` não vazio, todo change com `field='messages'`
 * e `value.metadata.phone_number_id` = nosso número. Qualquer desvio → false.
 *
 * Substitui o HMAC quando o webhook chega via Dualhook (assinatura deles,
 * não verificável). Não é autenticação criptográfica — é a validação que o
 * Dualhook recomenda; a URL do webhook deve continuar não-pública.
 */
export type WebhookVeredito = 'processar' | 'ignorar' | 'rejeitar';

/**
 * Classifica o envelope em três desfechos — e a distinção entre os dois
 * últimos é o ponto.
 *
 * A versão anterior devolvia só true/false, e o `false` virava 403. Só que
 * a Meta manda no MESMO webhook eventos que não são mensagem
 * (`message_template_status_update`, `account_update`, `phone_number_...`).
 * Todos caíam em 403 — e 403 pra Meta significa "não entreguei", então ela
 * REENVIA, indefinidamente, um evento que nunca teríamos processado.
 * Fila de retry crescendo por um evento que só precisava de um "ok, ignorei".
 *
 * - `processar`: nosso WABA, `field='messages'`, nosso `phone_number_id`.
 * - `ignorar`: nosso WABA, mas nenhum change de mensagem → 200 sem trabalho.
 * - `rejeitar`: envelope de outra conta ou malformado → 403.
 *
 * Um change de MENSAGEM com `phone_number_id` de outro número continua
 * sendo `rejeitar`: aí não é "evento que não me interessa", é entrega no
 * endereço errado, e engolir isso com 200 esconderia exatamente o tipo de
 * erro de configuração que custou o incidente dos defaults.
 *
 * Isto NÃO é autenticação — os IDs são públicos. Quem autentica é o segredo
 * de URL; esta função é validação de forma.
 */
export function classifyWebhookPayload(
  payload: unknown,
  expected: { wabaId: string; phoneNumberId: string }
): WebhookVeredito {
  if (!payload || typeof payload !== 'object') return 'rejeitar';
  const body = payload as { object?: unknown; entry?: unknown };
  if (body.object !== 'whatsapp_business_account') return 'rejeitar';
  if (!Array.isArray(body.entry) || body.entry.length === 0) return 'rejeitar';

  let temMensagem = false;
  for (const entry of body.entry as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== 'object') return 'rejeitar';
    if (String(entry.id ?? '') !== expected.wabaId) return 'rejeitar';
    const changes = entry.changes;
    if (!Array.isArray(changes) || changes.length === 0) return 'rejeitar';
    for (const change of changes as Array<Record<string, unknown>>) {
      if (!change || typeof change !== 'object') return 'rejeitar';
      if (change.field !== 'messages') continue; // evento de outro tipo
      const value = change.value as { metadata?: { phone_number_id?: unknown } } | undefined;
      if (String(value?.metadata?.phone_number_id ?? '') !== expected.phoneNumberId) {
        return 'rejeitar';
      }
      temMensagem = true;
    }
  }
  return temMensagem ? 'processar' : 'ignorar';
}

/**
 * Compatibilidade: só `processar` conta como "é o envelope que esperamos".
 * A ROTA usa `classifyWebhookPayload` — precisa separar ignorar de rejeitar.
 */
export function isExpectedWebhookPayload(
  payload: unknown,
  expected: { wabaId: string; phoneNumberId: string }
): boolean {
  return classifyWebhookPayload(payload, expected) === 'processar';
}

// ─── Webhook: parse do payload de entrada ───────────────────────────────────

export interface InboundWhatsAppMessage {
  from: string;
  messageId: string;
  timestamp: string;
  type: string;
  /**
   * Corpo da mensagem. Além do texto puro, carrega a legenda de mídia e o
   * RÓTULO do botão quando a pessoa responde por quick reply de template
   * (`type='button'`) ou por menu (`type='interactive'`).
   */
  text: string;
  /** Nome de perfil do remetente, quando a Meta manda. */
  profileName: string;
  /**
   * Mídia: na Cloud API o webhook NÃO traz o arquivo, só um id — os bytes
   * se buscam depois, em dois passos. (A Evolution mandava base64 no
   * próprio evento; por isso este campo não existia antes.)
   */
  mediaId: string | null;
  mediaMime: string | null;
  /** Nome original, só em documento. */
  filename: string | null;
  /**
   * Payload do botão — o valor que NÓS definimos no template, que pode
   * diferir do rótulo que a pessoa lê. Guardado porque é o identificador
   * estável: mudar o texto do botão no painel não deveria quebrar quem
   * decide pelo payload.
   */
  replyPayload: string | null;
}

/**
 * Rótulo do botão que a pessoa tocou.
 *
 * Quick reply de TEMPLATE chega como `type='button'` com `{text, payload}`;
 * botão/lista de mensagem interativa chega como `type='interactive'` com
 * `button_reply.title` ou `list_reply.title`. Os dois casos caíam em texto
 * VAZIO: a bolha aparecia em branco na conversa e o atendimento automático
 * pulava a mensagem (`if (!texto) continue`), então quem respondeu tocando
 * no botão ficava sem resposta — justamente quem demonstrou interesse.
 */
function textoDeBotao(msg: Record<string, unknown>): { texto: string; payload: string | null } {
  const btn = msg.button as { text?: unknown; payload?: unknown } | undefined;
  if (btn && typeof btn.text === 'string') {
    return { texto: btn.text, payload: typeof btn.payload === 'string' ? btn.payload : null };
  }
  const inter = msg.interactive as
    | {
        button_reply?: { id?: unknown; title?: unknown };
        list_reply?: { id?: unknown; title?: unknown };
      }
    | undefined;
  const escolha = inter?.button_reply || inter?.list_reply;
  if (escolha && typeof escolha.title === 'string') {
    return { texto: escolha.title, payload: typeof escolha.id === 'string' ? escolha.id : null };
  }
  return { texto: '', payload: null };
}

/**
 * Extrai as mensagens recebidas do envelope de webhook da Meta
 * (`entry[].changes[].value.messages[]`). Status de entrega
 * (`value.statuses[]`) são ignorados aqui — caller decide se loga.
 */
export function parseInboundMessages(payload: unknown): InboundWhatsAppMessage[] {
  const out: InboundWhatsAppMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value;
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue;
      const contacts = Array.isArray(value?.contacts)
        ? (value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }>)
        : [];
      for (const msg of messages as Array<Record<string, unknown>>) {
        const from = typeof msg.from === 'string' ? msg.from : '';
        const contact = contacts.find((c) => c.wa_id === from) || contacts[0];
        const tipo = typeof msg.type === 'string' ? msg.type : 'unknown';
        // O objeto da mídia vem numa chave com o NOME DO TIPO
        // (`audio`, `image`, `sticker`, `video`, `document`) — não numa
        // chave fixa. Legenda de foto/vídeo vem em `caption`, e é ela que
        // deve virar o corpo da mensagem na conversa.
        const midia = msg[tipo] as
          | { id?: unknown; mime_type?: unknown; caption?: unknown; filename?: unknown }
          | undefined;
        const botao = textoDeBotao(msg);
        const texto =
          typeof (msg.text as { body?: unknown } | undefined)?.body === 'string'
            ? (msg.text as { body: string }).body
            : typeof midia?.caption === 'string'
              ? midia.caption
              : botao.texto;
        out.push({
          from,
          messageId: typeof msg.id === 'string' ? msg.id : '',
          timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : '',
          type: tipo,
          text: texto,
          profileName: contact?.profile?.name || '',
          mediaId: typeof midia?.id === 'string' ? midia.id : null,
          mediaMime: typeof midia?.mime_type === 'string' ? midia.mime_type : null,
          filename: typeof midia?.filename === 'string' ? midia.filename : null,
          replyPayload: botao.payload,
        });
      }
    }
  }
  return out;
}

/** Status de entrega que a Meta reporta pra uma mensagem que MANDAMOS. */
export type StatusEntrega = 'sent' | 'delivered' | 'read' | 'failed';

export interface AtualizacaoDeStatus {
  /** wamid da mensagem que saiu — casa com `whatsapp_messages.message_id`. */
  messageId: string;
  status: StatusEntrega;
  /** Epoch em segundos, como a Meta manda. */
  timestamp: string;
  recipientId: string;
  /** Só em `failed`: por que não entregou (código · título · detalhe). */
  erro: string | null;
  /** Código da Meta, separado pra dar pra filtrar/agrupar falha por causa. */
  erroCodigo: number | null;
  /** Título curto da Meta, sem o detalhe. */
  erroTitulo: string | null;
}

// A ordem importa: a Meta pode entregar os eventos fora de ordem (e reenviar
// os antigos), e sem isso um `sent` atrasado sobrescreveria um `read` que já
// tínhamos. Nunca deixamos o status ANDAR PRA TRÁS — exceto pra `failed`,
// que é desfecho e sempre vence.
const PESO_STATUS: Record<StatusEntrega, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/** `novo` deve substituir `atual`? */
export function statusAvanca(
  atual: string | null | undefined,
  novo: StatusEntrega
): boolean {
  const antes = PESO_STATUS[(atual || '') as StatusEntrega] ?? 0;
  return PESO_STATUS[novo] > antes;
}

/**
 * Extrai os avisos de entrega do envelope.
 *
 * A Meta manda status no MESMO webhook das mensagens, com `field='messages'`
 * — a diferença é que o `value` traz `statuses` em vez de `messages`. Por
 * isso eles já passavam pela validação do envelope e mesmo assim eram
 * DESCARTADOS: `parseInboundMessages` devolvia lista vazia e a rota só
 * processava quando havia mensagem. O portal registrava que a loja mandou e
 * nunca sabia se chegou.
 */
export function parseStatusUpdates(payload: unknown): AtualizacaoDeStatus[] {
  const out: AtualizacaoDeStatus[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value;
      const statuses = value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const st of statuses as Array<Record<string, unknown>>) {
        const status = String(st.status ?? '');
        if (!['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
        const messageId = typeof st.id === 'string' ? st.id : '';
        if (!messageId) continue;
        // O motivo da falha é o que faz a diferença pra quem opera: sem ele
        // a tela só diria "falhou" e a pessoa ficaria adivinhando entre
        // número sem WhatsApp, opt-out de marketing e limite da Meta.
        let erro: string | null = null;
        let erroCodigo: number | null = null;
        let erroTitulo: string | null = null;
        const errs = st.errors;
        if (Array.isArray(errs) && errs.length > 0) {
          const e = errs[0] as {
            code?: unknown;
            title?: unknown;
            message?: unknown;
            error_data?: { details?: unknown };
          };
          const n = Number(e.code);
          erroCodigo = Number.isFinite(n) ? n : null;
          erroTitulo = String(e.title || e.message || '').slice(0, 200) || null;
          const partes = [
            erroCodigo != null ? `${erroCodigo}` : '',
            erroTitulo || '',
            String(e.error_data?.details || ''),
          ].filter(Boolean);
          erro = partes.join(' · ').slice(0, 300) || 'falha sem detalhe';
        }
        out.push({
          messageId,
          status: status as StatusEntrega,
          timestamp: typeof st.timestamp === 'string' ? st.timestamp : '',
          recipientId: typeof st.recipient_id === 'string' ? st.recipient_id : '',
          erro,
          erroCodigo,
          erroTitulo,
        });
      }
    }
  }
  return out;
}

/**
 * Descreve, pra log, os IDs que vieram num envelope recusado.
 *
 * Existe porque "payload rejeitado" sozinho manda quem depura abrir o
 * Cloudflare, o Dualhook e o painel da Meta pra descobrir qual dos dois IDs
 * não bateu — e o modo de falha aqui é silêncio (403 pro Dualhook, nada no
 * portal), então a linha de log é a ÚNICA pista que sobra. Os IDs são
 * públicos: aparecem na URL da API e no painel, então logá-los não vaza
 * nada. Nunca inclui o conteúdo da conversa.
 */
export function resumirEnvelope(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'payload não é objeto';
  const body = payload as { object?: unknown; entry?: unknown };
  const partes = [`object=${String(body.object ?? '(ausente)')}`];
  const entry = Array.isArray(body.entry)
    ? (body.entry[0] as Record<string, unknown> | undefined)
    : undefined;
  partes.push(`waba=${String(entry?.id ?? '(ausente)')}`);
  const change = Array.isArray(entry?.changes)
    ? ((entry.changes as Array<Record<string, unknown>>)[0] as
        | Record<string, unknown>
        | undefined)
    : undefined;
  partes.push(`field=${String(change?.field ?? '(ausente)')}`);
  const value = change?.value as { metadata?: { phone_number_id?: unknown } } | undefined;
  partes.push(`phone_number_id=${String(value?.metadata?.phone_number_id ?? '(ausente)')}`);
  return partes.join(' ');
}
