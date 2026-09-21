---
tags: [convenções, regras, processo]
---

# Convenções Gerais de Desenvolvimento (regras que se repetem em todo o projeto)

## REGRA PERMANENTE (2026-09-20, pedido explícito do usuário) — registrar imediatamente
Toda vez que (a) uma correção for aplicada (bug fix, mudança de config, deploy) OU (b) o usuário fizer algo manual fora do código (painel do Cloudflare/Supabase/GitHub, rodar SQL, trocar segredo, clicar em algo no dashboard), isso entra no `CLAUDE.md` **NA HORA** — não no fim da sessão, não "se sobrar tempo". Não esperar confirmação de que "funcionou" pra registrar: registrar o que foi feito e o estado conhecido até aquele momento (mesmo incerto/parcial) e atualizar depois se mudar. Esta regra existe porque o projeto já documentou, repetidas vezes, sessões que fizeram auditoria/correção real e só registraram no fim (ou nunca) — deixando a próxima sessão cega ou repetindo trabalho já feito. A mesma lição, aprendida de novo várias vezes ("LIÇÃO DE PROCESSO"), é exatamente o que essa regra tenta parar de acontecer.

## Fluxo de trabalho
- Commit + **merge automático pra `main`** após cada correção/melhoria concluída (deploy Cloudflare é automático a partir da `main`).
- Toda migration nova: **colar o SQL completo no chat**, nunca só criar o arquivo — Claude não roda SQL no Supabase.
- Preview deploys (`<branch>.queroumacorapp.pages.dev`) pra testar features arriscadas antes do merge.
- Branch de trabalho é sempre uma branch nova; features arriscadas (mudanças visuais, fluxos críticos, refactors) trabalhadas em branches isoladas, sem push nem deploy, até o usuário revisar o diff e autorizar push + PR + merge explicitamente — nenhuma delas vai ao ar sem essa aprovação intermediária (regra reforçada depois das PRs #339/#340 de 2026-09-18).

## "A LISTA DE 'SQL PENDENTE' DESTE ARQUIVO NÃO É EVIDÊNCIA" (2026-09-05)
Conferido contra o banco numa auditoria: das quatro migrations marcadas como pendentes, **três já tinham sido rodadas** (Wave 41 `exports` + policies, Wave 53 `quotes.post_id`, Wave 49 mídia do WhatsApp) e uma entrada se contradizia dentro de si mesma. A anotação é escrita à mão e envelhece; o banco não. **REGRA: antes de dizer que um SQL falta — e antes de pedir pra alguém rodar de novo — rodar uma consulta de conferência real** (ex.: `/migrations/2026-09-05-conferencia-pendencias.sql`, só leitura, uma linha por item, `ok` true/false). Item novo marcado como pendente = linha nova nessa consulta.

**Vale pra TODA pendência, não só SQL.** Na mesma varredura caíram mais três que estavam erradas: Image Resizing (ligado, ver [[Performance - Índices, RPCs e Paginação]]), APNs/`App.entitlements` (feitos, ver [[Mobile - Build, Deploy e Push Nativo]]) e "esconder a compra do PRO no iOS" (já não existe compra no app). Depois caiu mais uma, por leitura do código e não por verificação externa: "tirar a sessão do Supabase do `localStorage`" era pendência MAL FORMULADA (ver [[Auth - OAuth, Cadastro e RLS de Sessão]]).

**PADRÃO A NOTAR:** de 9 pendências listadas numa auditoria, 7 estavam erradas — 6 já feitas e 1 sem sentido. Lista de pendência envelhece pior que código, e ninguém a revalida porque parece barato confiar nela. Custou repetir por semanas que um item de PDF estava quebrado e que faltava ligar o Image Resizing, as duas coisas falsas.

**NÃO VERIFICÁVEL deste ambiente**: a política de rede só libera GitHub/npm/PyPI/Anthropic; o proxy recusa DNS-over-HTTPS e a produção. Não afirmar nada sobre pendências de DNS/e-mail sem o usuário conferir — o que já se sabe é que existe evidência indireta (ex.: proteção de branch confirmada por um `405 Required status check` real num merge).

## Regras técnicas recorrentes (cada uma custou um incidente real)
1. **Env de runtime**: sempre `getRuntimeEnv()`, nunca `process.env` cru no edge. Nada que dependa de env roda no module-load (o edge não tem `process.env` populado — os secrets do painel só existem no request context, `Symbol.for('__cloudflare-request-context__')`).
2. **RLS de função em policy**: sempre `(select is_portal_admin())`, nunca solto — senão o Postgres chama por linha (custou "57014: statement timeout" no WhatsApp).
3. **Telefone de WhatsApp**: sempre `normalizeWhatsAppTarget`, nunca `normalizeBrPhone` — o segundo cola '55' em qualquer coisa com 10-11 dígitos, transformando número estrangeiro (`16503154274`, EUA) em algo inválido e derrubando o envio com 502.
4. **Dentro da casca mobile**: nunca `window.location.href` pra navegação — usar `router.push/replace` (SPA) ou `window.open` (externo). Navegação de documento cancelada/falha pinta a `errorPath` da casca ("Sem conexão" com internet perfeita).
5. **API nativa do edge/workerd**: método se chama NO OBJETO DONO (`ctx.waitUntil(...)`), nunca extraído pra variável solta — senão lança `Illegal invocation` de forma síncrona.
6. **Mídia de arquivo escolhido pelo usuário**: nunca validar só por `file.type` — checar extensão e bytes (magic numbers) também. E só recusar com PROVA de que não é o tipo esperado ("não provei que é imagem" ≠ "provei que não é").
7. **`update()` do Supabase sem `.select()`** não avisa quando não acha linha nenhuma — onde importa (identidade, dinheiro, permissão), pedir `.select()` e conferir a contagem. Causou o loop mudo do `/completar-perfil`.
8. **Schema real antes de escrever SQL**: a lista de colunas do código não é garantia da tabela real (já custou 2+ incidentes com `leads.city`, `quotes.post_id`).
9. **Conferência de constraint/pendência**: LISTAR do catálogo real (`pg_constraint`, query de conferência), nunca confiar em anotação escrita à mão ou perguntar só pelo nome já conhecido.
10. **Campo novo no body de rota admin** precisa entrar no TIPO do `body` no topo do arquivo — senão quebra o `next build` (não pega no `tsc --noEmit` isolado nem no vitest).
11. **`route.ts` do Next só aceita exports fechados** (sem helpers extras) — só aparece no `next build`.
12. **Hook com canal Realtime do Supabase**: nome de canal único por instância (`useId()`), senão dois consumidores colidem (`cannot add postgres_changes callbacks after subscribe()`).
13. **Fuso horário**: tudo no QueroUmaCor é exibido em `America/Sao_Paulo`, independente do fuso do aparelho — mas o patch de `toLocaleString` NÃO cobre `getTimezoneOffset()`, usar `ymdBrt()`/`ymdDeCampos()` onde isso importar.
14. **Filho de coluna flex de altura fixa que pode crescer**: precisa de `overflow` + `minHeight:0`.
15. **`flex-1` em campo de texto**: precisa de `min-w-0`; vizinho fixo (botão/ícone) precisa de `shrink-0`.
16. **Salvar imagem gerada no cliente (mobile)**: sempre `shareOrDownloadImage`, nunca `<a download>` cru (não funciona na WebView).
17. **URL/anon key do Supabase**: sempre do MESMO par (`resolveSupabaseEnv()`), nunca meio a meio — misturar par de projetos diferentes derruba auth do servidor com "token_invalid" enganoso.
18. **Comparar `File` em teste**: por identidade (`toBe`), nunca `toEqual`/`toHaveBeenCalledWith` — `File` não tem propriedade própria enumerável.
19. **Conferir a linha `Test Files` do vitest, não só `Tests`**: arquivo com erro de parse vira "skipped", não "failed", e a contagem de testes passados sobe normalmente.
20. **Colar SQL com DROP+CREATE juntos, uma instrução por vez**: Postgres não tem `CREATE POLICY IF NOT EXISTS`, e colar tudo junto às vezes faz só o DROP rodar (ou só o CREATE, dependendo do editor).

## Regras de processo / memória do projeto
- **"Verificar que X está desligado" ≠ "ligar X"** — confirmar estado não é executar a ação. Aconteceu duas vezes com DNSSEC/CAA antes de alguém finalmente ligar de verdade.
- **Lista de pendências escrita à mão envelhece e ninguém revalida** — reconferir com query real antes de afirmar (e antes de pedir pra rodar de novo).
- **Relato no chat não é evidência**, nem vindo do usuário — mas quando o usuário CONFIRMA que algo está feito olhando o banco/painel real, ele ganha da anotação escrita (a anotação pode estar desatualizada, o usuário está vendo o estado atual).
- **Toda sessão que fizer auditoria de segurança registra no CLAUDE.md imediatamente**, não no fim, não numa sessão futura (ver REGRA PERMANENTE no topo).
- **Painel de diagnóstico com lista de filtros escrita à mão é lista que mente** — derivar de um `Record` tipado que o compilador força a manter completo (ex.: `FAILURE_TYPE_LABELS`, `IA_FEATURE_ROTULOS`).
- **"Auditei agora" tem validade de minutos quando há mais de uma sessão mexendo no mesmo projeto ao mesmo tempo** — reconferir `origin/main`/painel logo antes de agir, não confiar num snapshot antigo (ver [[Incidentes Notáveis]]).
- **Achado de scanner externo (ZAP/Nmap/Nuclei/HostedScan) em produção sempre merece reproduzir localmente antes de descartar**, mesmo quando o código parece óbvio e correto — já expôs bug real de meses que uma auditoria anterior tinha dado como fechado.
- **"Validado por curl via `wrangler pages dev`" numa entrada antiga não é garantia eterna** — o mesmo método pode ter tido versão diferente do adapter, path diferente testado, ou erro de método da vez anterior.

## WEBINTOAPP MORTO
Ver [[00 - Índice]] e [[Mobile - Build, Deploy e Push Nativo]] — não citar como referência nunca mais. As DUAS lojas saem de Codemagic + Capacitor desde 2026-09-04.

---
## Ver também
[[Incidentes Notáveis]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]] · [[Pendências Reais (Ação Manual Necessária)]]
