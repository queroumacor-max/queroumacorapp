// errors.ts — port de /errors.js para TS estrito.
// Hierarquia de erros customizados pra padronizar o que sobe nas camadas
// (server actions, route handlers, RSC). Cada subclasse fixa um par
// (code, status) padrão pra que o caller não tenha que repetir essa
// decisão em cada throw.
//
// Auditoria 2026-09-26 (H1): services fazem `throw new NetworkError(
// error.message, error)` e ~60 telas mostram `err.message` direto. Pra
// não vazar texto cru do Postgres/GoTrue ("violates row-level security
// policy for table messages", "User already registered"), o construtor
// troca a mensagem VISÍVEL pelo texto amigável quando ela tem cara de
// erro técnico de backend. A crua fica em `raw` e em `cause` (log /
// reportFailure). Checagem de lógica nunca deve olhar `.message` de um
// AppError — use o `code` do erro do Supabase ANTES de embrulhar.

import { friendlyText, looksLikeRawBackendError } from './errors-friendly';

export interface AppErrorOptions {
  code?: string;
  status?: number;
  details?: unknown;
  cause?: unknown;
}

// Classe base: Error "honesto" que carrega contexto extra (code, status,
// details, cause) sem perder a stack. Subclasses só ajustam defaults e o
// name — toda a maquinaria fica aqui pra evitar drift entre elas.
export class AppError extends Error {
  code: string;
  status: number;
  details: unknown;
  // ES2022 Error.cause já existe na superclasse, mas mantemos prop própria
  // pra alinhar com o vanilla e blindar runtimes que não preservam o option.
  override cause: unknown;
  // Mensagem original quando ela foi trocada por texto amigável (null se
  // a mensagem visível já é a original). Só pra log — nunca pra tela.
  raw: string | null;

  constructor(message?: string, opts: AppErrorOptions = {}) {
    const cru = looksLikeRawBackendError(message) ? (message as string) : null;
    const visivel = cru ? friendlyText(cru) : message;
    // Sem `cause` explícito, a crua vira a causa — é o que o reportFailure
    // anexa ("| causa: …") e o que chega no /admin/errors.
    const causa = opts.cause ?? (cru ? new Error(cru) : undefined);
    super(visivel || 'Erro na aplicação', { cause: causa });
    this.name = 'AppError';
    this.code = opts.code || 'app_error';
    this.status = typeof opts.status === 'number' ? opts.status : 500;
    this.details = opts.details === undefined ? null : opts.details;
    this.cause = causa ?? null;
    this.raw = cru;
    // Stack limpa no V8 (Node 18+). Em outros engines é no-op.
    // O 2o argumento de captureStackTrace é o construtor a partir do qual a
    // stack é cortada — tipado explicitamente porque o lint recusa `Function`.
    type StackFrameCtor = new (...args: never[]) => unknown;
    if (typeof (Error as unknown as { captureStackTrace?: unknown }).captureStackTrace === 'function') {
      (
        Error as unknown as { captureStackTrace: (t: object, c: StackFrameCtor) => void }
      ).captureStackTrace(this, this.constructor as unknown as StackFrameCtor);
    }
  }
}

// 400 — payload inválido. `details` carrega qual campo falhou
// (ex.: { field:'email', reason:'formato' }) pra o front pintar.
export class ValidationError extends AppError {
  constructor(message?: string, details?: unknown) {
    super(message || 'Dados inválidos', {
      code: 'validation_error',
      status: 400,
      details,
    });
    this.name = 'ValidationError';
  }
}

// 403 — autenticado mas sem permissão. Separado de Authentication pra o
// front decidir entre redirect pro login e tela de "acesso negado".
export class AuthorizationError extends AppError {
  constructor(message?: string) {
    super(message || 'Acesso negado', {
      code: 'authorization_error',
      status: 403,
    });
    this.name = 'AuthorizationError';
  }
}

// 401 — não autenticado / sessão expirada. Triggera redirect pro login.
export class AuthenticationError extends AppError {
  constructor(message?: string) {
    super(message || 'Faça login para continuar', {
      code: 'authentication_error',
      status: 401,
    });
    this.name = 'AuthenticationError';
  }
}

// 404 — recurso ausente. Recebe o nome do recurso pra montar mensagem
// em PT sem o caller precisar interpolar.
export class NotFoundError extends AppError {
  constructor(resource?: string) {
    const r = resource || 'Recurso';
    super(`${r} não encontrado`, {
      code: 'not_found',
      status: 404,
      details: { resource: r },
    });
    this.name = 'NotFoundError';
  }
}

// 429 — rate limit. `retryAfter` (segundos) em details pra o front mostrar
// countdown ou o servidor preencher header Retry-After.
export class RateLimitError extends AppError {
  constructor(retryAfter?: number | null) {
    super('Muitas tentativas', {
      code: 'rate_limit',
      status: 429,
      details: { retryAfter: retryAfter ?? null },
    });
    this.name = 'RateLimitError';
  }
}

// 409 — conflito de estado (ex.: handle já existe, duplicate key).
export class ConflictError extends AppError {
  constructor(message?: string) {
    super(message || 'Conflito de estado', {
      code: 'conflict',
      status: 409,
    });
    this.name = 'ConflictError';
  }
}

// 500 — config faltando (env var, chave de API). Diferencia "bug nosso
// de deploy" de "erro de runtime/rede".
export class ConfigError extends AppError {
  constructor(message?: string) {
    super(message || 'Configuração inválida', {
      code: 'config_error',
      status: 500,
    });
    this.name = 'ConfigError';
  }
}

// 502 — falha numa chamada upstream (fetch, Supabase, OpenAI). Mantém
// o erro original em `cause` pra log sem vazar pro cliente.
export class NetworkError extends AppError {
  constructor(message?: string, cause?: unknown) {
    super(message || 'Falha de rede', {
      code: 'network_error',
      status: 502,
      cause,
    });
    this.name = 'NetworkError';
  }
}

// Type-guard. Em vez de `err instanceof AppError` espalhado, centralizar
// facilita futuras trocas (ex.: erros vindo de outro realm/iframe).
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

// Qualquer coisa que pode ser erro vira AppError. Útil em catch genérico
// pra padronizar antes de logar/responder.
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return new AppError(err.message, { cause: err });
  return new AppError(String(err == null ? 'Erro desconhecido' : err));
}

export interface ErrorJson {
  error: string;
  code: string;
  status: number;
  details?: unknown;
}

// Serializa pra resposta HTTP. NÃO inclui stack nem cause — log interno.
// `details` só vai se existir pra evitar `{ details: null }` no JSON.
export function errorToJson(err: unknown): ErrorJson {
  const e = toAppError(err);
  const out: ErrorJson = { error: e.message, code: e.code, status: e.status };
  if (e.details != null) out.details = e.details;
  return out;
}
