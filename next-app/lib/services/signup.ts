// signup.ts — server-callable helpers que portam o fluxo de signup vanilla
// (modules/signup-flow.js + modules/signup-tag.js + modules/invite.js +
// head.js doRegisterSupabase) para um shape testável de TS.
//
// Diferenças vs vanilla:
//  - sem DOM (`document.getElementById`); o caller passa os campos já lidos
//    do form (react-hook-form);
//  - erros viram exceptions tipadas (ValidationError, ConflictError) em vez
//    de toast()+return silencioso;
//  - invite code segue o formato novo "QUC-XXXXX" gravado em `referrals`
//    (alinhado com generateInviteCode em modules/invite.js); a tabela
//    `invites` legada não é consultada aqui — referrals é a fonte de verdade
//    pós-SQL Wave 3.
//
// O trigger `handle_new_user` no Supabase cuida do INSERT em profiles a
// partir dos metadados (name, tag, phone, user_type). Não duplicamos isso
// aqui pra não competir com a trigger.
import { getSupabase } from '@/lib/supabase';
import { ConflictError, ValidationError } from '@/lib/errors';
import type { UserType } from '@/lib/types';

export interface SignupData {
  email: string;
  password: string;
  name: string;
  tag: string;
  phone: string;
  userType: UserType;
  inviteCode?: string;
}

export interface SignupResult {
  userId: string;
}

export interface InviteValidation {
  referrerId: string | null;
}

/**
 * Verifica se a @tag está disponível na view `profiles_public`.
 * Retorna `true` quando ninguém a usa, `false` caso contrário.
 * Não estoura — qualquer erro de rede vira `true` (fail-open, mesmo
 * comportamento do vanilla `checkTagAvailability` em signup-tag.js).
 */
export async function checkTagAvailability(tag: string): Promise<boolean> {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return false;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('profiles_public')
      .select('id')
      .eq('tag', normalized)
      .limit(1);
    if (error) return true; // fail-open
    return !data || data.length === 0;
  } catch {
    return true;
  }
}

/**
 * Valida invite code no formato `QUC-XXXXX` consultando a tabela `referrals`.
 * Retorna `{ referrerId }` quando o código é válido e ainda não foi consumido
 * (`referred_id IS NULL`). Caso o código não comece com `QUC-`, vazio, ou não
 * exista, devolve `{ referrerId: null }` — não estoura.
 */
export async function validateInviteCode(code: string): Promise<InviteValidation> {
  const normalized = (code || '').trim().toUpperCase();
  if (!normalized || !normalized.startsWith('QUC-')) {
    return { referrerId: null };
  }
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('referrals')
      .select('referrer_id')
      .eq('code', normalized)
      .is('referred_id', null)
      .limit(1);
    if (error) return { referrerId: null };
    const row = data?.[0] as { referrer_id?: string | null } | undefined;
    return { referrerId: row?.referrer_id ?? null };
  } catch {
    return { referrerId: null };
  }
}

/**
 * Cria a conta no Supabase Auth (`auth.signUp`) com metadados que a trigger
 * `handle_new_user` consome pra popular `profiles`. Antes do signUp re-checa
 * a tag pra mitigar TOCTOU (alguém pegou a tag entre o check do step 2 e o
 * submit do step 3). Se houver invite code válido, atualiza o registro em
 * `referrals` com o `referred_id` recém-criado.
 *
 * Throws:
 *  - ConflictError quando a tag já está em uso;
 *  - ValidationError em qualquer falha do Supabase Auth.
 */
export async function signUp(input: SignupData): Promise<SignupResult> {
  const sb = getSupabase();

  // Re-check da tag imediatamente antes do insert. Não 100% à prova de
  // TOCTOU, mas reduz a janela de corrida significativamente.
  const available = await checkTagAvailability(input.tag);
  if (!available) {
    throw new ConflictError('Essa @tag já está em uso.');
  }

  const { data, error } = await sb.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        name: input.name,
        tag: input.tag,
        phone: input.phone,
        user_type: input.userType,
      },
    },
  });

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data.user) {
    throw new ValidationError('Falha ao criar conta.');
  }

  if (input.inviteCode) {
    const { referrerId } = await validateInviteCode(input.inviteCode);
    if (referrerId) {
      try {
        await sb
          .from('referrals')
          .update({ referred_id: data.user.id })
          .eq('code', input.inviteCode.trim().toUpperCase());
      } catch {
        // Best-effort: a conta já foi criada; falhar no consume não deve
        // bloquear o usuário. Logging vai pelo logger no caller se quiser.
      }
    }
  }

  return { userId: data.user.id };
}
