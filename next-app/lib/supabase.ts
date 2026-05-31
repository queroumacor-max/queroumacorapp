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
 * Estoura se as env vars `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * não estiverem setadas — preferimos falhar cedo a devolver null silencioso.
 */
export function getSupabase(): TypedSupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL e/ou NEXT_PUBLIC_SUPABASE_ANON_KEY'
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
