---
tags: [segurança, auditoria, mobile, capacitor, android, ios]
---

# Auditoria de Segurança Mobile (Capacitor/Android/iOS/WebView)

**Data:** 2026-09-13/15. Mergeada na `main` em 2026-09-15 (pedido explícito do usuário: "merge"), branch `claude/mobile-security-audit-b36g38` (commits `af59a79`…`927f466`). Suíte inteira verde, typecheck e `next build` limpos DEPOIS de reconciliada com a auditoria de rate limiting (#301) e a auditoria FCM/APNs/push (merge `0bc52fc`) que avançaram a `main` em paralelo — ver seção de reconciliação no fim desta nota.

## Crítico contido, depois corrigido na raiz
`next@15.5.2` vulnerável a CVE-2025-66478/CVE-2025-55182 (RCE, CVSS 10.0, header `Next-Action`). Versão presa pelo teto do peer range do `@cloudflare/next-on-pages` (descontinuado). **Mitigação nesta sessão**: `next-app/middleware.ts` barra qualquer request com header `Next-Action` com 404 (seguro — app não declara nenhuma Server Action). Essa mitigação **fica** (defesa em profundidade), mas deixou de ser a única barreira: a [[Segurança - Cloudflare|auditoria Cloudflare]] bumpou `next` pra `15.5.25` (dentro da minor, via `legacy-peer-deps=true`), fechando o CVE de verdade — detalhe completo em [[Segurança - CVEs e Dependências (Next.js, postcss, adapters)]].

## Outros corrigidos
- Android `allowBackup` true→false (sessão do Supabase morava em localStorage/cookies na WebView).
- Token de push nativo (FCM) não era desassociado no logout — `clearDeviceTokenOnLogout()`.
- Drift de CSP entre `_headers` (raiz) e `next.config.mjs` — `media-src` sem `https://*.supabase.co`.
- **M1 (2026-09-15): OAuth mobile migrou de implicit flow pra PKCE.** Ver [[Auth - OAuth, Cadastro e RLS de Sessão]]. **Ainda não testado em aparelho real** na época — precisa login social de verdade (Google e Apple) uma vez em cada plataforma.

## Not verified
Build nativo real (sem Android SDK / macOS no ambiente da sessão) — `.aab`/`.apk`/`.ipa` nunca foram gerados nesta sessão, só revisão de código/config. Precisa rodar no Codemagic (ou local com SDK) antes de confiar cegamente nas mudanças de manifest/config.

## Achados baixos, sem ação necessária
`.well-known/assetlinks.json` é resto de uma versão TWA anterior ao Capacitor — hoje não tem efeito nenhum (sem intent-filter `autoVerify` no manifest atual); FileProvider (`file_paths.xml`) tem `path="."` mais amplo que o necessário, mas não é exportado e é o template padrão do plugin de câmera — não mexido pra não arriscar quebrar o contrato do plugin. Sem Universal Links/App Links verificados (só o custom scheme do OAuth) — funcional pro que existe hoje, só vira pendência se um dia quiserem link direto de post/perfil abrindo no app.

## Arquivos alterados
`_headers`, `android/app/src/main/AndroidManifest.xml`, `next-app/middleware.ts`, `next-app/components/{AuthProvider, NativeBadge}.tsx`, `next-app/lib/native/{index,push}.ts`, `next-app/lib/services/pushTokens.ts`, + 6 arquivos de teste (3 novos: `androidManifestSecurity`, `capacitorWebviewSecurity`, `cspHeadersParidade`).

## Reconciliação com merges paralelos
Enquanto essa branch estava aberta, DUAS outras auditorias avançaram a `main` em paralelo: rate limiting/abuse (#301) e Firebase/FCM/APNs/push (merge `0bc52fc`, ver [[Segurança - Firebase FCM e Push]]). A auditoria de FCM mexeu nos MESMOS arquivos desta (`pushTokens.ts`, `push.ts`, `AuthProvider.tsx` etc.) por um motivo DIFERENTE e complementar: ela fecha o sequestro cross-user de `push_device_tokens` (RPC `upsert_push_device_token`, dono da linha decidido por `auth.uid()` dentro da função — nunca pelo `userId` que o cliente manda); esta auditoria fecha o **logout** (o token continuava associado à conta depois que a pessoa saía). Os dois `git merge` automáticos, exceto por **3 conflitos textuais** (`CLAUDE.md`, `SECURITY_AUDIT_LOG.md`, `__tests__/push-nativo.test.ts` — os três só porque as duas branches inseriam conteúdo NO MESMO PONTO do arquivo, não porque as correções colidissem). `pushTokens.ts`/`native/push.ts`/`native/index.ts` mesclaram sem conflito nenhum: `saveDeviceToken` usa a RPC deles, `clearDeviceTokenOnLogout` (desta auditoria) chama `currentNativePushToken()` e apaga a linha por `token` — as duas correções convivem sem se pisar. Suíte completa rodada de novo depois da reconciliação, verde.

**SEGUNDA RECONCILIAÇÃO (mesma sessão, minutos depois)**: a [[Segurança - Cloudflare|auditoria Cloudflare]] mergeou `main` NO MEIO do push desta. `git push origin main` foi rejeitado (main tinha andado de `0bc52fc` pra `3c16bc1`); `git merge origin/main` trouxe mais um conflito textual, só em `SECURITY_AUDIT_LOG.md` (mesma causa: duas branches editando a tabela de pendências no mesmo ponto), resolvido concatenando as duas listas de itens. Essa auditoria bumpou `next` pra `15.5.25` — **corrigindo de verdade** o CVE que esta sessão só conteve no middleware. Suíte + typecheck + `next build` rodados de novo na árvore com as DUAS reconciliações, verdes.

## Achados adicionais da auditoria de 13/09 corrigidos no repo
Dos achados da auditoria Cloudflare de 13/09 que ainda podiam ser corrigidos no repo, além do que já está documentado em [[Segurança - Cloudflare]]:
- `/api/ig-art-diag` virou admin-only de verdade (o comentário sempre disse "PRO + admin", só PRO era checado — qualquer assinante PRO gastava cota das chaves de IA e via quais estavam configuradas).
- Scanner de segredos **gitleaks** entrou no CI (`.gitleaks.toml`+`.gitleaksignore`+self-test, recuperados de uma branch nunca mergeada, validados contra o histórico inteiro com o binário real: **0 leaks**).
- `scripts/load-test.js` restaurado (tinha sido apagado sem querer num cleanup antigo, `load-test.yml` rodava arquivo inexistente desde então).

**Não sobrou nenhum item de CÓDIGO pendente desta auditoria** — só os 9 itens de MANUAL ACTION REQUIRED (Cloudflare/Supabase Dashboard), listados em [[Segurança - Cloudflare]] e em `SECURITY_AUDIT_LOG.md`.

---
## Ver também
[[Segurança - Cloudflare]] · [[Segurança - Firebase FCM e Push]] · [[Segurança - CVEs e Dependências (Next.js, postcss, adapters)]] · [[Mobile - Build, Deploy e Push Nativo]] · [[Auth - OAuth, Cadastro e RLS de Sessão]]
