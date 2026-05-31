// STUB TEMPORÁRIO — foundation libs ainda não portadas pelo outro agent.
// Reexporta os schemas mínimos consumidos por LoginForm / SignupForm
// (emailSchema, passwordSchema). Substituir quando a versão definitiva chegar.
import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email obrigatório')
  .email('Email inválido');

// Frontend só valida "preenchida" pra login (a regra de força é só no signup).
export const passwordSchema = z.string().min(1, 'Senha obrigatória');

// Versão estrita para signup / mudança de senha (≥ 8 chars como `auth-pw.js`).
export const strongPasswordSchema = z
  .string()
  .min(8, 'A senha deve ter ao menos 8 caracteres');
