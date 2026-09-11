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
import { calculateAge, MIN_AGE } from '@/lib/schemas';
import { reportFailure } from '@/lib/utils/reportFailure';
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
   *  (status=completed, bonus_points=10) + seta profiles.invited_by.
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

  // Age gate (defesa em profundidade — frontend já bloqueia via Zod).
  // LGPD-K + Apple 1.6 + Google Family Policy: hard block <MIN_AGE.
  if (input.birthDate) {
    const age = calculateAge(input.birthDate);
    if (age >= 0 && age < MIN_AGE) {
      throw new ValidationError(
        `Você precisa ter pelo menos ${MIN_AGE} anos para usar o app.`,
      );
    }
  }

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
        // city/state também no metadata: assim a trigger handle_new_user pode
        // gravá-los já no INSERT (SECURITY DEFINER, sem depender de sessão/RLS).
        // O UPDATE pós-signup abaixo segue como fallback. Corrige o bug de
        // "cidade em branco" quando o UPDATE roda sem sessão ativa.
        city: input.city ?? '',
        state: (input.state ?? '').toUpperCase(),
        birth_date: input.birthDate ?? '',
      },
    },
  });

  if (error) {
    throw new ValidationError(error.message);
  }
  if (!data.user) {
    throw new ValidationError('Falha ao criar conta.');
  }

  // UPDATE pós-trigger. Duas funções:
  //
  //  1. Campos que a trigger pode não ter populado (birth_date, city, state,
  //     avatar_url, invited_by).
  //  2. REAFIRMAR a identidade — name, @tag, categoria e telefone. Isso é
  //     defesa contra uma versão ANTIGA da `handle_new_user` viva no banco:
  //     a versão anterior a 18/06/2026 gravava só name/user_type/role, e o
  //     perfil nascia SEM @tag. Sem tag, o `isProfileComplete` diz
  //     "incompleto" e o AppShell manda a pessoa recém-cadastrada pro
  //     /completar-perfil, que pede de novo o que ela acabou de digitar —
  //     o "cadastro em duas etapas" relatado em 07/09/2026.
  //     Escrever o mesmo valor que a trigger já gravou é no-op; escrever o
  //     que faltou conserta. Não dá pra checar qual versão está viva daqui,
  //     e não é preciso: o UPDATE cobre as duas.
  //
  // Best-effort — falhar não invalida a conta criada (sem sessão, a RLS
  // recusa, e aí o /completar-perfil cumpre o papel de rede de segurança).
  const extras: {
    name?: string;
    tag?: string;
    user_type?: string;
    phone?: string;
    birth_date?: string | null;
    city?: string | null;
    state?: string | null;
    avatar_url?: string | null;
    invited_by?: string | null;
  } = {
    name: input.name,
    tag: input.tag.trim().toLowerCase(),
    user_type: input.userType,
  };
  if (input.phone) extras.phone = input.phone;
  if (input.birthDate) extras.birth_date = input.birthDate;
  if (input.city) extras.city = input.city;
  if (input.state) extras.state = input.state.toUpperCase();
  if (input.avatarUrl) extras.avatar_url = input.avatarUrl;
  if (input.referrerId && input.referrerId !== data.user.id) {
    extras.invited_by = input.referrerId;
  }
  try {
    // `.select('id')` porque UPDATE que não acha linha NÃO é erro: volta
    // sucesso com zero linhas. Era esse silêncio que escondia o caso abaixo.
    const { data: atingidas, error: upErr } = await sb
      .from('profiles')
      .update(extras as never)
      .eq('id', data.user.id)
      .select('id');

    if (!upErr && (!atingidas || atingidas.length === 0)) {
      // A LINHA DE PERFIL NÃO EXISTE. A trigger `handle_new_user` engole a
      // própria exceção com RAISE WARNING, então quando ela falha (um CHECK
      // recusando o user_type, por exemplo) a conta de auth nasce e o perfil
      // não — e daí TUDO que escreve no perfil vira no-op silencioso: o app
      // manda a pessoa pro /completar-perfil, ela preenche, o UPDATE não
      // acha linha nenhuma e a tela volta. O "cadastro em duas etapas" que
      // não acabava.
      //
      // A policy "Users can insert own profile" permite o dono criar a
      // própria linha, então criamos aqui.
      const { error: insErr } = await sb
        .from('profiles')
        .insert({ id: data.user.id, ...extras } as never);
      reportFailure(
        'profile-incomplete',
        insErr ?? new Error('perfil não existia após o signup; criado pelo app'),
        { userId: data.user.id, ctx: insErr ? 'signup/insert-falhou' : 'signup/insert-ok' },
      );
    }
  } catch {
    /* best-effort — a conta já existe e o /completar-perfil é a rede de segurança */
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
      // Só as duas identidades: `status`/`bonus_points` são decididos pelo
      // banco (trigger/default), nunca pelo cliente — mandar 1000 pontos
      // daqui era um `curl` (auditoria 2026-09-11).
      await sbAny.from('referrals').insert({
        referrer_id: input.referrerId,
        referred_id: data.user.id,
      });
    } catch {
      /* silent — perfil já tem invited_by, admin pode reconciliar */
    }
  }

  return { userId: data.user.id };
}
