---
tags: [segurança, auditoria, mobile, capacitor, android, ios]
---

# Auditoria de Segurança Mobile (Capacitor/Android/iOS/WebView)

**Data:** 2026-09-13/15. Mergeada na `main` (branch `claude/mobile-security-audit-b36g38`).

## Crítico contido, depois corrigido na raiz
`next@15.5.2` vulnerável a CVE-2025-66478/CVE-2025-55182 (RCE, CVSS 10.0, header `Next-Action`). Versão presa pelo teto do peer range do `@cloudflare/next-on-pages` (descontinuado). **Mitigação nesta sessão**: `next-app/middleware.ts` barra qualquer request com header `Next-Action` com 404 (seguro — app não declara nenhuma Server Action). Essa mitigação **fica** (defesa em profundidade), mas deixou de ser a única barreira: a [[Segurança - Cloudflare|auditoria Cloudflare]] bumpou `next` pra `15.5.25` (dentro da minor, via `legacy-peer-deps=true`), fechando o CVE de verdade.

## Outros corrigidos
- Android `allowBackup` true→false (sessão do Supabase morava em localStorage/cookies na WebView).
- Token de push nativo (FCM) não era desassociado no logout — `clearDeviceTokenOnLogout()`.
- Drift de CSP entre `_headers` (raiz) e `next.config.mjs` — `media-src` sem `https://*.supabase.co`.
- **M1 (2026-09-15): OAuth mobile migrou de implicit flow pra PKCE.** Ver [[Auth - OAuth, Cadastro e RLS de Sessão]]. **Ainda não testado em aparelho real** na época — precisa login social de verdade (Google e Apple) uma vez em cada plataforma.

## Not verified
Build nativo real (sem Android SDK / macOS no ambiente da sessão) — precisa rodar no Codemagic antes de confiar cegamente.

## Achados baixos, sem ação
`.well-known/assetlinks.json` resto de versão TWA (sem efeito hoje); FileProvider com `path="."` mais amplo que necessário mas não exportado (template padrão do plugin de câmera).

## Reconciliação com merges paralelos
Enquanto essa branch estava aberta, DUAS auditorias avançaram a `main` em paralelo (rate limiting #301, FCM/push merge `0bc52fc`), mexendo nos MESMOS arquivos por motivos DIFERENTES e complementares — mergearam sem conflito de lógica, só 3 conflitos textuais (docs). Depois, a auditoria Cloudflare também mergeou `main` no meio do push desta, trazendo mais 1 conflito textual (mesma causa).

---
## Ver também
[[Segurança - Cloudflare]] · [[Segurança - Firebase FCM e Push]] · [[Mobile - Build, Deploy e Push Nativo]] · [[Auth - OAuth, Cadastro e RLS de Sessão]]
