// scrubSecrets.test.ts — credenciais nunca chegam em log/telemetria.
import { describe, expect, it } from 'vitest';
import { redactTokens, scrubUrl } from '../../lib/utils/scrubSecrets';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('scrubUrl', () => {
  it('descarta o fragment inteiro (é onde o Supabase põe os tokens)', () => {
    const u = `https://queroumacor.com.br/update-password#access_token=${JWT}&refresh_token=abc&type=recovery`;
    expect(scrubUrl(u)).toBe('https://queroumacor.com.br/update-password#[redacted]');
  });
  it('mascara code/token/token_hash na query, preserva o resto', () => {
    const u = 'https://x.com/completar-perfil?code=abc-123&next=%2Ffeed&token_hash=zzz';
    const out = scrubUrl(u);
    expect(out).not.toContain('abc-123');
    expect(out).not.toContain('zzz');
    expect(out).toContain('next=%2Ffeed');
  });
  it('URL sem segredo passa intacta', () => {
    expect(scrubUrl('https://x.com/feed?tab=todos')).toBe('https://x.com/feed?tab=todos');
    expect(scrubUrl('')).toBe('');
    expect(scrubUrl(null)).toBe('');
  });
});

describe('redactTokens', () => {
  it('mascara JWT e pares token=… soltos no texto', () => {
    const t = `falhou em ${JWT} com refresh_token=abc.def&x=1`;
    const out = redactTokens(t);
    expect(out).not.toContain(JWT);
    expect(out).not.toContain('abc.def');
    expect(out).toContain('[JWT_REDACTED]');
    expect(out).toContain('x=1');
  });
});
