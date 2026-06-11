// schemas.ts — port dos 13 schemas vanilla (/schemas/*.js) para Zod nativo.
// Mantém o mesmo conjunto e a mesma validação (mesmos algoritmos de CPF/CNPJ,
// mesmas regras de tag/email/etc.). Diferença pro vanilla: aqui usamos a API
// nativa do Zod (`safeParse → { success, data, error }`) em vez do shape
// caseiro `{ ok, value, error: { code, message } }`. Os call sites do Next.js
// já consomem Zod direto (react-hook-form + @hookform/resolvers/zod), então
// padronizar nele evita o adapter layer.

import { z } from 'zod';

// ─── primitives ──────────────────────────────────────────────────────────────

export const emailSchema = z
  .string({ invalid_type_error: 'Email inválido' })
  .trim()
  .min(1, 'Informe o email')
  .email('Email inválido');

// Para login: só checa "preenchida" (regra de força só no signup).
export const passwordSchema = z
  .string({ invalid_type_error: 'Senha inválida' })
  .min(1, 'Senha obrigatória');

// Para signup / mudança: mínimo 8 chars (mesmo default do vanilla).
export const strongPasswordSchema = z
  .string({ invalid_type_error: 'Senha inválida' })
  .min(8, 'A senha deve ter ao menos 8 caracteres');

// Helper pra montar schema com min customizável (paridade com `password.parse(v, { min })`).
export function passwordWithMin(min: number) {
  return z
    .string({ invalid_type_error: 'Senha inválida' })
    .min(min, `A senha deve ter ao menos ${min} caracteres`);
}

// Pair (a, b) — checa se duas senhas batem. Usado em fluxos de signup
// e troca de senha onde o user confirma digitando duas vezes.
export const passwordsMatchSchema = z
  .object({ a: z.string(), b: z.string() })
  .refine((p) => p.a === p.b, { message: 'As senhas não coincidem', path: ['b'] });

// Required field genérico; o caller passa o label via `.describe(label)` ou
// usa a versão `requiredField(label)` abaixo pra mensagem em PT.
export const requiredSchema = z.string().trim().min(1, 'Campo obrigatório');
export function requiredField(label: string) {
  return z.string().trim().min(1, `Informe ${label}`);
}

// BRL: aceita "100", "1.500,50", "1500.50" → number. Reusa `parseBRL` de utils.ts
// pra garantir mesmo parsing dos inputs vanilla.
import { parseBRL } from './utils';

export const brlSchema = z.preprocess(
  (v) => {
    if (v == null || v === '') return undefined;
    const raw = String(v).trim();
    if (!raw) return undefined;
    return parseBRL(raw);
  },
  z
    .number({ required_error: 'Informe o valor', invalid_type_error: 'Valor inválido' })
    .finite('Valor inválido')
    .nonnegative('O valor não pode ser negativo')
);

export const areaSchema = z.preprocess(
  (v) => {
    if (v == null || v === '') return undefined;
    const raw = String(v).trim().replace(',', '.');
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  },
  z
    .number({ required_error: 'Informe a área em m²', invalid_type_error: 'Área inválida' })
    .positive('A área deve ser maior que zero')
);

// Telefone BR: normaliza pra dígitos puros com prefixo 55 (DDI Brasil).
// Aceita máscaras "(11) 95976-5031", "+55 11 95976-5031", "11959765031".
// Saída sempre é a string normalizada "5511959765031".
export const phoneSchema = z
  .string({ invalid_type_error: 'Telefone inválido' })
  .trim()
  .min(1, 'Informe o telefone')
  .transform((v, ctx) => {
    let d = v.replace(/\D+/g, '');
    if (!d) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido' });
      return z.NEVER;
    }
    if (d.length === 12 || d.length === 13) {
      if (d.slice(0, 2) !== '55') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido' });
        return z.NEVER;
      }
    } else if (d.length === 10 || d.length === 11) {
      d = '55' + d;
    } else {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido' });
      return z.NEVER;
    }
    if (d.slice(2, 4)[0] === '0') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DDD inválido' });
      return z.NEVER;
    }
    return d;
  });

export const cepSchema = z
  .string({ invalid_type_error: 'CEP inválido' })
  .trim()
  .min(1, 'Informe o CEP')
  .transform((v, ctx) => {
    const d = v.replace(/\D+/g, '');
    if (d.length !== 8) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CEP deve ter 8 dígitos' });
      return z.NEVER;
    }
    return d;
  });

// ─── documents (CPF / CNPJ) ──────────────────────────────────────────────────

// Algoritmo completo de DV — port literal de /schemas/documents.js.
export function isValidCPF(value: string): boolean {
  const d = value.replace(/\D+/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
  let dv1 = (sum * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== parseInt(d[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i], 10) * (11 - i);
  let dv2 = (sum * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  if (dv2 !== parseInt(d[10], 10)) return false;
  return true;
}

export function isValidCNPJ(value: string): boolean {
  const d = value.replace(/\D+/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(d[i], 10) * w1[i];
  let dv1 = sum % 11;
  dv1 = dv1 < 2 ? 0 : 11 - dv1;
  if (dv1 !== parseInt(d[12], 10)) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(d[i], 10) * w2[i];
  let dv2 = sum % 11;
  dv2 = dv2 < 2 ? 0 : 11 - dv2;
  if (dv2 !== parseInt(d[13], 10)) return false;
  return true;
}

// `cpf`/`cnpj` retornam string de dígitos limpos (sem máscara).
export const cpfSchema = z
  .string({ invalid_type_error: 'CPF inválido' })
  .trim()
  .min(1, 'Informe o CPF')
  .transform((v, ctx) => {
    const d = v.replace(/\D+/g, '');
    if (d.length !== 11) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CPF deve ter 11 dígitos' });
      return z.NEVER;
    }
    if (!isValidCPF(d)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CPF inválido' });
      return z.NEVER;
    }
    return d;
  });

export const cnpjSchema = z
  .string({ invalid_type_error: 'CNPJ inválido' })
  .trim()
  .min(1, 'Informe o CNPJ')
  .transform((v, ctx) => {
    const d = v.replace(/\D+/g, '');
    if (d.length !== 14) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CNPJ deve ter 14 dígitos' });
      return z.NEVER;
    }
    if (!isValidCNPJ(d)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CNPJ inválido' });
      return z.NEVER;
    }
    return d;
  });

// ─── social (tag / url / dateBR) ─────────────────────────────────────────────

// tag === handle. a-z 0-9 _, 3..24 chars. Normaliza pra lowercase.
// No CLAUDE.md: profiles.tag e profiles.username são sinônimos sincronizados
// (trigger BEFORE INSERT/UPDATE no Supabase).
export const tagSchema = z
  .string({ invalid_type_error: 'Tag inválida' })
  .trim()
  .min(1, 'Informe o @')
  .transform((v) => v.toLowerCase())
  .superRefine((v, ctx) => {
    if (v.length < 3 || v.length > 24) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O @ deve ter entre 3 e 24 caracteres',
      });
      return;
    }
    if (!/^[a-z0-9_]+$/.test(v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use só letras minúsculas, números e _',
      });
    }
  });

export const urlSchema = z
  .string({ invalid_type_error: 'URL inválida' })
  .trim()
  .min(1, 'Informe a URL')
  .transform((v, ctx) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL inválida' });
      return z.NEVER;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A URL deve começar com http:// ou https://',
      });
      return z.NEVER;
    }
    if (!u.hostname) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL inválida' });
      return z.NEVER;
    }
    return u.toString();
  });

// dateBR: aceita "dd/mm/aaaa" OU ISO ("YYYY-MM-DD" ou "YYYY-MM-DDTHH:MM…").
// Saída sempre é Date. Valida calendário (rejeita 31/02).
export const dateBRSchema = z
  .string({ invalid_type_error: 'Data inválida' })
  .trim()
  .min(1, 'Informe a data')
  .transform((v, ctx) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
    if (m) {
      const day = parseInt(m[1], 10);
      const mon = parseInt(m[2], 10);
      const yr = parseInt(m[3], 10);
      const dt = new Date(yr, mon - 1, day);
      if (dt.getFullYear() !== yr || dt.getMonth() !== mon - 1 || dt.getDate() !== day) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Data inválida' });
        return z.NEVER;
      }
      return dt;
    }
    if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v)) {
      const dt = new Date(v);
      if (isNaN(dt.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Data inválida' });
        return z.NEVER;
      }
      return dt;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use o formato dd/mm/aaaa' });
    return z.NEVER;
  });

// ─── age gate (LGPD-K + Apple 1.6 + Google Family Policy) ───────────────────

// Idade mínima do app: 16 anos.
// - <13 cai em COPPA (US) e LGPD-K Art. 14 §1º (consentimento parental
//   específico).
// - 13-15 ainda é menor em LGPD-K e exige base legal explícita; Google
//   Family Policy aplica analytics-restriction se aceitar essa faixa
//   (Sentry deixa de ser legal).
// 16+ é a faixa segura pra app social brasileiro com UGC + chat aberto.
export const MIN_AGE = 16;

/** Calcula idade em anos cheios a partir de data ISO `YYYY-MM-DD`.
 *  Retorna -1 quando inválida. */
export function calculateAge(birthISO: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthISO)) return -1;
  const birth = new Date(birthISO);
  if (isNaN(birth.getTime())) return -1;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// Schema pra data de nascimento obrigatória com gate >= MIN_AGE.
// Usado em signup; perfil antigo (legacy) atualiza via update onde
// também revalidamos.
export const birthDateSchema = z
  .string({ invalid_type_error: 'Data inválida' })
  .trim()
  .min(1, 'Informe sua data de nascimento')
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'Data inválida' })
  .refine(
    (v) => {
      const age = calculateAge(v);
      return age >= 0 && age <= 120;
    },
    { message: 'Data inválida' },
  )
  .refine((v) => calculateAge(v) >= MIN_AGE, {
    message: `Você precisa ter pelo menos ${MIN_AGE} anos para usar o app`,
  });

// ─── aggregator ──────────────────────────────────────────────────────────────

// Map nome → schema, equivalente ao window.Schemas vanilla. Útil pra
// chamadas dinâmicas (formulários gerados por config) e introspecção.
export const Schemas = {
  email: emailSchema,
  password: passwordSchema,
  strongPassword: strongPasswordSchema,
  passwordsMatch: passwordsMatchSchema,
  required: requiredSchema,
  brl: brlSchema,
  area: areaSchema,
  phone: phoneSchema,
  cep: cepSchema,
  cpf: cpfSchema,
  cnpj: cnpjSchema,
  tag: tagSchema,
  url: urlSchema,
  dateBR: dateBRSchema,
} as const;

export type SchemaName = keyof typeof Schemas;
