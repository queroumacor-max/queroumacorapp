// crm.ts — service layer pra feature "Reativar Clientes" (mini-CRM de
// follow-up). Espelha modules/crm.js do vanilla, mas com 2 simplificações
// pragmáticas pro port Next.js:
//
//  1. **Sem upsert em `crm_clients`.** O vanilla deleta + reinsere essa
//     tabela a cada `loadCrm()` pra cachear os clientes derivados de
//     `jobs` + `quotes`. Aqui derivamos em memória e devolvemos o
//     array — TanStack Query cuida do cache no client. Vantagem: tira
//     uma round-trip de delete/insert por load e remove dependência de
//     uma tabela que (a) não está no `supabase_init.sql` canônico e (b)
//     não temos shape definitivo. Quando rolar migration estável, dá
//     pra plugar persistência sem mexer no consumer.
//
//  2. **`generateDraftMessage` chama o endpoint vanilla** (`/api/crm-draft`)
//     que continua deployado. Mesmo pattern de `optimizeDayOrder` em
//     agenda.ts — fetch direto, parse tolerante. Deploy paralelo do
//     Next.js + vanilla resolve o cross-origin (mesmo domínio).
//
// Schema referenciado:
//   - `jobs` (painter_id, client_name, service_type, scheduled_date, revenue)
//     — supabase_init.sql linha 613+
//   - `quotes` (painter_id, client_id, client_name, client_phone,
//     client_followup_optin, service_type, title, status, created_at,
//     approved_at, price) — supabase_init.sql linha 1080+
//   - `follow_ups` (painter_id, quote_id?, scheduled_at?, message, status,
//     sent_at) — supabase_init.sql linha 766+. NOTE: o schema atual NÃO
//     tem `crm_client_id` nem `channel`; gravamos só os campos que existem
//     pra evitar 400. `quote_id` fica NULL porque o follow-up CRM não
//     necessariamente está atrelado a um orçamento específico.
//   - `profiles.followup_interval_months` (int) — coluna usada pra
//     persistir o intervalo configurado pelo pintor.

import { getSupabase } from '@/lib/supabase';
import {
  ValidationError,
  NetworkError,
} from '@/lib/errors';
import { crmNormName, crmMonthsSince } from '@/lib/utils';

// Cliente derivado em memória a partir de jobs + quotes. Não vem de uma
// tabela — é o agregado que a UI consome. `id` é estável (hash do key
// usado em dedup), pro React conseguir usar como key sem precisar gerar
// uuid a cada load.
export interface CrmClient {
  id: string;
  client_user_id: string | null;
  client_name: string;
  client_phone: string | null;
  is_app_user: boolean;
  followup_optin: boolean;
  last_service_at: string | null; // YYYY-MM-DD
  last_service_desc: string | null;
  total_value: number;
  months_since: number | null; // derived (crmMonthsSince do last_service_at)
}

// Resposta de `generateDraftMessage` — espelha o que o endpoint
// `/api/crm-draft` devolve (`{ draft: string }`).
export interface CrmDraftResult {
  draft: string;
}

// Input pra `saveFollowUp`. `painter_id` vem do contexto auth — repassa
// como param pra não precisar de Supabase auth call interno aqui (mantém
// o service síncrono-friendly e testável).
export interface SaveFollowUpInput {
  painter_id: string;
  message: string;
  channel?: 'app' | 'whatsapp';
  // quote_id opcional — follow-up CRM não está sempre atrelado a uma quote
  // específica. Quando vier, vira FK.
  quote_id?: string | null;
}

// Limites defensivos pra leitura — pintor tipicamente tem dezenas, não
// milhares. Se um pintor cruzar isso, refazemos com paginação.
const JOBS_LIMIT = 500;
const QUOTES_LIMIT = 500;

interface JobRow {
  id: string;
  client_name: string | null;
  service_type: string | null;
  scheduled_date: string | null;
  created_at: string | null;
  revenue: number | null;
}

interface QuoteRow {
  id: string;
  client_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_followup_optin: boolean | null;
  service_type: string | null;
  title: string | null;
  status: string | null;
  created_at: string | null;
  approved_at: string | null;
  price: number | null;
}

// Hash determinístico do key — usado como `id` do CrmClient. Evita criar
// UUIDs (que mudariam a cada load e quebrariam o key do React).
function hashKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h) + key.charCodeAt(i);
    h |= 0;
  }
  return 'crm_' + Math.abs(h).toString(36);
}

/**
 * Busca clientes elegíveis pro CRM (clientes com último serviço há
 * `intervalMonths` meses ou mais). Devolve a lista COMPLETA derivada de
 * `jobs` + `quotes`, com `months_since` já calculado — a UI filtra por
 * intervalo localmente pra não precisar refetch quando usuário muda o
 * input.
 *
 * Retorna [] se painterId vazio (consistente com fetchPedidos/fetchLeads).
 *
 * `intervalMonths` é aceito pra paridade com o vanilla, mas NÃO filtra
 * a lista — só é incluído pra documentar a intenção. O caller filtra
 * em memória via `c.months_since >= intervalMonths`.
 */
export async function fetchEligibleClients(
  painterId: string,
  _intervalMonths = 12
): Promise<CrmClient[]> {
  if (!painterId) return [];
  const sb = getSupabase();

  // Paralelo: jobs + quotes. Mesmas colunas que o vanilla usa.
  const [jobsRes, quotesRes] = await Promise.all([
    sb
      .from('jobs')
      .select(
        'id, client_name, service_type, scheduled_date, created_at, revenue'
      )
      .eq('painter_id', painterId)
      .limit(JOBS_LIMIT),
    sb
      .from('quotes')
      .select(
        'id, client_id, client_name, client_phone, client_followup_optin, service_type, title, status, created_at, approved_at, price'
      )
      .eq('painter_id', painterId)
      .in('status', ['aprovado', 'em_execucao', 'concluido'])
      .limit(QUOTES_LIMIT),
  ]);

  if (jobsRes.error) {
    throw new NetworkError(jobsRes.error.message, jobsRes.error);
  }
  if (quotesRes.error) {
    throw new NetworkError(quotesRes.error.message, quotesRes.error);
  }

  const jobs = (jobsRes.data ?? []) as JobRow[];
  const quotes = (quotesRes.data ?? []) as QuoteRow[];

  // Dedup por key: u:<client_user_id> quando o cliente é do app, ou
  // n:<crmNormName(name)> quando é externo. Mesmo critério do vanilla.
  const map = new Map<string, CrmClient>();
  const keyFor = (clientUserId: string | null, name: string) =>
    clientUserId ? 'u:' + clientUserId : 'n:' + crmNormName(name);

  const touch = (key: string, name: string): CrmClient => {
    let c = map.get(key);
    if (!c) {
      c = {
        id: hashKey(key),
        client_user_id: null,
        client_name: name || 'Cliente',
        client_phone: null,
        is_app_user: false,
        followup_optin: false,
        last_service_at: null,
        last_service_desc: null,
        total_value: 0,
        months_since: null,
      };
      map.set(key, c);
    }
    return c;
  };

  const bumpDate = (
    c: CrmClient,
    dateStr: string | null,
    desc: string | null
  ): void => {
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    const iso = d.toISOString().slice(0, 10);
    if (!c.last_service_at || iso > c.last_service_at) {
      c.last_service_at = iso;
      c.last_service_desc = desc || c.last_service_desc;
    }
  };

  for (const j of jobs) {
    const name = j.client_name || 'Cliente';
    const c = touch(keyFor(null, name), name);
    bumpDate(c, j.scheduled_date || j.created_at, j.service_type);
    c.total_value += Number(j.revenue) || 0;
  }

  for (const q of quotes) {
    const cuid = q.client_id || null;
    const name = q.client_name || 'Cliente';
    const c = touch(keyFor(cuid, name), name);
    if (cuid) {
      c.client_user_id = cuid;
      c.is_app_user = true;
    }
    if (q.client_phone && !c.client_phone) c.client_phone = q.client_phone;
    if (q.client_followup_optin) c.followup_optin = true;
    bumpDate(c, q.approved_at || q.created_at, q.service_type || q.title);
    c.total_value += Number(q.price) || 0;
  }

  // Computa months_since uma vez aqui — UI lê direto sem chamar utilitário.
  const out: CrmClient[] = [];
  for (const c of map.values()) {
    if (!c.client_name) continue;
    c.months_since = crmMonthsSince(c.last_service_at);
    out.push(c);
  }

  // Ordena por "mais antigo primeiro" — clientes mais defasados aparecem
  // no topo pra priorizar follow-up. Sem last_service_at vai pro fim.
  out.sort((a, b) => {
    const am = a.months_since ?? -1;
    const bm = b.months_since ?? -1;
    return bm - am;
  });

  return out;
}

/**
 * Busca o intervalo de follow-up configurado pelo pintor em
 * `profiles.followup_interval_months`. Default 12 quando ausente/null.
 * Erros silenciosos → fallback pra 12 (preferimos UX consistente a
 * estourar a tela inteira por uma config opcional).
 */
export async function fetchFollowupInterval(
  painterId: string
): Promise<number> {
  if (!painterId) return 12;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('followup_interval_months')
    .eq('id', painterId)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('fetchFollowupInterval failed:', error.message);
    return 12;
  }
  const v = (data as { followup_interval_months?: number | null } | null)
    ?.followup_interval_months;
  return typeof v === 'number' && v > 0 ? v : 12;
}

/**
 * Persiste o intervalo no perfil. Clampa em 1..120 (mesmo range do vanilla
 * pra evitar valores absurdos). Estoura NetworkError em falha — caller decide
 * UX (toast vermelho, manter input com valor antigo).
 */
export async function saveFollowupInterval(
  painterId: string,
  months: number
): Promise<void> {
  if (!painterId) throw new ValidationError('Pintor inválido.');
  let v = Math.floor(Number(months));
  if (!Number.isFinite(v) || v < 1) v = 1;
  if (v > 120) v = 120;
  const sb = getSupabase();
  const { error } = await sb
    .from('profiles')
    .update({ followup_interval_months: v })
    .eq('id', painterId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

/**
 * Chama o endpoint vanilla `/api/crm-draft` (IA) pra gerar a mensagem de
 * reativação. Backend espera `{ clientName, lastService, monthsSince,
 * painterName }` e devolve `{ draft: string }` em sucesso, `{ error: string }`
 * em falha — espelha o pattern de `optimizeDayOrder`.
 *
 * Validações antes do fetch evitam round-trip desnecessário:
 *   - clientName não vazio.
 *   - monthsAgo >= 0 (clamp).
 *
 * Erros tratados:
 *   - rede caiu → NetworkError;
 *   - resposta não-ok → NetworkError com mensagem do backend (PRO/rate
 *     limit/IA não configurada);
 *   - resposta sem `draft` → NetworkError "resposta inválida".
 */
export async function generateDraftMessage(args: {
  painterName: string;
  clientName: string;
  monthsAgo: number;
  jobType: string;
}): Promise<CrmDraftResult> {
  const clientName = String(args.clientName || '').trim();
  if (!clientName) {
    throw new ValidationError('Nome do cliente vazio.', { field: 'clientName' });
  }

  // Backend faz clamp em 0..120, mas mandamos já normalizado pra que o
  // valor enviado bata com o que a UI mostra.
  const monthsSince = Math.max(
    0,
    Math.floor(Number(args.monthsAgo) || 0)
  );

  const payload = {
    clientName,
    lastService: String(args.jobType || ''),
    monthsSince,
    painterName: String(args.painterName || ''),
  };

  let res: Response;
  try {
    res = await fetch('/api/crm-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new NetworkError('Falha de rede ao gerar mensagem', e);
  }

  // Parse tolerante: tenta JSON mesmo em erro pra surfar a mensagem do
  // backend ("PRO necessário", "rate limit", "IA não configurada").
  let data: { draft?: unknown; error?: unknown } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // Sem JSON — segue pra erro genérico abaixo.
  }

  if (!res.ok) {
    const msg =
      typeof data.error === 'string' ? data.error : 'Erro ao gerar mensagem';
    throw new NetworkError(msg);
  }
  if (typeof data.draft !== 'string' || !data.draft) {
    throw new NetworkError('Resposta inválida do gerador de mensagem');
  }
  return { draft: data.draft };
}

/**
 * Registra um follow-up enviado (envia mensagem → grava o log). NÃO faz
 * o envio em si — quem dispara o WhatsApp/notificação é o caller (UI).
 * Esta função só persiste o histórico em `follow_ups`.
 *
 * REGRA DE OURO (espelha o vanilla): o sistema RASCUNHA, o pintor DISPARA.
 *
 * Estoura ValidationError se message vazia (não faz sentido logar follow-up
 * vazio) ou NetworkError em falha de banco.
 */
export async function saveFollowUp(input: SaveFollowUpInput): Promise<void> {
  if (!input.painter_id) {
    throw new ValidationError('Pintor inválido.');
  }
  const msg = String(input.message || '').trim();
  if (!msg) {
    throw new ValidationError('Mensagem vazia.', { field: 'message' });
  }

  const sb = getSupabase();
  // Schema atual de `follow_ups` (supabase_init.sql linha 766+) só tem:
  // id, quote_id, painter_id, scheduled_at, message, status, sent_at.
  // Não tem `crm_client_id` nem `channel` — gravamos só o que cabe pra
  // evitar 400. Channel/client_id ficam preservados na intenção do caller
  // (toast/notify), e o log mostra a mensagem + timestamp pro pintor.
  const { error } = await sb.from('follow_ups').insert({
    painter_id: input.painter_id,
    quote_id: input.quote_id ?? null,
    message: msg,
    status: 'sent',
    sent_at: new Date().toISOString(),
  });
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

/**
 * Helper utilitário: monta a URL `wa.me` a partir do telefone bruto +
 * mensagem. Normaliza telefone (só dígitos, prefixa `55` quando faltar).
 * Devolve null se o telefone não tem 10+ dígitos (sem como ligar via WA).
 *
 * Não vive em `utils.ts` porque é específico do contrato de envio do CRM.
 */
export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message: string
): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const e164 = digits.length <= 11 ? '55' + digits : digits;
  return `https://wa.me/${e164}?text=${encodeURIComponent(message)}`;
}
