// consent.ts — service layer pra `consent_log` (trilha LGPD de consentimento).
//
// Schema (migrations/2026-05-31-consent-audit-invites-cleanup.sql):
//   id uuid, user_id uuid, consent_type text CHECK (terms|privacy|marketing|cookies|data_processing),
//   consent_version text DEFAULT 'v1', consent_given boolean,
//   ip_address text, user_agent text, granted_at timestamptz, revoked_at timestamptz
//
// RLS: user lê/escreve só os próprios consentimentos (auth.uid() = user_id).
// Caller espera userId explícito — não inferimos de auth.getUser() pra deixar
// claro no chamador (signup form passa o id retornado do signUp).

import { getSupabase } from '@/lib/supabase';

export type ConsentType = 'terms' | 'privacy' | 'marketing' | 'cookies' | 'data_processing';

export interface RecordConsentOptions {
  userId: string;
  consentType: ConsentType;
  consentGiven: boolean;
  version?: string;
}

/**
 * Registra concessão (ou negação) de consentimento. Insere linha nova mesmo
 * se já existe outra ativa do mesmo tipo — o histórico é appendable e o
 * estado "ativo" é "tem linha sem revoked_at". Use revokeConsent() pra
 * marcar uma específica como revogada.
 */
export async function recordConsent(opts: RecordConsentOptions): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('consent_log').insert({
    user_id: opts.userId,
    consent_type: opts.consentType,
    consent_version: opts.version || 'v1',
    consent_given: opts.consentGiven,
  });
  if (error) throw new Error(error.message);
}

/**
 * Marca o consentimento ativo do (user, type) como revogado (revoked_at = now()).
 * Idempotente: se nada ativo, UPDATE não toca em linha — não estoura.
 */
export async function revokeConsent(userId: string, consentType: ConsentType): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from('consent_log')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('consent_type', consentType)
    .is('revoked_at', null);
  if (error) throw new Error(error.message);
}

/**
 * Lista consentimentos atualmente ativos (sem revoked_at) do usuário.
 * Usar pra render UI de privacidade ou checar antes de uma ação que precise
 * de consent específico (ex: marketing email).
 */
export async function getActiveConsents(userId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('consent_log')
    .select('consent_type, consent_version, granted_at')
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (error) throw new Error(error.message);
  return data ?? [];
}
