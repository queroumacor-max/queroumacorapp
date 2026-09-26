// safeUrl (auditoria 2026-09-26): href com dado de usuário só passa se for
// http(s) absoluto. React 18 não bloqueia javascript: em href.
import { describe, it, expect } from 'vitest';
import { safeHttpUrl, isTrustedMediaUrl } from '@/lib/utils/safeUrl';

describe('safeHttpUrl', () => {
  it('aceita http e https, com trim', () => {
    expect(safeHttpUrl('https://a.com/x')).toBe('https://a.com/x');
    expect(safeHttpUrl('http://a.com')).toBe('http://a.com');
    expect(safeHttpUrl('  https://a.com/c  ')).toBe('https://a.com/c');
    expect(safeHttpUrl('HTTPS://A.COM')).toBe('HTTPS://A.COM');
  });
  it('recusa esquemas perigosos em qualquer caixa/espaço', () => {
    for (const v of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(safeHttpUrl(v)).toBeUndefined();
    }
  });
  it('recusa relativa, vazia e não-string', () => {
    expect(safeHttpUrl('/perfil')).toBeUndefined();
    expect(safeHttpUrl('//evil.com')).toBeUndefined();
    expect(safeHttpUrl('exemplo.com')).toBeUndefined();
    expect(safeHttpUrl('')).toBeUndefined();
    expect(safeHttpUrl('   ')).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(42)).toBeUndefined();
  });
});

describe('isTrustedMediaUrl', () => {
  const app = 'https://queroumacor.com.br';
  it('confia no Storage do Supabase e na própria origem', () => {
    expect(
      isTrustedMediaUrl('https://uwq.supabase.co/storage/v1/object/public/posts/u/chat/1.jpg', app),
    ).toBe(true);
    expect(isTrustedMediaUrl('https://queroumacor.com.br/cdn-cgi/image/w=64/x.jpg', app)).toBe(true);
  });
  it('recusa terceiro, http e sufixo falso', () => {
    expect(isTrustedMediaUrl('https://evil.com/x.jpg', app)).toBe(false);
    expect(isTrustedMediaUrl('http://uwq.supabase.co/x.jpg', app)).toBe(false);
    expect(isTrustedMediaUrl('https://supabase.co.evil.com/x.jpg', app)).toBe(false);
    expect(isTrustedMediaUrl('https://evilsupabase.co/x.jpg', app)).toBe(false);
    expect(isTrustedMediaUrl('javascript:alert(1)', app)).toBe(false);
  });
});
