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
  const msg = err instanceof Error ? err.message : String(err);
  for (const { match, friendly } of PATTERNS) {
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
