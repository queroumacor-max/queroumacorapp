// app/api/whatsapp/send/route.ts — envio de mensagem via WhatsApp Cloud API.
//
// Quem pode chamar: SÓ admin (mesmo gate do /api/admin/users — token
// Supabase válido + email em ADMIN_EMAILS). Uso previsto: portal da loja
// avisando cliente/pintor (pedido pronto, orçamento, camiseta) pelo número
// oficial +55 11 95976-5031.
//
// Payload: { to, type?: 'text'|'template', body?, template?, languageCode?,
// components?, accessToken? } — ver lib/api/schemas/whatsapp-send.ts.
//
// Lembrete da janela de 24h da Meta: texto livre só entrega pra quem falou
// com o número nas últimas 24h; fora disso o Graph devolve 131047 e o
// service traduz pra 422 "use um template aprovado".

import { type NextRequest } from 'next/server';
import {
  checkRateLimit,
  getToken,
  jsonResponse,
  rateLimitResponse,
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import {
  isWhatsAppConfigured,
  persistWhatsAppMessage,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  vincularAbordagemAoLead,
  type TemplateComponent,
} from '@/lib/api/_services/whatsapp';
// A Evolution API foi APOSENTADA (2026-09-05) e as secrets EVOLUTION_* saíram
// do CF Pages. Só o normalizador de telefone sobrevive aqui: ele é o único que
// trata DDI estrangeiro corretamente (ver o comentário no fallback do wa_id).
import { normalizeWhatsAppTarget } from '@/lib/api/_services/whatsapp-evo';
import { whatsappSendSchema } from '@/lib/api/schemas/whatsapp-send';
import { logAuditEvent } from '@/lib/api/audit';
import { runAfterResponse } from '@/lib/api/env';

export const runtime = 'edge';

// ORÇAMENTO TOTAL da rota. Cada hop já tinha o seu timeout (auth 10s, rate
// limit 10s, envio, gravação 8s, audit 5s), mas ninguém somava: bastava um
// hop lento pra passar da linha em que o Cloudflare mata a function do edge,
// e aí quem chega na tela é a página "502 Bad gateway" do PRÓPRIO CF — HTML
// cru, sem dizer nada — em vez do nosso JSON. Foi o que voltou em
// 2026-08-31 na abordagem de lead. Este teto garante que a resposta é
// SEMPRE nossa: se o trabalho não terminou, respondemos 500 explicando
// (500 e não 504 — ver deadlineResponse).
const ROUTE_DEADLINE_MS = 22000;

// Teto do que AINDA segura a resposta depois do envio: só o vínculo
// wamid → lead (ver abaixo). Gravar a mensagem e o audit saíram do caminho
// da resposta em 2026-09-13 (`runAfterResponse`): o cliente já recebeu, e
// segurar a tela do operador por escrituração era o que criava o 502 em
// envio que deu certo — e, mesmo sem 502, custava até 6s de "Enviando…".
const BOOKKEEPING_BUDGET_MS = 3000;

/**
 * Resposta honesta quando o orçamento acaba: a mensagem PODE ter saído.
 *
 * 500, não 504: o Cloudflare substitui o corpo de 502/504 pela página de
 * erro DELE, e este texto — que é a única coisa que diz ao operador pra
 * conferir a conversa antes de reenviar — nunca chegaria na tela. Era o
 * mesmo problema que a página "502 Bad gateway" já tinha criado aqui.
 */
function deadlineResponse() {
  return jsonResponse(
    {
      error:
        'o envio passou de 22s e foi interrompido pra não morrer no gateway. A mensagem PODE ter saído — confira a conversa em /admin/whatsapp antes de mandar de novo.',
    },
    500
  );
}

export async function POST(request: NextRequest) {
  const deadline = new Promise<Response>((resolve) =>
    setTimeout(() => resolve(deadlineResponse()), ROUTE_DEADLINE_MS)
  );
  return Promise.race([handle(request), deadline]);
}

async function handle(request: NextRequest): Promise<Response> {
  // CANAL ÚNICO desde 2026-09-05: Dualhook (Cloud API). A Evolution API foi
  // aposentada e suas secrets saíram do CF Pages — enquanto o despacho ainda
  // caía nela, todo envio de texto ia pra um servidor morto e voltava 502.
  if (!isWhatsAppConfigured()) {
    return jsonResponse(
      { error: 'Envio de WhatsApp não configurado (DUALHOOK_API_KEY ausente)' },
      503
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await readBody(request, { maxBytes: 256 * 1024 })) as Record<string, unknown>;
  } catch (e) {
    // REDE DE SEGURANÇA: nada sai desta rota como 502 ou 504. O Cloudflare
    // substitui o corpo dessas duas pela página de erro DELE, e o motivo real
    // — credencial, janela de 24h, número inválido — nunca chega na tela; o
    // operador vê "502 Bad gateway" e fica sem saber o que fazer. O service
    // já mapeia os casos que conhece; isto cobre qualquer ServiceError que
    // venha de outra camada (auth, rate limit, futuro) com esses status.
    if (e instanceof ServiceError) {
      if (e.status === 502 || e.status === 504) {
        console.error('whatsapp_send_upstream_failed', {
          status: e.status,
          message: e.message,
        });
        return jsonResponse(
          { error: e.message, upstreamStatus: e.status, ...(e.extra || {}) },
          500
        );
      }
      return serviceErrorResponse(e);
    }
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  try {
    const token = getToken(request, body);
    const { callerId, email } = await verifyAdminToken(token);
    if (!callerId) throw new ServiceError('token inválido', 401);
    await ensurePortalAdmin({ callerId, email });

    const rl = await checkRateLimit({
      userId: callerId || email,
      endpoint: 'whatsapp-send',
      limit: 30,
    });
    if (!rl.allowed) return rateLimitResponse(rl);

    const parsed = whatsappSendSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(
        { error: 'payload inválido', issues: parsed.error.issues },
        400
      );
    }
    const input = parsed.data;

    // Sem despacho: texto e template vão pelo MESMO canal (Dualhook).
    const channel = 'meta' as const;
    const result: { messageId: string; waId: string } =
      input.type === 'template'
        ? await sendWhatsAppTemplate({
            to: input.to,
            template: input.template as string,
            languageCode: input.languageCode,
            components: input.components as TemplateComponent[] | undefined,
          })
        : await sendWhatsAppText({ to: input.to, body: input.body as string });

    // SQL Wave 38: histórico da conversa em `whatsapp_messages` + trilha no
    // audit_log. Os dois são best-effort — a mensagem JÁ SAIU, escrituração
    // não pode custar o sucesso da resposta. "Não pode custar" agora é
    // código e não só comentário: em série e sem teto, eles somavam até 13s
    // DEPOIS do envio dentro do mesmo orçamento do edge, e era assim que um
    // envio bem-sucedido ainda terminava na página 502 do Cloudflare — com
    // a mensagem já entregue ao cliente e o operador achando que falhou.
    // Agora correm em paralelo e com teto próprio.
    // Abordagem de lead (2026-09-09): amarra o wamid ao lead ANTES de
    // responder. É por esse vínculo que o `sent`/`failed` do webhook acha o
    // lead — e o webhook pode chegar segundos depois desta resposta, então o
    // vínculo não pode ficar por conta do portal. NÃO marca `contactado`:
    // só a confirmação da Meta faz isso. Único item que ainda segura a
    // resposta, e com teto próprio.
    if (input.leadId) {
      await Promise.race([
        vincularAbordagemAoLead({ leadId: input.leadId, messageId: result.messageId }).catch((e) => {
          console.error('whatsapp_send_vinculo_falhou', e instanceof Error ? e.message : e);
          return false;
        }),
        new Promise((r) => setTimeout(r, BOOKKEEPING_BUDGET_MS)),
      ]);
    }

    // Histórico (Wave 38) + trilha no audit_log: DEPOIS da resposta
    // (`ctx.waitUntil`). Os dois são best-effort — a mensagem JÁ SAIU e a
    // escrituração não pode custar o sucesso. O portal mostra a mensagem
    // pelo eco local e recebe a linha real pelo realtime assim que ela for
    // gravada, segundos depois; nada depende de ela existir antes do 200.
    runAfterResponse(
      Promise.allSettled([
        persistWhatsAppMessage({
          direction: 'out',
          // `normalizeWhatsAppTarget` e não `normalizeBrPhone`: só ele
          // respeita DDI estrangeiro. Com o normalizador BR, resposta pra
          // número dos EUA era gravada na conversa errada.
          waId: result.waId || normalizeWhatsAppTarget(input.to) || input.to,
          messageId: result.messageId,
          type: input.type,
          body: input.body,
          template: input.template,
          sentBy: callerId,
          origin: 'portal',
        }),
        // Sem o corpo completo no `changes` — só o preview — pra não acumular
        // conversa de cliente no audit_log (LGPD data minimization).
        logAuditEvent({
          actorId: callerId,
          action: 'whatsapp.send',
          targetTable: null,
          targetId: result.waId || null,
          changes: {
            type: input.type,
            channel,
            template: input.template || null,
            bodyPreview: (input.body || '').slice(0, 80),
            messageId: result.messageId,
            leadId: input.leadId || null,
          },
          request,
        }),
      ])
    );

    return jsonResponse({
      ok: true,
      messageId: result.messageId,
      waId: result.waId,
      channel,
    });
  } catch (e) {
    // REDE DE SEGURANÇA: nada sai desta rota como 502 ou 504. O Cloudflare
    // substitui o corpo dessas duas pela página de erro DELE, e o motivo real
    // — credencial, janela de 24h, número inválido — nunca chega na tela; o
    // operador vê "502 Bad gateway" e fica sem saber o que fazer. O service
    // já mapeia os casos que conhece; isto cobre qualquer ServiceError que
    // venha de outra camada (auth, rate limit, futuro) com esses status.
    if (e instanceof ServiceError) {
      if (e.status === 502 || e.status === 504) {
        console.error('whatsapp_send_upstream_failed', {
          status: e.status,
          message: e.message,
        });
        return jsonResponse(
          { error: e.message, upstreamStatus: e.status, ...(e.extra || {}) },
          500
        );
      }
      return serviceErrorResponse(e);
    }
    console.error('whatsapp-send erro inesperado:', e instanceof Error ? e.message : e);
    return jsonResponse({ error: 'erro interno' }, 500);
  }
}
