// Auditoria de segurança mobile (2026-09-13) — trava a configuração da
// WebView do Capacitor (capacitor.config.ts, raiz do repo) que decide se o
// bridge nativo (câmera, filesystem, share, push…) fica exposto a conteúdo
// que não é o nosso. Regressão aqui não quebra build nem teste normal —
// só reabre superfície de ataque em silêncio.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CONFIG = '../capacitor.config.ts';
const src = readFileSync(CONFIG, 'utf8');

describe('capacitor.config.ts — WebView não aceita HTTP nem debug em produção', () => {
  it('cleartext: false — sem HTTP puro pro servidor da própria WebView', () => {
    expect(src).toMatch(/cleartext:\s*false/);
  });

  it('androidScheme/iosScheme: https', () => {
    expect(src).toMatch(/androidScheme:\s*'https'/);
    expect(src).toMatch(/iosScheme:\s*'https'/);
  });

  it('Android: sem mixed content e sem WebView debugging habilitado', () => {
    expect(src).toMatch(/allowMixedContent:\s*false/);
    expect(src).toMatch(/webContentsDebuggingEnabled:\s*false/);
  });

  it('iOS: App-Bound Domains ligado (WKWebView só navega pros domínios listados)', () => {
    expect(src).toMatch(/limitsNavigationsToAppBoundDomains:\s*true/);
  });
});

describe('capacitor.config.ts — allowNavigation não vira uma allowlist aberta', () => {
  it('não contém wildcard solto ("*") nem esquema http:// externo', () => {
    const bloco = src.match(/allowNavigation:\s*\[[\s\S]*?\]/)?.[0] ?? '';
    expect(bloco).not.toBe('');
    // Um "*" sozinho (não como parte de "*.queroumacor.com.br") liberaria
    // qualquer host — o bridge nativo (câmera/filesystem/clipboard/share)
    // ficaria acessível a QUALQUER site que a WebView navegasse.
    expect(bloco).not.toMatch(/['"]\*['"]/);
    expect(bloco).not.toMatch(/http:\/\//);
  });

  it('só lista o próprio domínio e o projeto Supabase do app — nada de terceiro', () => {
    const bloco = src.match(/allowNavigation:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const hosts = Array.from(bloco.matchAll(/'([^']+)'/g)).map((m) => m[1]);
    expect(hosts.length).toBeGreaterThan(0);
    for (const h of hosts) {
      expect(h).toMatch(/queroumacor\.com\.br$|\.supabase\.co$/);
    }
  });
});
