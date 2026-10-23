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

// BRL: aceita "100", "1.500,50", "1500.50" → number. Reusa `parseBRL` de
// utils.ts pra garantir mesmo parsing dos inputs vanilla — e é lá que mora a
// regra que decide se o ponto é decimal ou milhar (até 01/09/2026 "1500.50"
// virava 150050 aqui dentro, apesar deste comentário afirmar o contrário).
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

// Telefone opcional: vazio → '' ; preenchido → normaliza/valida como
// phoneSchema. Usado no signup de Cliente (Apple 5.1.1 — não exigir telefone
// quando não é estritamente necessário pra conta).
export const phoneOptionalSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v),
  z.literal('').or(phoneSchema),
);

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
// SÓ LETRAS (2026-09-05, decisão do usuário): sem espaço, sem número, sem
// símbolo. Antes aceitava `[a-z0-9_]`.
//
// Só afeta quem ESTÁ ESCOLHENDO uma tag agora — `tagSchema` é usado apenas
// no cadastro e no /completar-perfil. Tag já gravada não é revalidada em
// lugar nenhum (o /perfil/editar mostra a tag como readonly), então nenhum
// usuário antigo com número ou `_` na tag é afetado. O portal admin
// (`_services/admin-users.setTag`) segue aceitando `[a-z0-9_]` DE PROPÓSITO:
// é o caminho que conserta tag legada, e precisa poder reescrever o que já
// existe.
export const TAG_MIN = 3;
export const TAG_MAX = 24;

export const tagSchema = z
  .string({ invalid_type_error: 'Apelido inválido' })
  .trim()
  .min(1, 'Informe o apelido')
  .transform((v) => v.toLowerCase())
  .superRefine((v, ctx) => {
    if (v.length < TAG_MIN || v.length > TAG_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `O apelido deve ter entre ${TAG_MIN} e ${TAG_MAX} letras`,
      });
      return;
    }
    if (!/^[a-z]+$/.test(v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use só letras — sem espaço, número ou símbolo',
      });
    }
  });

/** Tira acento sem depender de tabela: NFD separa a letra do diacrítico. */
function semAcento(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Deixa no texto SÓ o que pode virar tag: letras minúsculas, sem acento.
 * Usado no `onChange` do campo pra a pessoa não conseguir digitar o que a
 * validação vai recusar depois — recusar no submit ensina menos que impedir
 * na hora.
 */
export function limparTag(bruto: string): string {
  return semAcento(bruto).toLowerCase().replace(/[^a-z]/g, '').slice(0, TAG_MAX);
}

/**
 * Sugere uma @tag a partir do nome. "José da Silva Ávila" → "josedasilva".
 * Devolve '' quando o nome não rende o mínimo de letras — sugestão curta
 * demais seria recusada pelo próprio schema, e oferecer algo inválido é pior
 * que não oferecer nada.
 */
export function sugerirTagDeNome(nome: string): string {
  const t = limparTag(nome || '');
  return t.length >= TAG_MIN ? t : '';
}

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

// Idade mínima do app: 18 anos.
// Alinhado com os Termos de Uso e a Política de Privacidade, que declaram
// o app destinado a maiores de 18 anos (consistência legal — antes o gate
// era 16 e divergia dos documentos). 18+ também simplifica a base legal
// LGPD (sem consentimento parental Art. 14) e atende Apple 1.6 / Google
// Family Policy pra app social com UGC + chat aberto.
export const MIN_AGE = 18;

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

// ─── nome de pessoa ─────────────────────────────────────────────────────────
//
// SÓ LETRAS (2026-09-05, decisão do usuário): sem número, sem símbolo.
//
// "Letras" aqui é `\p{L}` (Unicode), NÃO `[a-zA-Z]` — nome brasileiro tem
// acento e ç, e um filtro ASCII recusaria "Conceição" e "Ávila". Espaço,
// hífen e apóstrofo passam porque são parte de nome real ("Maria José",
// "Jean-Pierre", "D'Ávila"); o que sai é dígito, @, #, emoji e afins.
const RE_NOME = /^\p{L}[\p{L}\s'’-]*$/u;

/** Tira do texto o que não pode aparecer num nome. Usado no onChange. */
/**
 * Nome próprio com a primeira letra de cada palavra em maiúscula.
 *
 * Conectivos ficam minúsculos ("Maria da Silva", "João dos Santos") — é como
 * nome brasileiro se escreve, e forçar "Da Silva" pareceria erro do app.
 * Nunca no começo: "Da Costa" como nome inteiro mantém o D maiúsculo.
 */
const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

export function formatarNomeProprio(bruto: string): string {
  return (bruto || '')
    .split(' ')
    .map((palavra, i) => {
      const p = palavra.toLocaleLowerCase('pt-BR');
      if (!p) return p;
      if (i > 0 && CONECTIVOS.has(p)) return p;
      return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1);
    })
    .join(' ');
}

export function limparNome(bruto: string): string {
  // Só letra (com acento) e espaço. Ponto, número, hífen e apóstrofo saem —
  // decisão do usuário em 07/09/2026. Efeito colateral conhecido: nomes como
  // "D'Ávila" e "Ana-Maria" perdem o sinal; se um dia incomodar, é aqui.
  return (bruto || '').replace(/[^\p{L}\s]/gu, '');
}

export const personNameSchema = requiredField('seu nome')
  .refine((v) => !v.includes('@'), { message: 'Não use o email como nome' })
  .refine((v) => RE_NOME.test(v), {
    message: 'Use só letras — sem números ou símbolos',
  });

// ─── data de nascimento digitável ───────────────────────────────────────────
//
// O campo era `<input type="date">`: no celular abre o seletor nativo, e
// escolher o ANO exige rolar décadas — quem nasceu em 1975 rola meio século.
// Agora é texto com máscara `DD/MM/AAAA`, digitável direto.

/** Formata enquanto digita: só dígitos, barras entram sozinhas. */
export function mascararDataBR(bruto: string): string {
  const d = (bruto || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * "DD/MM/AAAA" → "AAAA-MM-DD". Devolve '' se ainda não está completa ou se a
 * data não existe (31/02, mês 13). A checagem de volta pelo `Date` é o que
 * pega dia inexistente: o JS transborda 31/02 pra 03/03 em silêncio.
 */
export function dataBRParaISO(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((br || '').trim());
  if (!m) return '';
  const [, dd, mm, aaaa] = m;
  const iso = `${aaaa}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  if (
    d.getFullYear() !== Number(aaaa) ||
    d.getMonth() + 1 !== Number(mm) ||
    d.getDate() !== Number(dd)
  ) {
    return '';
  }
  return iso;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". Pra repopular o campo ao voltar um passo. */
export function isoParaDataBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
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
