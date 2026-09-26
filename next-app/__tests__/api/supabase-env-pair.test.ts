// Regressão do PAR CRUZADO (incidente 2026-09-04).
//
// Produção tinha, no painel do Cloudflare: SUPABASE_URL AUSENTE,
// SUPABASE_ANON_KEY presente como Secret (legado do app vanilla, de OUTRO
// projeto) e o par NEXT_PUBLIC_* correto. Como `getSupabaseUrl` e
// `getSupabaseAnonKey` resolviam INDEPENDENTES, a URL vinha do NEXT_PUBLIC
// (projeto certo) e a chave do secret legado (projeto errado). O GoTrue
// recebia apikey de um projeto e token de outro → 401 pra QUALQUER token →
// `token_invalid` → toda a IA fora do ar.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { gateProAI } from '../../lib/api/security';
import {
  resolveSupabaseEnv,
  getSupabaseUrl,
  getSupabaseAnonKey,
  projectRefFromUrl,
  projectRefFromAnonKey,
} from '../../lib/api/security';

// Monta uma anon key com o formato real (JWT cujo payload traz `ref`).
function anonKeyFor(ref: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref, role: 'anon' })}.assinatura`;
}

const BOM = 'uwqebaqweehiljsqkifm';
const OUTRO = 'projetolegadovelho';

const limpar = () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
};

beforeEach(limpar);
afterEach(limpar);

describe('resolveSupabaseEnv — nunca meio a meio', () => {
  it('CENÁRIO DE PRODUÇÃO: sem SUPABASE_URL e com SUPABASE_ANON_KEY divergente, usa o par NEXT_PUBLIC inteiro', () => {
    // Exatamente o painel do Cloudflare no dia do incidente.
    process.env.SUPABASE_ANON_KEY = anonKeyFor(OUTRO);
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${BOM}.supabase.co`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKeyFor(BOM);

    const env = resolveSupabaseEnv();
    expect(env.source).toBe('public');
    expect(env.url).toBe(`https://${BOM}.supabase.co`);
    // O ponto do teste: a chave escolhida é a NEXT_PUBLIC, NÃO o secret legado.
    expect(env.anonKey).toBe(anonKeyFor(BOM));
    expect(env.anonKey).not.toBe(anonKeyFor(OUTRO));
  });

  it('url e chave saem sempre do MESMO par', () => {
    process.env.SUPABASE_ANON_KEY = anonKeyFor(OUTRO);
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${BOM}.supabase.co`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKeyFor(BOM);

    expect(projectRefFromUrl(getSupabaseUrl())).toBe(
      projectRefFromAnonKey(getSupabaseAnonKey()),
    );
  });

  it('par sem prefixo só é aceito INTEIRO', () => {
    process.env.SUPABASE_URL = `https://${OUTRO}.supabase.co`;
    process.env.SUPABASE_ANON_KEY = anonKeyFor(OUTRO);
    const env = resolveSupabaseEnv();
    expect(env.source).toBe('server');
    expect(env.url).toBe(`https://${OUTRO}.supabase.co`);
  });

  it('meia metade pública não vaza pro par do servidor', () => {
    // Só a URL pública + só a chave do servidor = exatamente o cruzamento
    // que causou o incidente. Tem que cair no 503, não montar um híbrido.
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${BOM}.supabase.co`;
    process.env.SUPABASE_ANON_KEY = anonKeyFor(OUTRO);
    expect(() => resolveSupabaseEnv()).toThrow();
  });

  it('tira a barra final da URL', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${BOM}.supabase.co/`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKeyFor(BOM);
    expect(resolveSupabaseEnv().url).toBe(`https://${BOM}.supabase.co`);
  });
});

describe('detecção de projeto', () => {
  it('lê o ref do host e da anon key', () => {
    expect(projectRefFromUrl(`https://${BOM}.supabase.co`)).toBe(BOM);
    expect(projectRefFromAnonKey(anonKeyFor(BOM))).toBe(BOM);
  });

  it('chave ilegível devolve null — na dúvida não acusa', () => {
    expect(projectRefFromAnonKey('nao-e-um-jwt')).toBeNull();
    expect(projectRefFromAnonKey('')).toBeNull();
  });

  it('reconhece a divergência que o guard usa pra emitir env_project_mismatch', () => {
    const refUrl = projectRefFromUrl(`https://${BOM}.supabase.co`);
    const refKey = projectRefFromAnonKey(anonKeyFor(OUTRO));
    expect(refUrl).not.toBe(refKey);
    expect(refUrl && refKey).toBeTruthy();
  });
});

// ── O gate acusa o cruzamento em vez de disfarçar de token_invalid ───────
describe('gateProAI — env_project_mismatch', () => {
  it('com url e chave de projetos diferentes, o 401 nomeia a causa', async () => {
    // Par completo, porém CRUZADO entre si (url de um projeto, chave de outro).
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${BOM}.supabase.co`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKeyFor(OUTRO);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';

    const req = new Request('https://x/api/chat-ai', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-qualquer' },
    });

    const res = await gateProAI(req, null, { endpoint: 'chat-ai' });
    expect(res).toBeInstanceOf(Response);
    const body = await (res as Response).json();

    // Antes desta correção o erro vinha como `token_invalid` e mandava todo
    // mundo investigar sessão — o token nunca foi o problema.
    expect(body.reason).toBe('env_project_mismatch');
    expect(body.error).toContain('env_project_mismatch');
    // Os refs de projeto NÃO saem no corpo (auditoria 2026-09-26, L1) —
    // ficam só no log do servidor.
    expect(body.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(BOM);
    expect(JSON.stringify(body)).not.toContain(OUTRO);

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
});
