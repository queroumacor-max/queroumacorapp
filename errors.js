// errors.js — hierarquia de erros customizados pra padronizar o que sobe
// nas camadas (frontend e endpoints). Sem deps. Tudo pendurado em
// window.AppErrors. Cada subclasse fixa um par (code, status) padrão pra
// que o caller não tenha que repetir essa decisão em cada throw.
(function(){
  'use strict';

  // Classe base: Error "honesto" que carrega contexto extra (code, status,
  // details, cause) sem perder a stack. Subclasses só ajustam defaults e
  // o name — toda a maquinaria fica aqui pra evitar drift entre elas.
  class AppError extends Error {
    constructor(message, opts){
      const o = opts || {};
      super(message || 'Erro na aplicação');
      this.name = 'AppError';
      // Defaults conservadores: 500 é o "não sei" do HTTP; code genérico
      // deixa o caller pintar UI mesmo sem subclasse específica.
      this.code = o.code || 'app_error';
      this.status = typeof o.status === 'number' ? o.status : 500;
      this.details = (o.details === undefined) ? null : o.details;
      // 'cause' em prop própria pra não depender de runtime que preserve
      // a opção { cause } no super() (ES2022).
      this.cause = o.cause || null;
      // Stack limpa no V8 (Chrome/Node). Em outros engines é no-op.
      if(typeof Error.captureStackTrace === 'function'){
        Error.captureStackTrace(this, this.constructor);
      }
    }
  }

  // 400 — payload inválido. 'details' carrega qual campo falhou
  // (ex.: { field:'email', reason:'formato' }) pra o front pintar.
  class ValidationError extends AppError {
    constructor(message, details){
      super(message || 'Dados inválidos', { code:'validation_error', status:400, details:details });
      this.name = 'ValidationError';
    }
  }

  // 403 — autenticado mas sem permissão. Separado de Authentication pra o
  // front decidir entre redirect pro login e tela de "acesso negado".
  class AuthorizationError extends AppError {
    constructor(message){
      super(message || 'Acesso negado', { code:'authorization_error', status:403 });
      this.name = 'AuthorizationError';
    }
  }

  // 401 — não autenticado / sessão expirada. Triggera redirect pro login.
  class AuthenticationError extends AppError {
    constructor(message){
      super(message || 'Faça login para continuar', { code:'authentication_error', status:401 });
      this.name = 'AuthenticationError';
    }
  }

  // 404 — recurso ausente. Recebe o nome do recurso pra montar mensagem
  // em PT sem o caller precisar interpolar.
  class NotFoundError extends AppError {
    constructor(resource){
      const r = resource || 'Recurso';
      super(r + ' não encontrado', { code:'not_found', status:404, details:{ resource:r } });
      this.name = 'NotFoundError';
    }
  }

  // 429 — rate limit. retryAfter (segundos) em details pra o front mostrar
  // countdown ou o servidor preencher header Retry-After.
  class RateLimitError extends AppError {
    constructor(retryAfter){
      super('Muitas tentativas', { code:'rate_limit', status:429, details:{ retryAfter: retryAfter || null } });
      this.name = 'RateLimitError';
    }
  }

  // 409 — conflito de estado (ex.: handle já existe, duplicate key).
  class ConflictError extends AppError {
    constructor(message){
      super(message || 'Conflito de estado', { code:'conflict', status:409 });
      this.name = 'ConflictError';
    }
  }

  // 500 — config faltando (env var, chave de API). Diferencia "bug nosso
  // de deploy" de "erro de runtime/rede".
  class ConfigError extends AppError {
    constructor(message){
      super(message || 'Configuração inválida', { code:'config_error', status:500 });
      this.name = 'ConfigError';
    }
  }

  // 502 — falha numa chamada upstream (fetch, Supabase, OpenAI). Mantém
  // o erro original em 'cause' pra log sem vazar pro cliente.
  class NetworkError extends AppError {
    constructor(message, cause){
      super(message || 'Falha de rede', { code:'network_error', status:502, cause:cause });
      this.name = 'NetworkError';
    }
  }

  // Type-guard. Em vez de `err instanceof AppError` espalhado, centralizar
  // facilita futuras trocas (ex.: erros vindo de outro realm/iframe).
  function isAppError(err){ return err instanceof AppError; }

  // Qualquer coisa que pode ser erro vira AppError. Útil em catch genérico
  // pra padronizar antes de logar/responder.
  function toAppError(err){
    if(isAppError(err)) return err;
    if(err instanceof Error) return new AppError(err.message, { cause:err });
    return new AppError(String(err == null ? 'Erro desconhecido' : err));
  }

  // Serializa pra resposta HTTP. NÃO inclui stack nem cause — log interno.
  // 'details' só vai se existir pra evitar { details:null } no JSON.
  function errorToJson(err){
    const e = toAppError(err);
    const out = { error: e.message, code: e.code, status: e.status };
    if(e.details != null) out.details = e.details;
    return out;
  }

  window.AppErrors = {
    AppError: AppError,
    ValidationError: ValidationError,
    AuthorizationError: AuthorizationError,
    AuthenticationError: AuthenticationError,
    NotFoundError: NotFoundError,
    RateLimitError: RateLimitError,
    ConflictError: ConflictError,
    ConfigError: ConfigError,
    NetworkError: NetworkError,
    isAppError: isAppError,
    toAppError: toAppError,
    errorToJson: errorToJson
  };
})();
