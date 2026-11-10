// POST /api/pedidos-pintor — grava o pedido da página PÚBLICA /pedir
// (2026-11-10). Sem login: quem chega aqui veio de um grupo de moradores,
// do QR da loja ou de um anúncio.
//
// Defesas (rota aberta = alvo de spam):
//   - teto de corpo (16 KB) antes do parse;
//   - rate limit por IP (5/min);
//   - campo-isca `site`: gente não vê nem preenche; robô preenche → a rota
//     responde ok e NÃO grava (não ensina o robô a tentar de outro jeito);
//   - validação única em lib/pedidoPintor.ts (a mesma da tela);
//   - grava com service_role: a tabela não tem policy de INSERT.
// A resposta nunca devolve o que foi gravado (nada de eco de dado pessoal).

import { type NextRequest } from 'next/server';
import {
  enforceRateLimit,
  getServiceKey,
  getSupabaseUrl,
  jsonResponse,
  rejectOversizedBody,
} from '@/lib/api/security';
import { validarPedidoPintor } from '@/lib/pedidoPintor';

export const runtime = 'nodejs';

const MAX_BYTES = 16 * 1024;
const TIMEOUT_MS = 8000;

export async function POST(request: NextRequest) {
  const grande = rejectOversizedBody(request, MAX_BYTES);
  if (grande) return grande;
  const limitado = await enforceRateLimit(request, { endpoint: 'pedidos-pintor', limit: 5 });
  if (limitado) return limitado;

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return jsonResponse({ error: 'Pedido grande demais.' }, 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('formato');
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Pedido inválido.' }, 400);
  }

  if (typeof body.site === 'string' && body.site.trim() !== '') {
    return jsonResponse({ ok: true });
  }

  const r = validarPedidoPintor(body);
  if (!r.ok) return jsonResponse({ error: r.erro, campo: r.campo }, 400);

  const serviceKey = getServiceKey();
  let supaUrl = '';
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    /* tratado abaixo */
  }
  if (!serviceKey || !supaUrl) {
    return jsonResponse({ error: 'Serviço indisponível no momento. Tente de novo em instantes.' }, 503);
  }

  try {
    const res = await fetch(`${supaUrl.replace(/\/$/, '')}/rest/v1/pedidos_pintor`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(r.pedido),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      // Tabela ainda não criada (SQL pendente) também cai aqui: o log diz.
      console.error('pedidos_pintor_insert_failed', res.status, detalhe.slice(0, 300));
      return jsonResponse({ error: 'Não consegui registrar seu pedido agora. Tente de novo em instantes.' }, 503);
    }
  } catch (e) {
    console.error('pedidos_pintor_insert_error', e instanceof Error ? e.message : String(e));
    return jsonResponse({ error: 'Não consegui registrar seu pedido agora. Tente de novo em instantes.' }, 503);
  }

  return jsonResponse({ ok: true });
}
