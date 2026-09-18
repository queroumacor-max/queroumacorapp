// __tests__/lib/ssrf-guard.test.ts — auditoria de webhooks/integrações
// externas 2026-09-17, achado L2: `brand-logos.fetchBytes` baixava a URL
// que a resposta da OpenAI devolve sem checar o host. `isPubliclyRoutableHttpsUrl`
// é o blocklist de rede privada usado ali.
import { describe, it, expect } from 'vitest';
import { isPubliclyRoutableHttpsUrl } from '../../lib/api/ssrf-guard';

describe('isPubliclyRoutableHttpsUrl', () => {
  it('aceita host público comum (o caso real: storage da OpenAI)', () => {
    expect(
      isPubliclyRoutableHttpsUrl('https://oaidalleapiprodscus.blob.core.windows.net/x/y.png'),
    ).toBe(true);
    expect(isPubliclyRoutableHttpsUrl('https://example.com/img.png')).toBe(true);
  });

  it('recusa loopback (IPv4 e IPv6) e localhost', () => {
    expect(isPubliclyRoutableHttpsUrl('https://127.0.0.1/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://127.1.2.3/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://[::1]/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://localhost/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://sub.localhost/x')).toBe(false);
  });

  it('recusa o metadado de nuvem (169.254.169.254) e link-local em geral', () => {
    expect(isPubliclyRoutableHttpsUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://169.254.1.1/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://[fe80::1]/x')).toBe(false);
  });

  it('recusa RFC1918 (rede interna) nas 3 faixas', () => {
    expect(isPubliclyRoutableHttpsUrl('https://10.0.0.5/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://172.16.0.1/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://172.31.255.254/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://192.168.1.1/x')).toBe(false);
    // 172.15.x e 172.32.x NÃO são RFC1918 — não podem ser recusados por engano.
    expect(isPubliclyRoutableHttpsUrl('https://172.15.0.1/x')).toBe(true);
    expect(isPubliclyRoutableHttpsUrl('https://172.32.0.1/x')).toBe(true);
  });

  it('recusa CGNAT (100.64.0.0/10) e IPv6 unique-local (fc00::/7)', () => {
    expect(isPubliclyRoutableHttpsUrl('https://100.64.0.1/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://100.100.0.1/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://100.63.0.1/x')).toBe(true); // fora da faixa
    expect(isPubliclyRoutableHttpsUrl('https://[fd12:3456::1]/x')).toBe(false);
  });

  it('recusa IPv4-mapped em IPv6 apontando pra rede privada', () => {
    expect(isPubliclyRoutableHttpsUrl('https://[::ffff:127.0.0.1]/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://[::ffff:10.0.0.1]/x')).toBe(false);
  });

  it('recusa formas ofuscadas de 127.0.0.1 — o parser de URL já normaliza', () => {
    // decimal (2130706433 = 127.0.0.1) e octal (0177.0.0.1) são formas
    // alternativas clássicas de burlar checagem por string; `new URL()`
    // já resolve pro dotted-decimal antes da nossa checagem rodar.
    expect(isPubliclyRoutableHttpsUrl('https://2130706433/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('https://0x7f.0.0.1/x')).toBe(false);
  });

  it('recusa esquema não-https e URL malformada, sem lançar', () => {
    expect(isPubliclyRoutableHttpsUrl('http://example.com/x')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('file:///etc/passwd')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('não é uma url')).toBe(false);
    expect(isPubliclyRoutableHttpsUrl('')).toBe(false);
  });
});
