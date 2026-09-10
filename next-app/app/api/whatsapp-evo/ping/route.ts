// app/api/whatsapp-evo/ping/route.ts — diagnóstico da conexão edge →
// Evolution API. Admin-only. Existe porque o envio devolvia "502 Bad
// gateway" do PRÓPRIO Cloudflare (corpo capturado no portal), sem dizer
// se o problema era env ausente, apikey recusada, instância errada ou o
// upstream demorando — e o keep-alive provou que o Render está acordado.
//
// Cada etapa é medida e reportada em JSON, com timeout curto (8s) pra a
// function NUNCA morrer antes de responder. GET /api/whatsapp-evo/ping
// (com Authorization: Bearer <token do admin>).

import { type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/lib/api/env';
import {
  getToken,
  jsonResponse,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import { DEFAULT_EVOLUTION_INSTANCE } from '@/lib/api/_services/whatsapp-evo';

export const runtime = 'edge';

const PROBE_TIMEOUT_MS = 8000;

interface Probe {
  step: string;
  ok: boolean;
  status?: number;
  ms: number;
  detail?: string;
}

async function probe(step: string, url: string, headers: HeadersInit): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const body = (await r.text()).slice(0, 200);
    return { step, ok: r.ok, status: r.status, ms: Date.now() - t0, detail: body };
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'TimeoutError';
    return {
      step,
      ok: false,
      ms: Date.now() - t0,
      detail: timeout
        ? `timeout de ${PROBE_TIMEOUT_MS}ms (upstream não respondeu)`
        : `exceção: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = getToken(request, {});
    const { callerId, email } = await verifyAdminToken(token);
    if (!callerId) throw new ServiceError('token inválido', 401);
    await ensurePortalAdmin({ callerId, email });

    const rawUrl = getRuntimeEnv('EVOLUTION_API_URL') || '';
    const apiKey = getRuntimeEnv('EVOLUTION_API_KEY') || '';
    const instance = getRuntimeEnv('EVOLUTION_INSTANCE') || DEFAULT_EVOLUTION_INSTANCE;
    const baseUrl = rawUrl.replace(/\/+$/, '');

    // Diagnóstico de env SEM vazar segredo: só presença, tamanho e se veio
    // com espaço/quebra de linha colada (erro comum de copiar/colar).
    const env = {
      EVOLUTION_API_URL: rawUrl || '(ausente)',
      EVOLUTION_API_KEY_presente: Boolean(apiKey),
      EVOLUTION_API_KEY_tamanho: apiKey.length,
      EVOLUTION_API_KEY_com_espaco_ou_quebra: apiKey !== apiKey.trim(),
      EVOLUTION_INSTANCE: instance,
      EVOLUTION_WEBHOOK_TOKEN_presente: Boolean(getRuntimeEnv('EVOLUTION_WEBHOOK_TOKEN')),
    };

    if (!baseUrl || !apiKey) {
      return jsonResponse({
        ok: false,
        diagnostico: 'envs ausentes — cadastre no CF Pages e refaça o deploy',
        env,
      });
    }

    const authHeaders = { apikey: apiKey };
    const probes: Probe[] = [];
    // 1) O edge alcança o Render? (sem auth — só conectividade)
    probes.push(await probe('conectividade (GET base)', baseUrl, {}));
    // 2) A apikey é aceita? (lista de instâncias é o endpoint canônico)
    probes.push(
      await probe('auth (GET /instance/fetchInstances)', `${baseUrl}/instance/fetchInstances`, authHeaders),
    );
    // 3) A instância existe e está conectada?
    probes.push(
      await probe(
        `instância (GET /instance/connectionState/${instance})`,
        `${baseUrl}/instance/connectionState/${encodeURIComponent(instance)}`,
        authHeaders,
      ),
    );

    return jsonResponse({ ok: probes.every((p) => p.ok), env, probes });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse(
      { ok: false, erro: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
}
