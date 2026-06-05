// signup.ts — server-callable helpers do fluxo de signup.
//
// Cadastro AGORA é invite-only via link de indicação. Não existe mais código
// manual (QUC-XXXXX). O caller (SignupFlow) só chama signUp() quando o
// referrerId está presente no localStorage (capturado pelo ReferralCapture).
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
  /** Campos opcionais que vão pra profiles via UPDATE depois do signup
   *  (a trigger handle_new_user só popula a partir de user_metadata, e
   *  esses campos não fazem parte do JWT — UPDATE pós-trigger é mais
   *  flexível pra evoluir sem mexer no banco). */
  birthDate?: string | null;
  city?: string | null;
  state?: string | null;
  /** Avatar pré-uploadado (URL pública) — caller pode subir antes via
   *  uploadAvatar e passar a URL aqui pro UPDATE final. */
  avatarUrl?: string | null;
  /** Referrer (?ref=<userId> capturado pelo ReferralCapture). OBRIGATÓRIO
   *  no fluxo novo de invite-only. Cria linha em `referrals`
   *  (status=completed, bonus_points=1) + seta profiles.invited_by.
   *  Quando vazio/igual ao próprio user, ignorado e cadastro falha
   *  (caller deve validar antes — bloqueia o submit).
   */
  referrerId?: string;
}

export interface SignupResult {
  userId: string;
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
 * Cria a conta no Supabase Auth (`auth.signUp`) com metadados que a trigger
 * `handle_new_user` consome pra popular `profiles`. Antes do signUp re-checa
 * a tag pra mitigar TOCTOU (alguém pegou a tag entre o check do step 2 e o
 * submit do step 3).
 *
 * Pós-signup, se houver referrerId válido, grava em `profiles.invited_by` E
 * insere linha em `referrals` (trigger no banco credita 1 pt no referrer).
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

  // UPDATE pós-trigger: campos que não foram populados pela trigger
  // handle_new_user (birth_date, city, state, avatar_url, invited_by).
  // Best-effort — falhar não invalida a conta criada.
  const extras: {
    birth_date?: string | null;
    city?: string | null;
    state?: string | null;
    avatar_url?: string | null;
    invited_by?: string | null;
  } = {};
  if (input.birthDate) extras.birth_date = input.birthDate;
  if (input.city) extras.city = input.city;
  if (input.state) extras.state = input.state.toUpperCase();
  if (input.avatarUrl) extras.avatar_url = input.avatarUrl;
  if (input.referrerId && input.referrerId !== data.user.id) {
    extras.invited_by = input.referrerId;
  }
  if (Object.keys(extras).length > 0) {
    try {
      await sb.from('profiles').update(extras).eq('id', data.user.id);
    } catch {
      /* silent — conta já existe, user edita depois */
    }
  }

  // Registra a indicação em `referrals` — trigger no banco credita 1 pt
  // pro referrer. Best-effort: falhar não bloqueia o cadastro (a conta
  // já foi criada e invited_by já foi gravado no profile como backup).
  if (input.referrerId && input.referrerId !== data.user.id) {
    try {
      const sbAny = sb as unknown as {
        from: (t: string) => {
          insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      };
      await sbAny.from('referrals').insert({
        referrer_id: input.referrerId,
        referred_id: data.user.id,
        status: 'completed',
        bonus_points: 1,
      });
    } catch {
      /* silent — perfil já tem invited_by, admin pode reconciliar */
    }
  }

  return { userId: data.user.id };
}
