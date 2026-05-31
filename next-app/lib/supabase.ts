// supabase.ts — singleton wrapper sobre @supabase/supabase-js.
// Substitui `window.getSupabase()` do vanilla (head.js). Lazy init: o cliente
// só é criado na primeira chamada, então import em RSC/middleware/edge
// que nunca chega a usar não estoura por env vars ausentes.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Retorna o singleton do Supabase client. Cria na primeira chamada.
 * Estoura se as env vars `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * não estiverem setadas — preferimos falhar cedo a devolver null silencioso.
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL e/ou NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }
  _client = createClient(url, key, {
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
 */
export function __setSupabaseForTests(client: SupabaseClient | null): void {
  _client = client;
}
