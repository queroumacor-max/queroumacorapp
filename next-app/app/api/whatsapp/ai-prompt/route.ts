// app/api/whatsapp/ai-prompt/route.ts — o texto PADRÃO do prompt da IA.
//
// O portal edita o prompt (whatsapp_ai_config.prompt) e precisa mostrar o
// padrão pra pessoa partir dele e pra "Restaurar padrão". O padrão vive no
// código (`PROMPT_BASE_PADRAO`); copiá-lo no portal seria uma segunda cópia
// pra envelhecer. Admin-only, mesmo gate de `/api/whatsapp/templates`.
//
// Só GET e só leitura: quem GRAVA é o portal, direto na tabela, pela RLS
// `is_portal_admin()` — igual às outras chaves da whatsapp_ai_config.

import { type NextRequest } from 'next/server';
import {
  getToken,
  jsonResponse,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import { PROMPT_BASE_PADRAO } from '@/lib/api/_services/whatsapp-ai';

export const runtime = 'edge';

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
  return jsonResponse({ ok: true, padrao: PROMPT_BASE_PADRAO });
}
