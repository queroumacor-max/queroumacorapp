// Teste grátis das ferramentas de IA (decisão do usuário, 2026-10-25).
//
// Regra: o que chama IA é PRO. Quem não é PRO ganha um gostinho, contado
// no SERVIDOR (`claim_ai_trial`, migration 2026-10-25-billing-pro-and-ai-
// trial.sql) — reinstalar o app não dá outra chance:
//   - cada ferramenta: 1 uso, pra sempre;
//   - Seu Zé, Fê e Senna (chat): 3 mensagens no total, porque uma
//     mensagem só não dá pra testar um chat.
// A Alice (cliente) não passa por aqui: ela não é PRO e tem o próprio
// limite diário (ALICE_DAILY_LIMIT na rota).
//
// A chave é o `endpoint` que a rota já passa pro `gateProAI`. Rota que
// não pode ter teste (diagnóstico de admin) fica de fora com `null`.

export interface AiTrialRule {
  /** Chave gravada em ai_trial_usage.feature. */
  key: string;
  /** Usos grátis. */
  limit: number;
  /** true = renova todo mês; false = pra sempre. */
  monthly: boolean;
}

const CHATS = new Set(['chat-ai', 'fe', 'senna']);
const SEM_TESTE = new Set(['ig-art-diag']);

export const AI_TRIAL_USOS_FERRAMENTA = 1;
export const AI_TRIAL_USOS_CHAT = 3;

export function regraDeTeste(endpoint: string): AiTrialRule | null {
  const key = String(endpoint || '').trim();
  if (!key || SEM_TESTE.has(key)) return null;
  return {
    key,
    limit: CHATS.has(key) ? AI_TRIAL_USOS_CHAT : AI_TRIAL_USOS_FERRAMENTA,
    monthly: false,
  };
}

/** Código que o cliente usa pra abrir a tela de assinatura. */
export const PRO_REQUIRED_CODE = 'pro_required';
