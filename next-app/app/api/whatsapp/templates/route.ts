// app/api/whatsapp/templates/route.ts — lista os templates APROVADOS.
//
// Existe pra o portal parar de carregar uma lista escrita à mão. Lista à
// mão envelhece igual lista de pendência: alguém aprova um template novo no
// painel, ninguém mexe no código, e a tela segue oferecendo dois. Pior: se
// o nome mudar lá, o envio quebra com 132001 e a tela continua exibindo o
// nome velho como se estivesse certo.
//
// A rota do Graph é espelhada pelo Dualhook (confirmado: responde 401 com
// chave inválida, em vez de 404). Se ainda assim ela falhar, respondemos com
// o corpo cru no log e o portal cai na lista embutida — recurso novo não
// pode derrubar o que já funciona.
//
// AS FUNÇÕES PURAS VIVEM EM `lib/api/_services/whatsapp-templates.ts`, não
// aqui: arquivo de rota do Next só aceita um conjunto fechado de exports, e
// exportar um helper daqui quebra o build com "X is not a valid Route export
// field" — erro que NÃO aparece no `tsc` nem no vitest, só no `next build`.
//
// Admin-only, mesmo gate de `/api/whatsapp/send`: os nomes de template não
// são segredo, mas a chave usada pra buscá-los é.

import { type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/lib/api/env';
import {
  getToken,
  jsonResponse,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import {
  DUALHOOK_API_BASE,
  GRAPH_API_VERSION,
  getWabaId,
} from '@/lib/api/_services/whatsapp';
import {
  normalizarTemplate,
  type TemplateAprovado,
} from '@/lib/api/_services/whatsapp-templates';

export const runtime = 'edge';

const TIMEOUT_MS = 12000;
const CACHE_MS = 5 * 60 * 1000;

// Cache em memória do isolate. Template muda raramente (aprovação leva
// horas), e a tela é aberta o tempo todo — bater na Meta a cada abertura é
// latência e cota gastas à toa. O edge recicla isolates, então isto é um
// amortecedor, não uma garantia: no pior caso a chamada acontece de novo.
let cache: { em: number; templates: TemplateAprovado[] } | null = null;

export async function GET(request: NextRequest) {
  try {
    const token = getToken(request, {});
    const { callerId, email, emailConfirmed } = await verifyAdminToken(token);
    if (!callerId) throw new ServiceError('token inválido', 401);
    await ensurePortalAdmin({ callerId, email, emailConfirmed });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'não autorizado' }, 401);
  }

  if (cache && Date.now() - cache.em < CACHE_MS) {
    return jsonResponse({ ok: true, templates: cache.templates, cache: true });
  }

  const apiKey = getRuntimeEnv('DUALHOOK_API_KEY');
  if (!apiKey) {
    return jsonResponse(
      { error: 'envio de WhatsApp não configurado (DUALHOOK_API_KEY ausente)' },
      503
    );
  }

  const url =
    `${DUALHOOK_API_BASE}/${GRAPH_API_VERSION}/${getWabaId()}/message_templates` +
    `?fields=name,status,category,language,components&limit=100`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error('dualhook_templates_failed', { erro: e instanceof Error ? e.message : e });
    return jsonResponse(
      { error: 'não foi possível consultar os templates', upstreamStatus: 0 },
      500
    );
  }

  // Texto ANTES do parse: resposta não-JSON (proxy, HTML de erro) é
  // justamente o caso que precisa ser visto, e `res.json()` a engoliria.
  const cru = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('dualhook_templates_failed', { status: res.status, body: cru.slice(0, 500) });
    return jsonResponse(
      {
        error:
          `não foi possível listar os templates (HTTP ${res.status}). ` +
          'O portal está usando a lista embutida.',
        upstreamStatus: res.status,
      },
      res.status >= 400 && res.status < 500 ? 400 : 502
    );
  }

  let dados: { data?: unknown };
  try {
    dados = JSON.parse(cru) as { data?: unknown };
  } catch {
    console.error('dualhook_templates_failed', { status: res.status, body: cru.slice(0, 500) });
    return jsonResponse({ error: 'resposta de templates ilegível', upstreamStatus: res.status }, 502);
  }

  const lista = Array.isArray(dados.data) ? dados.data : [];
  const templates = lista
    .map(normalizarTemplate)
    .filter((t): t is TemplateAprovado => t !== null)
    // Só o que dá pra enviar. Template em rascunho, pausado ou reprovado
    // seria um botão na tela que sempre falha com 132001.
    .filter((t) => t.status.toUpperCase() === 'APPROVED');

  cache = { em: Date.now(), templates };
  return jsonResponse({ ok: true, templates });
}
