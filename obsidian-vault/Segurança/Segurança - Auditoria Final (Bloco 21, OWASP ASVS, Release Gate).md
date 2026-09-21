---
tags: [segurança, auditoria, owasp-asvs, release-gate]
---

# Auditoria "Bloco 21" — OWASP ASVS Final / Security Baseline / Release Gate

**Data:** 2026-09-18. 30 categorias, 11 investigações paralelas cobrindo TODA a superfície (arquitetura, auth/sessão/autorização, RLS/injeção, XSS/SSRF/lógica de negócio, race conditions/webhooks, IA/upload, mobile/Firebase, HTTP/Cloudflare/secrets, logging/privacy/backup, CI-CD/deps/IAM, regressão histórica + attack chaining, build/test/secret-scan real).

Achados de código-fixável **corrigidos na hora** nesta mesma sessão — não ficaram só documentados. SQL em `/migrations/2026-09-18-final-release-gate-hardening.sql` — **JÁ EXECUTADO** no Supabase (2026-09-20, confirmado pelo usuário: as 4 linhas de conferência voltaram `ok=true`). **Não pedir pra rodar de novo.**

Nenhum CRITICAL. Um HIGH, achados MEDIUM/LOW listados abaixo por categoria. Suíte inteira (184 arquivos/2300 testes), typecheck e os testes do portal reconferidos DEPOIS de cada fix — verdes.

## HIGH corrigido: console de debug Eruda sem gate em produção
`app/layout.tsx` só checava `window.Capacitor` — verdadeiro em QUALQUER AAB/IPA publicado, não só build de debug. Eruda é um REPL de JS completo com acesso a `localStorage`/`sessionStorage` (onde mora a sessão do Supabase) — quem tivesse o app instalado (ou acesso rápido ao aparelho de outra pessoa) abria o botão flutuante e tinha um console com a sessão de quem estivesse logado, **sequestro de conta sem precisar de XSS nenhum**. Também era vetor de supply-chain (script sem pin de versão, liberado pela CSP pro jsdelivr).

**Fix**: só carrega com `NEXT_PUBLIC_ENABLE_ERUDA==='1'` no build — env que fica de fora do build de produção, só setada em build interna de debug.

## MEDIUM corrigidos no código (sem depender de SQL)
- **Sentry `beforeSend`** (`lib/sentry-helpers.ts`) mascarava `user.email`/`request.data`/`extra`/`contexts`, mas NUNCA `exception.values[].value` (a mensagem do próprio Error) nem `message`/`breadcrumbs` — um `throw new Error("Falha ao enviar pra "+phone)` ia pro Sentry (terceiro) sem máscara. Estendido.
- **CI (`ci.yml`)**: o step "npm audit (fail-fast)" tinha `continue-on-error: true` — o comentário dizia "fail-fast" mas o job (e o check obrigatório `validate`) ficava verde mesmo com CVE HIGH/CRITICAL numa dependência de produção. Removido.
- **SVG deixou de contar como imagem válida** em `lib/utils/mediaType.ts` (`ehImagem`/`provadoNaoImagem`) e saiu do `accept` dos inputs de avatar/logo. SVG pode embutir `<script>`; a única barreira era o `allowed_mime_types` dos buckets (que já não inclui SVG, mas era ponto único de falha), e `/admin/media-review` abre arquivo em `<a target="_blank">`, que executaria script de um SVG top-level.
- **SSRF em `persistBrandLogos`/`fetchBytes`** (logos gerados por IA): `isPubliclyRoutableHttpsUrl` validava só a URL de ENTRADA, e `fetch` segue redirect por padrão — host que passa no guard e responde 3xx pra um alvo privado seria seguido sem revalidação. Agora revalida `r.url` (destino final, depois de qualquer redirect) antes de aceitar os bytes.
- **Formula injection (CWE-1236) nos DOIS exports CSV do portal** (`exportCSV` de Leads, `csvDoUso` de "Uso do App"): campo de lead importado de planilha ou de perfil (nome/cidade/@tag) começando com `=`/`+`/`-`/`@` vira FÓRMULA no Excel mesmo entre aspas. Prefixo com aspas simples nas linhas de DADO (cabeçalho, que é string fixa nossa — inclusive `"@tag"` — não é tocado). `app.js` recompilado do `app.jsx` pela receita documentada (babel + `jsescOption.minimal: false`), hash SRI e `?v=` do `index.html` atualizados (`20260916a`→`20260918a`), suíte do portal reconferida.
- **Ordem de `whatsapp_messages.delivery_status`**: `statusAvanca`/`PESO_STATUS` só dedupavam DENTRO de uma entrega de webhook (Map em memória); duas entregas HTTP separadas (reentrega da Meta, ou `sent` chegando depois de `read` fora de ordem — normal pra ela) podiam regredir o status gravado. `persistStatusEntrega` agora usa `filtroSoAvancaEntrega` (mesmo padrão de `filtroSoAvanca`, já usado pra abordagem de lead) no PATCH, fechando a corrida ENTRE requisições, não só dentro de uma.

## MEDIUM que precisavam do SQL (JÁ EXECUTADO)
- `comments_select_auth` (`USING(true)`, recuperação de 2026-06-06) ainda coexistia com a policy restritiva `"View comments active"` — MESMA classe de bug já corrigida pra `quotes` em 2026-09-03 (policies de SELECT são permissivas e somadas com OR: a solta sozinha já libera QUALQUER autenticado a ler comentário soft-deleted/moderado via PostgREST, tornando a restritiva inerte). SQL só faz o DROP — "View comments active" já cobre 100% dos casos legítimos.
- `consent_log.user_id` (trilha de consentimento LGPD) era `ON DELETE CASCADE` — apagar a conta apagava a PRÓPRIA PROVA de que consentimento foi dado/revogado, na tabela criada pra servir de trilha. SQL troca pra `ON DELETE SET NULL` (mesmo padrão de `audit_log.actor_id`, já correto).
- Push de COMENTÁRIO ainda mandava até 80 chars de texto cru pra tela de bloqueio — a redação de 2026-09-15 (ver [[Segurança - Rate Limiting e Abuse]]) cobriu só `type='message'`; comentário caía no ELSE e mandava `notifications.body` verbatim. `dispatch_push_on_notification` recriada com um ramo próprio pra `'comment'` ("`<nome>` comentou no seu post", sem o texto). `notifications.body` (usado dentro do app) não muda.

## MEDIUM/LOW documentados, NÃO corrigidos nesta sessão (decisão de escopo)
- Nenhum audit trail (`audit_log`) pra maioria das escritas administrativas feitas PELO PORTAL (edição do prompt da IA do WhatsApp, tabela de preços, fotos de produto, Click Rua etc.) — o portal escreve direto no Supabase via RLS (`is_portal_admin()`), nunca passa pelas rotas Next.js que chamam `logAuditEvent`. Fechar isso de verdade é mudança de arquitetura (rota própria pro portal chamar, com log), não patch pontual.
- TOCTOU na mensagem de ausência do WhatsApp (`whatsapp-ai-runner.ts enviarAusencia`): duas mensagens do cliente chegando em isolates diferentes quase ao mesmo tempo podem os dois lerem `away_at=null` antes de qualquer um gravar, e os dois mandarem a cortesia — duplicidade real, baixo impacto (mensagem educada repetida, não é dinheiro/preço). Mesma classe já corrigida pra `reserveReply`/`claim_wa_followup_nudge` no mesmo arquivo; falta aplicar aqui.
- CSP com `script-src 'unsafe-inline'` sem nonce/hash — hoje sem sink explorável (o único `dangerouslySetInnerHTML` com dado de usuário já escapa por `sanitize.ts`), mas remove a CSP como rede de segurança pra uma regressão futura.
- Link do PDF de orçamento (`quote-pdf-upload`) monta a origem a partir do Host da requisição, não de uma origem canônica fixa — baixo risco dado o roteamento do Cloudflare, mas é link mandado a CLIENTE de verdade por WhatsApp.
- Sem reconciliação automática contra o Mercado Pago (cron que confira pagamento processado por eles mas nunca confirmado aqui por webhook perdido) — só investigação manual hoje.
- Ação do CodeQL (`codeql.yml`) não fixada por SHA, único job com `security-events:write` fora do padrão de pin do resto do CI.
- Cadeia `wrangler`→`sharp@0.33.5`/`undici`/`ws` com CVE HIGH — mesma classe já aceita pra `tar`/`vitest` (dev-only, não embarca no artefato). Dependências de PRODUÇÃO: **0 vulnerabilidades** (`npm audit --omit=dev`).

## Confirmado limpo, sem regressão
TODAS as 22 correções CRITICAL/HIGH históricas re-testadas (RLS de quotes/orders/messages, proteção contra auto-promoção a admin, hijack de push token, `search_all` com teto, gates de PRO/IA fail-closed, MP webhook fail-closed, admin RSC auth, XSS/CSP, source maps, `getRuntimeEnv()`, normalização de telefone do WhatsApp, FK sweep de exclusão de conta, hash de CSAM do lado do servidor, fail-open só em 429, reservas atômicas de cota) — **nenhum FAIL**. Nenhuma cadeia de ataque nova (busca→IDOR, sessão obsoleta→ação privilegiada, injeção de prompt→efeito cross-user) encontrada.

## NOT VERIFIED (fora do alcance de código, listado pra não esconder a lacuna)
- Config de Auth do Supabase (JWT/MFA/leaked password — já checado em sessão de console anterior, não re-verificável daqui).
- OAuth PKCE ponta a ponta num aparelho real contra Google/Apple de verdade.
- Se o gitleaks BINÁRIO acusaria algo (indisponível neste ambiente — proxy só libera npm/PyPI/Anthropic; fallback manual por grep não achou nada, mas não é o mesmo escopo).
- IAM/admins de todas as contas externas (GitHub/Cloudflare/Supabase/Firebase/Apple/Play/Codemagic/Meta/MP/Sentry/registrador) — só point-in-time de sessões anteriores, não re-conferido agora.
- Restore de PITR nunca testado de verdade, só o procedimento documentado.
- Se `migrations/2026-09-16-business-logic-security-audit.sql` (que já cobre boa parte de state-transition/self-farming) foi de fato EXECUTADA no Supabase — sem confirmação "JÁ EXECUTADO" explícita encontrada, ao contrário de toda outra migration deste arquivo. **Ver a mesma dúvida reafirmada no [[Segurança - Pentest Integrado Final]].**
- Exploração real do gap de redirect-SSRF/DNS-rebinding (guard corrigido por revisão de código, não testado contra um alvo vivo).

## VEREDITO
**READY WITH DOCUMENTED RISKS.** Sem CRITICAL. O único HIGH (Eruda) já está corrigido no código desta sessão. Não há bypass de FREE→PRO, USER→ADMIN, IDOR de service-role, nem vazamento cross-user confirmado. Faltava rodar o SQL (3 blocos, idempotente — **já executado**, ver acima) e decidir o que fazer com os MEDIUM/LOW não corrigidos — nenhum deles é bloqueante de release sozinho, mas ficam registrados aqui em vez de escondidos.

---
## Ver também
[[Segurança - Pentest Integrado Final]] · [[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Segurança - Auditoria de Privacidade e LGPD]] · [[Segurança - CVEs e Dependências (Next.js, postcss, adapters)]]
