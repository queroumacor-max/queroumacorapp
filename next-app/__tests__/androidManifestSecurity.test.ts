// Auditoria de segurança mobile (2026-09-13) — trava, por leitura direta do
// Manifest (não por dedução), um punhado de propriedades que já foram
// analisadas e corrigidas/confirmadas manualmente. Regressão aqui é
// silenciosa: nada quebra em build/teste normal, só a superfície de ataque
// volta a se abrir.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MANIFEST = '../android/app/src/main/AndroidManifest.xml';
const xml = readFileSync(MANIFEST, 'utf8');

describe('AndroidManifest — allowBackup', () => {
  it('allowBackup="false" — sessão (localStorage/cookies da WebView) não pode ir pro Auto Backup', () => {
    // MASVS-STORAGE: com allowBackup=true (o default do Android), o Auto
    // Backup pra nuvem (Google Drive) e o `adb backup` local copiam o
    // diretório do app inteiro, inclusive `app_webview/` — onde vive a
    // sessão do Supabase (lib/sessionStorageHybrid.ts). Sem chave de
    // criptografia própria, isso é sessão recuperável fora do aparelho.
    expect(xml).toMatch(/android:allowBackup="false"/);
    expect(xml).not.toMatch(/android:allowBackup="true"/);
  });
});

describe('AndroidManifest — MainActivity exportada é a única, e por motivo conhecido', () => {
  it('exported="true" aparece só na MainActivity (LAUNCHER)', () => {
    const exportedTrueCount = (xml.match(/android:exported="true"/g) || []).length;
    // Hoje só a MainActivity é exportada (precisa ser — é o LAUNCHER e
    // recebe o deep link do OAuth). Provider/qualquer outro componente
    // exportado="true" novo tem que passar por revisão manual — daí o
    // teste falhar alto em vez de deixar passar batido.
    expect(exportedTrueCount).toBe(1);
  });

  it('FileProvider NÃO é exportado', () => {
    const providerBlock = xml.match(/<provider[\s\S]*?\/provider>|<provider[^>]*\/>/);
    expect(providerBlock?.[0]).toMatch(/android:exported="false"/);
  });
});

describe('AndroidManifest — deep link do OAuth usa o esquema esperado', () => {
  it('intent-filter de auth casa com NATIVE_OAUTH_REDIRECT (lib/native/auth.ts)', () => {
    // Scheme + host declarados aqui têm que bater com o que o app monta o
    // deep link de callback — divergência = login social nunca completa
    // (o SO não entrega o link de volta pro app).
    expect(xml).toMatch(
      /android:scheme="br\.com\.queroumacor\.app"\s+android:host="auth"/,
    );
  });

  it('o intent-filter do deep link NÃO pede autoVerify (custom scheme não é App Link)', () => {
    // autoVerify=true é pra Android App Links (scheme http/https + Digital
    // Asset Links). Pedir isso num scheme customizado não faz nada de
    // errado, mas sinalizaria (erradamente) que este link foi verificado
    // como domínio — documentando o "false" explícito.
    expect(xml).toMatch(/android:autoVerify="false"/);
  });
});

describe('AndroidManifest — nenhum uso de cleartext HTTP', () => {
  it('não declara usesCleartextTraffic="true"', () => {
    expect(xml).not.toMatch(/usesCleartextTraffic="true"/);
  });
});
