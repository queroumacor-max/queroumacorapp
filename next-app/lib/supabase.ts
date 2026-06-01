// supabase.ts — singleton wrapper sobre @supabase/supabase-js.
// Substitui `window.getSupabase()` do vanilla (head.js). Lazy init: o cliente
// só é criado na primeira chamada, então import em RSC/middleware/edge
// que nunca chega a usar não estoura por env vars ausentes.
//
// Generic param `Database` (lib/database.types.ts) faz com que TODA chamada
// `sb.from('X')` venha tipada — `.from('posts')` autocompleta colunas, `.eq`
// rejeita coluna inexistente em build, e `.insert({...})` valida shape.
// Onde o app ainda usa o "modo livre" (genérico string), o downcast pra
// `SupabaseClient<Database>` continua funcionando porque os métodos são
// estruturalmente compatíveis.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// Alias re-exportado pra reduzir verbosidade nos consumers.
export type TypedSupabaseClient = SupabaseClient<Database>;

let _client: TypedSupabaseClient | null = null;

/**
 * Retorna o singleton do Supabase client. Cria na primeira chamada.
 *
 * Resolve env vars com fallback chain:
 *   1. process.env.NEXT_PUBLIC_* (inlined no build pelo Next.js)
 *   2. process.env.* sem prefixo (server runtime — RSC/Edge)
 *   3. URL hardcoded (Supabase URL é PÚBLICO — já está em lib/config.ts
 *      e estava em head.js do vanilla)
 *
 * Anon key NÃO tem fallback hardcoded — se faltar, estoura com mensagem
 * direcionada pro fix (vars precisam ser Plain text no painel CF Pages,
 * não Secret, pra ficar disponível durante o build do Next.js).
 */
export function getSupabase(): TypedSupabaseClient {
  if (_client) return _client;
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://uwqebaqweehiljsqkifm.supabase.co';
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';
  if (!url || !key) {
    throw new Error(
      'Supabase anon key ausente: configure NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
      '(ou SUPABASE_ANON_KEY) no painel CF Pages → Settings → Environment Variables. ' +
      'IMPORTANTE: marcar como "Plain text" (não Secret) pra ficar disponível ' +
      'durante o build do Next.js — NEXT_PUBLIC_* só são inlined no bundle ' +
      'se estiverem em process.env DURANTE o build.'
    );
  }
  _client = createClient<Database>(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return _client;
}

/**
 * Reset do singleton — usado em testes (vitest) pra trocar o client mockado
 * entre describe blocks. NÃO chamar em produção.
 */
export function __resetSupabaseForTests(): void {
  _client = null;
}

/**
 * Override do singleton — usado em testes pra injetar mock direto.
 * NÃO chamar em produção. Se for null, próximo getSupabase() vai criar real.
 *
 * Aceita SupabaseClient não-tipado (os mocks dos testes não conhecem o
 * generic) e faz cast pro typed alias — runtime funciona porque os métodos
 * têm assinatura idêntica em ambos.
 */
export function __setSupabaseForTests(client: SupabaseClient | null): void {
  _client = client as TypedSupabaseClient | null;
}
