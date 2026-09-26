// errors-friendly.ts — converte erros técnicos em mensagens PT-BR
// amigáveis ao usuário final. Usado em catches de hooks/services antes
// de mostrar pro usuário (via toast, modal, etc.).
//
// Por que não centralizar nas classes AppError de lib/errors.ts? Porque
// muitos erros chegam crus do Supabase/fetch/SDKs externos com `message`
// só em inglês e códigos opaque (`23505`, "JWT expired"). Esta camada é
// o adapter que reconhece esses padrões e devolve UX-ready copy.
//
// Quando NÃO casa nenhum pattern, retorna um GENERIC + envia o original
// pro Sentry (se carregado no window) — assim a gente não perde a
// observabilidade, mas o usuário não vê stack trace.

export interface FriendlyError {
  title: string;
  message: string;
  // Texto opcional pro botão de ação. O componente que renderiza decide
  // o que fazer no click (retry, abrir login, etc.).
  actionable?: string;
}

interface Pattern {
  // RegExp pra casos comuns; função pra casos que precisam de lógica
  // mais elaborada (ex.: olhar `err.code` em vez do `message`).
  match: RegExp | ((m: string) => boolean);
  friendly: FriendlyError;
}

// Ordem importa: o primeiro match vence. Patterns mais específicos vêm
// antes dos mais genéricos.
const PATTERNS: ReadonlyArray<Pattern> = [
  {
    match: /JWT expired|session.*expired|not authenticated/i,
    friendly: {
      title: 'Sessão expirada',
      message: 'Faça login novamente pra continuar.',
      actionable: 'Fazer login',
    },
  },
  {
    match: /rate limit|too many requests/i,
    friendly: {
      title: 'Muitas tentativas',
      message: 'Espere alguns segundos e tente de novo.',
    },
  },
  {
    match: /network|fetch failed|connection refused/i,
    friendly: {
      title: 'Sem conexão',
      message: 'Verifique sua internet e tente novamente.',
      actionable: 'Tentar de novo',
    },
  },
  {
    match: /payload too large|file too big/i,
    friendly: {
      title: 'Arquivo grande demais',
      message: 'Use uma imagem ou vídeo menor (até 50MB).',
    },
  },
  {
    match: /23505|duplicate key|unique constraint/i,
    friendly: {
      title: 'Já existe',
      message: 'Esse registro já foi criado antes.',
    },
  },
  {
    match: /23503|foreign key/i,
    friendly: {
      title: 'Item referenciado',
      message: 'Esse item está vinculado a outro e não pode ser removido.',
    },
  },
  {
    match: /pro.*required|insufficient.*pro/i,
    friendly: {
      title: 'Feature PRO',
      message:
        'Essa função é exclusiva pra assinantes PRO. Atualize seu plano pra desbloquear.',
      actionable: 'Virar PRO',
    },
  },
  {
    match: /admin.*only|admins/i,
    friendly: {
      title: 'Acesso restrito',
      message: 'Apenas administradores podem fazer isso.',
    },
  },
  {
    match: /insufficient.*points|saldo insuficiente/i,
    friendly: {
      title: 'Pontos insuficientes',
      message: 'Você precisa de mais pontos pra trocar por PRO.',
      actionable: 'Como ganhar pontos',
    },
  },
  {
    match: /timeout/i,
    friendly: {
      title: 'Tempo esgotado',
      message: 'O servidor demorou pra responder. Tente novamente.',
      actionable: 'Tentar de novo',
    },
  },
  // Pentest final (2026-09-18): a RLS de mensagem/curtida/comentário/post
  // passou a recusar quando há bloqueio mútuo ou e-mail não confirmado
  // (migrations/2026-09-18-final-pentest-hardening.sql) — antes disso só
  // o cliente filtrava, e o erro cru do Postgres nunca chegava aqui. A
  // mensagem fica DE PROPÓSITO vaga (não diz "você foi bloqueado" nem
  // "confirme seu e-mail") — confirmar bloqueio pro remetente é
  // exatamente o dado que a feature de bloqueio existe pra não vazar.
  {
    match: /row-level security|permission denied for/i,
    friendly: {
      title: 'Não foi possível concluir',
      message: 'Essa ação não pôde ser feita agora.',
    },
  },
];

// Mensagens de autenticação do GoTrue. Ficam FORA do PATTERNS principal
// porque "already registered" confirma pra quem não é dono que o e-mail tem
// conta (enumeração) — a resposta tem que ser a mesma do "deu certo".
const AUTH_PATTERNS: ReadonlyArray<Pattern> = [
  {
    match: /user already registered|already been registered|email.*already.*(registered|exists|in use)/i,
    friendly: {
      title: 'Não foi possível criar a conta',
      message: 'Se você já tem cadastro, faça login ou recupere a senha.',
    },
  },
  {
    match: /invalid login credentials|invalid grant/i,
    friendly: {
      title: 'E-mail ou senha incorretos',
      message: 'Confira os dados e tente de novo.',
    },
  },
  {
    match: /email not confirmed/i,
    friendly: {
      title: 'E-mail não confirmado',
      message: 'Abra o link que enviamos pro seu e-mail e tente de novo.',
    },
  },
  {
    match: /password should be|weak password|password.*(at least|characters)/i,
    friendly: {
      title: 'Senha fraca',
      message: 'Use uma senha mais forte (no mínimo 8 caracteres, com letras e números).',
    },
  },
  {
    match: /same password|different from the old password/i,
    friendly: {
      title: 'Senha repetida',
      message: 'A nova senha precisa ser diferente da atual.',
    },
  },
];

const GENERIC: FriendlyError = {
  title: 'Algo deu errado',
  message:
    'Tente novamente em alguns segundos. Se persistir, fale com o suporte pelo WhatsApp.',
  actionable: 'Tentar de novo',
};

// Type-guard pro shape do Sentry que esperamos no window. Mantém o
// acesso tipado sem precisar declarar um global ambient só pra isso.
interface SentryGlobal {
  Sentry?: { captureException: (e: unknown) => void };
}

export function toFriendlyError(err: unknown): FriendlyError {
  const msg = mensagemDe(err);
  for (const { match, friendly } of [...AUTH_PATTERNS, ...PATTERNS]) {
    const hit = typeof match === 'function' ? match(msg) : match.test(msg);
    if (hit) return friendly;
  }
  // Log original pra Sentry mas mostra amigável ao usuário. Acesso
  // defensivo: try/catch caso o captureException lance (raro mas SDK
  // mal carregado pode falhar).
  if (typeof window !== 'undefined') {
    const w = window as unknown as SentryGlobal;
    try {
      w.Sentry?.captureException(err);
    } catch {
      // silencioso — não cascateamos erro de telemetria pra UX.
    }
  }
  return GENERIC;
}

// Exporta pra testes / casos onde o caller quer ramificar no genérico.
export const GENERIC_FRIENDLY_ERROR: FriendlyError = GENERIC;

// ─── Mensagem crua do backend → texto seguro ────────────────────────────
//
// Auditoria 2026-09-26 (H1): ~60 telas mostravam `error.message` cru do
// Postgres/PostgREST/GoTrue ("new row violates row-level security policy
// for table messages", nome de coluna, de policy, "User already
// registered"). Em vez de embrulhar cada tela, as classes de lib/errors.ts
// passam a trocar a mensagem VISÍVEL por esta — a crua segue em `raw`/
// `cause` pro log (reportFailure anexa "| causa: …").
//
// Só troca o que tem cara de erro técnico de backend. Mensagem que o nosso
// código escreveu em português ("Obra não encontrada ou sem permissão.") ou
// RAISE EXCEPTION em português de trigger é texto de produto e passa
// intacta — virar genérico ali pioraria a tela sem ganho de segurança.
const RAW_BACKEND =
  /row-level security|permission denied|violates|duplicate key|unique constraint|foreign key|null value in column|value too long|invalid input (syntax|value)|syntax error|relation "|column "|does not exist|schema cache|could not find the|JWT|PGRST\d|SQLSTATE|statement timeout|canceling statement|failed to fetch|fetch failed|load failed|networkerror|connection refused|rate limit|too many requests|user already registered|already been registered|invalid login credentials|email not confirmed|invalid api key|invalid grant|payload too large|new row for relation/i;

function mensagemDe(err: unknown): string {
  if (err instanceof Error) {
    // AppError guarda a crua em `raw` — casar pelo texto original, não pelo
    // já traduzido.
    const raw = (err as { raw?: unknown }).raw;
    return typeof raw === 'string' && raw ? raw : err.message;
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return String(err);
}

/** A mensagem tem cara de erro técnico do backend (não deve ir pra tela)? */
export function looksLikeRawBackendError(msg: string | null | undefined): boolean {
  return !!msg && RAW_BACKEND.test(msg);
}

/** Texto único (título + mensagem) pronto pra toast/faixa. Não manda pro Sentry. */
export function friendlyText(raw: string): string {
  for (const { match, friendly } of [...AUTH_PATTERNS, ...PATTERNS]) {
    const hit = typeof match === 'function' ? match(raw) : match.test(raw);
    if (hit) return `${friendly.title}. ${friendly.message}`;
  }
  return `${GENERIC.title}. ${GENERIC.message}`;
}

/**
 * Texto seguro pra exibir a partir de QUALQUER erro: se a mensagem é crua
 * de backend, traduz; se é texto nosso, devolve como está. Use em tela que
 * mostra erro de chamada direta ao Supabase (sem passar pelas classes).
 */
export function safeErrorMessage(err: unknown, fallback = 'Algo deu errado. Tente de novo.'): string {
  const msg = mensagemDe(err);
  if (!msg) return fallback;
  return looksLikeRawBackendError(msg) ? friendlyText(msg) : msg;
}
