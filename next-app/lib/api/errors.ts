// lib/api/errors.ts — R-H11: helper genérico de error-response sem leak.
//
// Problema que resolve: rotas faziam
//     catch (e) {
//       return NextResponse.json({
//         error: String(e instanceof Error ? e.message : e).slice(0, 200)
//       }, { status: 500 });
//     }
// — message de Error frequentemente contém hostname interno, path, query SQL,
// nome de tabela, prefixo de service-role. Vaza superfície pra atacante.
//
// Este helper:
//   1. Encaminha a exception detalhada pro Sentry (com tags opcionais).
//   2. Devolve mensagem amigável SEM detalhes ao cliente.
//   3. Em dev/preview/test inclui `dev_detail` pra DX local.
//   4. Resiliente — falha de Sentry NÃO impede a resposta.
//
// Uso típico:
//     } catch (e) {
//       return errorResponse(e, {
//         status: 500,
//         clientMessage: 'Erro interno — tente de novo',
//         tags: { route: 'mp-checkout-loja' },
//       });
//     }
//
// IMPORTANTE: NÃO usar pra ServiceError (use `serviceErrorResponse`) nem pra
// erros de validação (use mensagem específica). Este helper é o fallback
// genérico do último `catch` do handler.

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export interface ErrorResponseOpts {
  /** HTTP status code (default 500). */
  status?: number;
  /** Mensagem amigável ao cliente (default 'erro interno'). */
  clientMessage?: string;
  /** Tags adicionais pra agrupamento no Sentry. */
  tags?: Record<string, string>;
}

/**
 * Resposta genérica de erro sem leak de internal info. Manda exception
 * detalhada pro Sentry e retorna mensagem amigável pro cliente.
 *
 * Em dev/test inclui `dev_detail` pra DX (NUNCA em produção).
 */
export function errorResponse(
  e: unknown,
  opts: ErrorResponseOpts = {},
): NextResponse {
  const status = opts.status ?? 500;
  const clientMessage = opts.clientMessage ?? 'erro interno';

  // Sentry fail-safe: try/catch garante que falha do Sentry (ex.: DSN
  // inválido, init não rodou em edge runtime) NÃO bloqueie a resposta.
  try {
    Sentry.captureException(e, { tags: opts.tags });
  } catch {
    /* silent — não bloqueia resposta se Sentry falhar */
  }

  if (process.env.NODE_ENV !== 'production' && e instanceof Error) {
    return NextResponse.json(
      { error: clientMessage, dev_detail: e.message },
      { status },
    );
  }
  return NextResponse.json({ error: clientMessage }, { status });
}
