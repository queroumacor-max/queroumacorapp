---
tags: [whatsapp, integração, dualhook, evolution, cloud-api]
---

# WhatsApp — Canais e Envio (histórico: Evolution → Cloud API → Dualhook)

## Linha do tempo dos canais
1. **Evolution API self-hosted (Baileys)** — 2026-08-28, canal único até a Meta autenticar. Ver seção própria abaixo.
2. **WhatsApp Cloud API da Meta — LIVE ponta a ponta (2026-08-25)** — número oficial +55 11 95976-5031, WABA `102067872689175`, Phone Number ID `109293361953640`, app "CaliColors Integracao API". Ver seção própria abaixo.
3. **Dualhook (Webhook Override)** — 2026-09-05, canal atual pro número em Coexistence. IDs novos da conexão: Phone Number ID `1220273824510260`, WABA `1320667299892030` — **defaults do código foram atualizados pra esses** (2026-09-05; sem as envs, o app apontava pro registro antigo e o recebimento falhava em SILÊNCIO — ver seção "Defaults dos IDs" abaixo).

---

## Evolution API self-hosted (2026-08-28) — canal ÚNICO até a Meta autenticar

Evolution API self-hosted (Baileys) em Docker no Render FREE (`https://evolution-api-8arv.onrender.com`, Manager em `/manager`; dormia ~15min → 1ª request pós-sono até 50s; DB no schema `evolution_api` do Supabase). Instância `meu-whatsapp` conectada ao número SECUNDÁRIO +55 11 92072-5935 (o oficial +55 11 95976-5031 ficava reservado pra Cloud API da Meta, que ainda não tinha autenticado).

Service `lib/api/_services/whatsapp-evo.ts` (config + `sendEvolutionText` com timeout 55s pro cold start + `jidToPhone` + `parseEvolutionWebhook`); webhook `POST /api/whatsapp-evo/webhook?token=<EVOLUTION_WEBHOOK_TOKEN>` (Evolution não assina eventos → segredo na URL; pós-token sempre 200; evento `MESSAGES_UPSERT`; `fromMe`→'out'; grupos ignorados; grava na MESMA `whatsapp_messages` → aparece em /admin/whatsapp). A rota `/api/whatsapp/send` **DESPACHAVA**: texto → Evolution quando configurada (senão Meta); template → SÓ Meta (503 amigável sem ela).

4 ENVS no CF Pages (configuradas em 2026-08-28, confirmadas pelo ping): `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` (= AUTHENTICATION_API_KEY do Render, secret), `EVOLUTION_INSTANCE` (opcional, default `meu-whatsapp`), `EVOLUTION_WEBHOOK_TOKEN` (string aleatória nossa, secret). Depois do deploy: configurar a URL do webhook no Manager (Configurations → Webhook, evento MESSAGES_UPSERT). 21 testes em `__tests__/services/whatsapp-evo.test.ts`.

### Causa do "502 Bad gateway" no envio (2026-08-28, fechada)
Era número ESTRANGEIRO tratado como BR. O envio usava `normalizeBrPhone`, que cola '55' em qualquer coisa com 10-11 dígitos → contato dos EUA `16503154274` (+1 650 315-4274) virava `5516503154274`, inexistente; o Baileys pendurava tentando resolver o JID e o CF matava a function ANTES de qualquer resposta nossa (por isso o 502 cru, com o diagnóstico do edge todo verde). Corrigido: envio passa a usar `normalizeWhatsAppTarget` (BR local ganha 55; **11 dígitos só é celular BR se o 3º for 9**; 11-15 dígitos em outro formato = DDI estrangeiro, passa VERBATIM). `fmtWaPhone` do portal e o "+" (nova conversa) seguem a mesma regra. **NÃO usar `normalizeBrPhone` no caminho da Evolution.**

### SQL Wave 45 (2026-08-28) — JÁ EXECUTADA no Supabase (2026-08-29)
`/migrations/2026-08-28-whatsapp-realtime.sql`: põe `whatsapp_messages` na publication `supabase_realtime` (+ REPLICA IDENTITY FULL). Sem ela a aba do portal só descobria mensagem nova no poll; com ela, o banco AVISA e a mensagem entra em ~1s. Realtime respeita RLS → só `is_portal_admin()` recebe evento. A tela já estava pronta (v=20260828m): subscribe em INSERT + poll de 60s como rede de segurança + `setMsgs` só troca o array quando MUDOU (matava a "piscada" do poll) + auto-scroll só se o operador já estava no fim + eco local otimista no envio.

### Diagnóstico
`GET /api/whatsapp-evo/ping` (admin-only) mede conectividade + apikey + estado da instância a partir do edge e reporta as envs sem vazar segredo. O botão "🔌 Testar conexao" saiu da tela do portal em 2026-08-29 (era ferramenta do 502 do envio, já resolvido) — a rota continua no ar, chamar direto com token de admin se precisar.

### Render virou PAGO (2026-08-29) — não dorme mais
Starter US$7/mês. O plano free dormia com 15min parado e derrubava a conexão do WhatsApp junto (o pior efeito; a lentidão de ~50s era só o sintoma visível). O keep-alive por cron do GitHub (`.github/workflows/keepalive-evolution.yml`) foi **removido**: além de nunca ter disparado nenhuma execução AGENDADA, o histórico do outro cron `*/10` deste repo (o "Uptime monitor", 1118 runs) mostra o que o agendador do GitHub entrega de verdade — 12 a 36min de intervalo de dia e **45 a 79min de madrugada**, contra os 15min de sono do Render. Ou seja: não resolveria. **Não recriar esse workflow.** O pré-aquecimento do portal (`aquecerEvolution`, v=20260829b) FICOU nesse momento: cobria os segundos de reinício pós-deploy do Evolution, e `acordarEvolution` virou fallback que praticamente nunca espera (TTL de 5min). Mantido também o `SEND_TIMEOUT_MS` de 25s.
*(Nota: em 2026-09-05, com a migração pro Dualhook, esse aquecimento foi REMOVIDO de vez — ver seção Dualhook abaixo.)*

### "502 Bad gateway" VOLTOU no envio — agora na ABORDAGEM DE LEAD (2026-08-31)
Não era a mesma causa de 28/08 (número estrangeiro): o telefone do caso (`11 96268-0094`) é celular BR e passava correto pelo `normalizeWhatsAppTarget`. A página de 502 é do PRÓPRIO Cloudflare — a function do edge morreu antes de responder. Duas falhas de estrutura, as duas corrigidas:

- **A rota não tinha ORÇAMENTO TOTAL.** Cada hop tinha o seu teto (auth 10s + rate limit 10s + envio 25s + gravar 8s + audit 5s = **até 58s**), mas ninguém somava — e o CF mata a function bem antes disso. Fix: `ROUTE_DEADLINE_MS` de 22s embrulha o handler inteiro (`Promise.race`, responde 504 explicando em vez de deixar o CF responder HTML cru), `SEND_TIMEOUT_MS` caiu de 25s → **14s**, e gravar+audit passaram a rodar **em paralelo** com teto próprio de 6s (`BOOKKEEPING_BUDGET_MS`). Escrituração depois do envio era caminho real pro 502 **com a mensagem já entregue** — o operador via "falhou" e mandava de novo. **REGRA: rota de edge = orçamento total, não só timeout por hop.**
- **A abordagem nunca aquecia a Evolution.** `aquecerEvolution`/`acordarEvolution` viviam DENTRO do componente da tela de WhatsApp; a `AbordagemModal` (aba Leads) chamava `/api/whatsapp/send` direto, com o servidor possivelmente frio, e pagava o cold start DENTRO do edge — exatamente o que a arquitetura diz que só o navegador pode fazer. As duas funções subiram pra escopo de MÓDULO (estado compartilhado: aquecer numa tela vale na outra); o modal aquece ao abrir (enquanto o operador lê o texto) e mostra "Acordando o servidor…" antes de enviar. **REGRA: tela nova que chama `/api/whatsapp/send` chama `acordarEvolution` antes.**
- **Bônus: o erro de timeout deixou de mentir.** Dizia sempre "o Render dorme após 15min" — falso desde 29/08 (plano pago). Agora, ao estourar, o service sonda `GET /instance/connectionState/<instância>` (4s) e diz a causa: `close`/`connecting` → "reconecte o QR no Manager" (aí o Baileys pendura pra sempre e timeout maior não resolve); `open` → "só lentidão, a mensagem NÃO saiu, tente de novo". 4 testes novos.
- **Ainda não confirmado qual dos dois gatilhos disparou** (Render frio × sessão do WhatsApp caída) — sem acesso ao banco nem à rede daqui. O próprio erro passa a dizer na próxima vez. Diagnóstico manual: `GET /api/whatsapp-evo/ping` com token de admin.

---

## WhatsApp Cloud API — LIVE ponta a ponta (2026-08-25)

O número oficial (+55 11 95976-5031) foi ativado na Cloud API da Meta (WABA `102067872689175`, Phone Number ID `109293361953640`, app "CaliColors Integracao API"). Service em `lib/api/_services/whatsapp.ts` (builders puros + `sendWhatsAppText/Template` + `verifyMetaSignature` + `parseInboundMessages`); rotas `/api/whatsapp/send` (admin-only, mesmo gate do `/api/admin/users`, rate limit 30/min, audit_log com preview de 80 chars) e `/api/whatsapp/webhook` (GET verificação + POST autenticado por `WHATSAPP_WEBHOOK_AUTH_MODE`: `payload` (default, Dualhook — valida WABA + phone_number_id do envelope via `isExpectedWebhookPayload`) ou `hmac` (app próprio — `X-Hub-Signature-256` com `META_APP_SECRET`); pós-autenticação sempre 200, anti-retry-storm igual mp-webhook). Testes em `__tests__/services/whatsapp.test.ts`. Doc: `docs/WHATSAPP_CLOUD_API.md`.

### SQL Wave 38 — JÁ EXECUTADO no Supabase (2026-08-25)
`/migrations/2026-08-25-whatsapp-messages.sql`: tabela `whatsapp_messages` (direction in/out, `message_id` UNIQUE pra dedupe de retry da Meta, RLS SELECT só `is_portal_admin()`, escrita só service_role). Webhook grava inbound e `/api/whatsapp/send` grava outbound via `persistWhatsAppMessage` (best-effort — falha nunca custa o 200 do webhook nem a mensagem enviada; sem a tabela, tudo segue funcionando só com log). Tela `/admin/whatsapp` (RSC guard `requireAdminServer` + `WhatsAppAdmin` client): lista em estilo conversa (poll 15s), filtros in/out, form de envio de texto livre e botão "Responder". **NÃO misturar com a tabela `messages` do chat interno** (user↔user, FK em profiles) — aqui o interlocutor é telefone externo.

### Access token
O access token NÃO está no código (IDs públicos são default; token só via env). Se o token vazar/expirar (erro 190 do Graph): regenerar no painel Meta e trocar só a env + redeploy.

---

## Dualhook (Webhook Override, 2026-09-05)

O webhook do número em Coexistence passou a ser registrado via Dualhook. Nesse fluxo o `X-Hub-Signature-256` é assinado pelo app Meta **DO DUALHOOK** (secret não exposto) → HMAC com `META_APP_SECRET` nunca bate; por isso o modo `payload`.

IDs da conexão Dualhook: Phone Number ID `1220273824510260`, WABA `1320667299892030` (≠ defaults antigos do código, que eram do número +55 11 95976-5031) → precisam das envs `WHATSAPP_PHONE_NUMBER_ID` e `WHATSAPP_WABA_ID` no CF Pages. Como os IDs são públicos, o modo `payload` TAMBÉM exige `WHATSAPP_WEBHOOK_URL_SECRET` no `?token=` da URL cadastrada no Dualhook (fail-closed sem ela) — payload sozinho não autentica. `WHATSAPP_WEBHOOK_VERIFY_TOKEN` = Verify Token gerado pelo Dualhook (trocado no CF Pages + redeploy + GET verificado em 2026-09-05).

**`WHATSAPP_WEBHOOK_URL_SECRET` gerado em 2026-09-05** (`openssl rand -hex 24`, 48 hex). O VALOR vive só no painel do CF Pages (marcado como Secret) e colado no fim da URL cadastrada no Dualhook — **nunca neste arquivo nem em lugar nenhum do repo**, mesma regra do keystore e do access token da Meta.
- **É um PAR: os dois lados têm que ser idênticos.** Trocar o segredo no CF Pages sem reeditar a URL no Dualhook (ou o contrário) derruba o recebimento — o endpoint responde 401 "token inválido" e a mensagem não chega. Pra rotacionar: gerar o novo, colar nos DOIS, redeploy.
- Perdeu o valor? Não dá pra recuperar de lugar nenhum: gera outro e atualiza os dois lados. **Não há nada que dependa do valor antigo.**

### Envio também pelo Dualhook desde 2026-09-05
`sendWhatsAppMessage` faz `POST https://api.dualhook.com/v25.0/<phone_number_id>/messages` com `Authorization: Bearer DUALHOOK_API_KEY` (env nova, Secret). O `WHATSAPP_ACCESS_TOKEN` e o `graph.facebook.com` SAÍRAM do caminho de envio: o número em Coexistence é gerenciado pelo app Meta DELES, e o token do nosso app não tem permissão nesse `phone_number_id`.
- O Dualhook **espelha o contrato da Cloud API** — mesmo path, mesmo corpo, mesma forma de erro —, então os builders de payload (`buildTextPayload`/`buildTemplatePayload`) não mudaram.
- **401/403 SEM `code` também vira erro de credencial.** O Dualhook recusa a API key com um 401 próprio, que não carrega o `code: 190` da Meta; sem essa ramificação a mensagem mandaria quem depura olhar o painel da Meta, que não é mais onde a credencial vive.
- **REGRA: falha de envio NUNCA responde 502 nem 504.** O Cloudflare substitui o corpo dessas duas pela própria página de erro DELE, e a explicação se perde. 4xx do Dualhook → **400**; 5xx e falha de rede → **500**; os dois com `{ error, upstreamStatus }` no corpo. O `deadlineResponse` da rota (orçamento de 22s) também deixou de ser 504 pelo mesmo motivo. 131047 fica em 422 e config ausente em 503 — nenhum dos dois é sequestrado pelo CF.
- Toda falha loga `dualhook_send_failed { status, body }` com o corpo CRU. O corpo é lido como texto ANTES do parse: resposta não-JSON (HTML de proxy, corpo vazio) é o caso que mais precisa ser visto, e `res.json()` o engoliria.
- O portal já exibe o `error` na faixa "Falha no envio" (lê `res.error` do JSON) — não precisou de mudança, e por isso o `app.js`/SRI do portal ficou intocado.

### Aquecimento da Evolution REMOVIDO do portal (2026-09-05)
A tela de WhatsApp e a abordagem de lead cutucavam `https://evolution-api-8arv.onrender.com` antes de cada envio — ao abrir, a cada 5min e A CADA TECLA digitada. Aquilo existia porque a Evolution dormia no plano free do Render; o Dualhook é gerenciado, não há o que acordar. O que sobrava era uma chamada a um host morto atrasando o envio e exibindo "Acordando o servidor…" sem motivo. Removido inteiramente.

### Defaults dos IDs apontavam pro registro antigo (2026-09-05)
O telefone é O MESMO de sempre; o que mudou ao entrar em Coexistence foi o REGISTRO — a Meta emitiu `phone_number_id` e WABA novos pro mesmo aparelho. Os defaults do código seguiam nos antigos (`109293361953640` / `102067872689175`), então SEM as envs no painel: o envio ia pra um número que não é nosso, e o webhook recusava **toda** entrega com 403.
- **O modo de falha do recebimento é SILÊNCIO**, não erro: o 403 vai pro Dualhook, o portal simplesmente não mostra nada, e não há mensagem em lugar nenhum dizendo por quê. Um default errado não falha — ele mente.
- Defaults agora são os da conexão Dualhook (`1220273824510260` / `1320667299892030`), travados por teste. As envs seguem podendo sobrescrever; a diferença é que o caminho SEM env passou a ser o certo.
- O log da recusa passou a nomear os DOIS lados (`resumirEnvelope`): recebido × esperado. IDs são públicos, e essa linha é a única pista que sobra quando a entrega some.

### Bug crítico corrigido: webhook respondia 500 — `waitUntil` chamado SOLTO (2026-09-05)
**CORRIGIDO E CONFIRMADO EM PRODUÇÃO pelo usuário no mesmo dia:** a mensagem chega no portal. Isso fecha a corrente inteira do recebimento (segredo de URL → envelope → parse → `persistWhatsAppMessage` → `whatsapp_messages` → tela), que até então nunca tinha sido provada ponta a ponta — o 500 mascarava tudo que vinha depois dele.

Em produção o log mostrava a mensagem já reconhecida (`msg de ... preview="oiii"`) e logo depois `TypeError: Illegal invocation: function called with incorrect \`this\` reference`. Causa: `runAfterResponse` fazia `const waitUntil = ctx?.waitUntil` e chamava `waitUntil(seguro)`. O ExecutionContext do workerd é NATIVO: sem o `this` certo ele lança — e lança de forma **SÍNCRONA, dentro do handler**, então o erro não ficava contido no trabalho de fundo, ele derrubava a resposta.

- **REGRA: método de API nativa se chama NO OBJETO DONO.** Vale pra `ctx.waitUntil`, `crypto.subtle.*`, `fetch`, `TextEncoder` — extrair pra variável ou passar como callback solto quebra no edge. Varredura no repo: não há outro caso.
- **O teste antigo não pegava e isso é a lição de método.** Um `vi.fn()` dentro de objeto literal é função JS comum, que não liga pro `this`; só um objeto que EXIGE o `this` reproduz. Os testes agora usam isso.
- **Faltava teste NO NÍVEL DA ROTA** — o unitário do helper não cobria "a Meta recebe 200 aconteça o que acontecer". `__tests__/api/whatsapp-webhook.test.ts` trava o 200 com o `waitUntil` recusando e com o atendimento automático lançando. Confirmado que os dois falham com o código antigo.

### Evento que NÃO é de mensagem responde 200, não 403 (2026-09-05)
A Meta manda `message_template_status_update`, `account_update` e afins no MESMO webhook. Todos caíam em 403 — e 403 pra ela significa "não entreguei", então ela **reenviava indefinidamente** um evento que nunca íamos processar. `classifyWebhookPayload` devolve três desfechos: `processar` (nosso WABA + `field='messages'` + nosso número), `ignorar` (nosso WABA, sem change de mensagem → 200 sem trabalho — antes dava 403 e causava retry-storm da Meta), `rejeitar` (outra conta ou malformado → 403 de verdade). **Mensagem endereçada a OUTRO número continua `rejeitar`**: ali não é "evento que não me interessa", é entrega no endereço errado, e engolir com 200 esconderia erro de configuração.

## Janela de 24h da Meta
Texto livre só pra quem escreveu nas últimas 24h; fora dela o Graph/Dualhook devolve 131047 e a rota responde 422 "use um template aprovado". Abordagem de lead (quem nunca escreveu) sai **só como template** — o `AbordagemModal` removeu inteiramente a aba "texto livre" (2026-09-05, decisão do usuário): abordagem é sempre 1ª mensagem, então texto livre nunca ia enviar nada. Ver [[WhatsApp - IA, Follow-up e Leads]] pro impacto disso no follow-up automático (que fala com quem sumiu, quase sempre fora da janela).

### Armadilha de teste: arquivo "skipped" é verde na contagem (2026-09-05)
`__tests__/portalJanela24h.test.ts` lê o FONTE do portal (que não tem módulos) e avalia o trecho com `new Function`. Ao inserir um componente JSX dentro do trecho extraído, o parse quebrou e o vitest reportou o arquivo como **skipped** — `Tests 1619 passed | 12 skipped`, e quase foi mergeado olhando só a contagem de testes. **REGRA: conferir a linha `Test Files`, não só `Tests`.** Suíte com arquivo falhando ainda soma "passed" nos outros. A extração agora usa marcadores nomeados (`// [teste:janela-inicio]` etc.) e há um teste que falha ALTO se um marcador sumir ou se entrar JSX entre eles — ele não depende da extração, então sobrevive ao acidente que precisa denunciar.

## Templates aprovados
- `GET /api/whatsapp/templates` consulta a Meta via Dualhook (`/{WABA}/message_templates`), filtra `APPROVED`, devolve nome/categoria/idioma/corpo/variáveis; cache de 5min no isolate. O portal cai na lista embutida se a consulta falhar. **Lista à mão envelhece igual lista de pendência** — e se o nome mudar no painel, o envio quebra com 132001 enquanto a tela mostra o nome velho.
- `<EnvioDeTemplate>` monta um campo por variável, prévia com os valores já substituídos e botão travado enquanto faltar variável.
- Templates conhecidos: `calicolors` (fixo, sem variável), `calicolors_nome` (`{{1}}`=primeiro nome, padrão quando o de cidade não tem prova de existir), `calicolors_abordagem_v2`/3-variáveis (`{{1}}` nome completo, `{{2}}` cidade, `{{3}}` ramo — opt-in). Detalhe completo da escolha de template e das variáveis de abordagem: [[WhatsApp - IA, Follow-up e Leads]].
- **Regra: nunca mandar `{{1}}` vazio.** `escolherTemplate`/`primeiroNome` recusam nome vazio, telefone no lugar do nome, inicial solta — **mesma regra replicada nos DOIS lados** (server `whatsapp.ts` + portal), testada pra não divergir.
- **Aviso de MARKETING pra número dos EUA** (regra NANP: código de área nunca começa com 0/1 — desempate necessário porque "11 dígitos começando com 1" sozinho também casa com celular de SP sem DDI) — não bloqueia, exige confirmação. A Meta não entrega esses templates pra número americano (volta `failed` 131049).
- **132001** (template inexistente/não aprovado) vira 422 com texto acionável apontando pro painel do Dualhook — o detalhe da Meta é genérico e manda procurar no lugar errado.

### Armadilha: `route.ts` do Next só aceita exports fechados (2026-09-05)
Exportar um helper de um arquivo de rota quebra o build com `"X is not a valid Route export field"` — e **nem `tsc` nem vitest pegam**, só o `next build`. Derrubou o deploy do #227 (durante o trabalho de expor os templates). Função pura de rota vai pra `lib/api/_services/`. Vale também pra `runtime`: o Next **não** reconhece o campo re-exportado de outro arquivo (avisa e usa o default, tirando a rota do edge). **REGRA: rodar `next build` antes de subir mudança estrutural de rota.** Suíte verde e tsc limpo não provam que o deploy vai passar.

## Status de entrega (Wave 58, 2026-09-05 — SQL executado)
`/migrations/2026-09-05-whatsapp-delivery-status.sql` (3 `ALTER TABLE` de uma linha, confirmado pelo usuário). Motivo: um template de abordagem foi enviado com sucesso (o portal registrou) e não apareceu no celular do cliente — e não havia como separar "número sem WhatsApp" de "recusou marketing" de "limite da Meta". Os três produzem o MESMO silêncio.
- A Meta manda esses avisos no MESMO webhook das mensagens (`field='messages'`, com `statuses` no lugar de `messages`). Eles já passavam pela validação do envelope e eram **descartados**: `parseInboundMessages` devolvia lista vazia e nada mais olhava o payload.
- `parseStatusUpdates` + `persistStatusEntrega` (PATCH por `message_id`, que já é UNIQUE; não cria linha). Bolha mostra ✓ / ✓✓ / ✓✓ azul, e `failed` mostra **o motivo por extenso na bolha**, não só no tooltip.
- **`statusAvanca` impede o status de andar pra trás**: a Meta entrega fora de ordem e reenvia, e um `sent` atrasado sobrescreveria um `read`. `failed` é desfecho e vence tudo.
- **Tolera a coluna ausente nos DOIS lados** (servidor loga e segue; o portal refaz o `select` sem elas). Recurso novo não derruba o que já funcionava por SQL pendente — mesma lição de `quotes.post_id`/`leads.city`.

## Diagnóstico geral / rota atual de follow-up
Ver [[WhatsApp - IA, Follow-up e Leads]] para a rota `/api/whatsapp/followup` (autenticação, ponte com o token antigo, custo da janela de 24h no follow-up).

---
## Ver também
[[WhatsApp - IA, Follow-up e Leads]] · [[WhatsApp - Portal e Mídia]] · [[Leads - Importação e Funil de Abordagem]] · [[Segurança - Auditorias Externas (Webhooks e Integrações)]]
