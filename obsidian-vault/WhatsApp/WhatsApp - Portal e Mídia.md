---
tags: [whatsapp, portal, performance, mídia]
---

# WhatsApp — Aba do Portal, Performance e Mídia Recebida

## Performance (2026-09-13, "57014: statement timeout")
SQL `/migrations/2026-09-13-whatsapp-perf.sql` — JÁ EXECUTADO (confirmado pelo usuário em 2026-09-16: as 5 linhas de conferência voltaram `ok=true` — policy avaliada 1x, e as funções `whatsapp_conversas`/`whatsapp_nao_lidas`/`leads_por_telefone` e o índice `idx_whatsapp_messages_created_id` existem). Não pedir pra rodar de novo.

**A causa não era o volume; era a RLS.** As policies de `whatsapp_messages`/`whatsapp_ai_state`/`portal_alerts`/`whatsapp_ai_config` tinham `USING (is_portal_admin())` SOLTO. A função é SECURITY DEFINER (não inlina), então o Postgres a chamava UMA VEZ POR LINHA — cada chamada um SELECT em `profiles`. Um `count:'exact'` sobre 90 dias virava dezenas de milhares de consultas escondidas e passava dos 8s do `statement_timeout` do papel `authenticated`. Fix: `USING ((SELECT is_portal_admin()))` — InitPlan, avaliada UMA vez por statement. Mesma regra, mesma segurança. **REGRA: função em policy de RLS vai SEMPRE embrulhada em `(select …)`.** Vale pra qualquer policy nova com `is_portal_admin()`.

- **Índices novos:** `(created_at desc, id desc)` (ordem exata da paginação — o índice só de `created_at` reordenava o recorte inteiro a cada página), `delivery_status_at` parcial (o poll filtra por `OR`) e `(wa_id, created_at) where direction='in'` (não lidas).
- **A coluna de conversas vem de um RESUMO no banco**: `whatsapp_conversas(p_desde)` devolve UMA linha por número (última mensagem inteira em `ultima` jsonb, nome, canal da última resposta, `nao_lidas`, chave/decisão/marca da IA) — a aba não baixa mais os 90 dias de mensagens; `msgs` fica pro histórico da conversa ABERTA e pro realtime. `montarConversas(resumos, msgs)` casa as duas fontes, `naoLidasDaConversa` decide quem conta (marca local mais nova que a do servidor = o operador acabou de abrir → conta na tela; senão vale o número do banco), `aplicarMensagemNoResumo` põe a mensagem do realtime no resumo sem esperar o poll. A função é plpgsql SECURITY DEFINER que ESTOURA 42501 pra quem não é admin — zero linhas seria lido pela tela como "não há conversas". `whatsapp_nao_lidas(p_desde)` é o número do badge do menu (antes: 30 dias de mensagens + a tabela de marcas a cada 45s). `leads_por_telefone(sufixos[])` + índice de expressão nos 8 últimos dígitos substitui o `phone ILIKE '%1234'` que varria 61 mil linhas por lote (SECURITY INVOKER: a RLS de `leads` segue valendo).
- **Fallback por `ehFuncaoAusente`** (42883/PGRST202): função ausente → caminho antigo (`loadTudo`, o badge no navegador, o ILIKE). Outro erro (42501, 57014) → aparece na tela com o código. "↻ Tentar de novo" tenta a RPC de novo (o SQL pode ter acabado de rodar).
- **Enviar recarregava os 90 dias A CADA MENSAGEM** (`load()` sem argumento depois do envio, nos dois caminhos). Agora `load(1)`; o teste proíbe o `load();` voltar ali. **Status de entrega chega por realtime UPDATE** (a bolha muda na hora em vez de esperar o poll de 60s — a REPLICA IDENTITY FULL da Wave 45 manda a linha inteira, ver [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]]). O `loadIa` de 30s deixou de baixar `whatsapp_ai_state` inteira quando o resumo está ativo (os campos já vêm nele).
- **Rota `/api/whatsapp/send`: escrituração DEPOIS da resposta.** Gravar a mensagem e o audit passaram pro `runAfterResponse` (`ctx.waitUntil`); só o vínculo wamid→lead (`vincularAbordagemAoLead`) ainda segura a resposta, com teto de 3s, porque o webhook da Meta precisa achá-lo. O portal mostra o envio pelo eco local e recebe a linha real pelo realtime segundos depois. Testes em `__tests__/portalWhatsAppNaoLidas.test.ts` (42 casos).

## Não lidas — filtro por pílula (2026-09-09)
Pedido do usuário: "botão de unread para ao clicar filtrar conversas que têm msg nova de cliente". Portal v=20260909m, SEM SQL. Pílula "● Não lidas (N)" embaixo da busca; ligada, a lista mostra só conversas com mensagem RECEBIDA depois do `whatsapp_ai_state.last_read_at` (a mesma regra do badge que já existia desde 2026-08-29, ver [[WhatsApp - IA, Follow-up e Leads]]). **N é de CONVERSAS, não de mensagens.** A busca procura DENTRO das não lidas. **A conversa ABERTA fica na lista** mesmo depois de marcada como lida (`manter` em `filtrarConversas`) — abrir zera o contador, e sem isso ela sumiria no mesmo clique que a abriu. Puras `contarNaoLidas`/`filtrarConversas` entre `[teste:wa-lista-inicio]`/`-fim` (só JS, sem JSX), testadas em `__tests__/portalWhatsAppNaoLidas.test.ts`, que também trava que `naoLidas`/`convsFiltradas` da aba passam por elas. Item novo em `AJUDA_WHATSAPP`.

### "A lista era as últimas 500 mensagens e conversas se perdiam" (mesmo PR, 2026-09-09)
Pergunta do usuário: "realmente aparecem todas as conversas ou algumas se perdem pelo limite?". Perdiam: `limit(500)` em `whatsapp_messages`, agrupado por número — um lote de abordagem ocupava as 500 linhas e toda conversa mais antiga sumia da aba (histórico e não lidas juntos), enquanto o badge do menu contava por outra consulta. Fix:
1. A aba baixa TODAS as mensagens dos últimos `WA_DIAS_LISTA` (90) dias com `buscarEmPaginas`, emendadas por id (`mesclarMensagens`, devolve o MESMO array se nada mudou; linha com status de entrega novo é atualização — antes o ✓✓ só aparecia quando chegava mensagem nova); o poll de 60s só pede 1 dia (`created_at` OU `delivery_status_at`); o eco local do envio (`local-…`) some quando a linha real chega.
2. O histórico COMPLETO da conversa é buscado ao abrir (`conversasCarregadas`, uma vez por aba).
3. **Nome do lead pelo telefone da conversa**: o `limit(3000)` em `leads` (61 mil linhas) deixava quase todo lead abordado só com o número; `resolverLeads` pede `phone.ilike.*<4 últimos dígitos>` (contíguos em qualquer máscara) em lotes de 60 e casa pelos 8 últimos aqui.
4. `whatsapp_ai_state` (marca de leitura) e o badge do menu também sem teto.
5. A coluna renderiza no máximo `WA_LISTA_MAX` (300) conversas e avisa — um lote pode criar milhares.

`__tests__/portalWhatsAppNaoLidas.test.ts` proíbe os limites voltarem.

## Origem das mensagens (Wave 55, 2026-08-30, SQL executado)
`whatsapp_messages.origin` ('portal'|'ia'|'celular'): rota de envio grava `portal`; runner da IA + follow-up gravam `ia`; o webhook grava `celular` em toda 'out' que chega de fora (o eco do que portal/IA enviaram colide no `message_id` UNIQUE e o ignore-duplicates descarta — só sobra o que nasceu no aparelho). Portal (v=20260830a): chip 📱 celular / 🖥️ portal / 🤖 IA por conversa (lista + cabeçalho), **decidido pela ÚLTIMA 'out' com origem conhecida**; histórico sem pista fica sem chip. Backfill só do afirmável (`sent_by NOT NULL` = portal).

## Mídia recebida

### Origem histórica: Evolution API (Wave 49, 2026-08-29 — SQL já executado)
"MÍDIA do WhatsApp no portal" — o título da entrada original dizia PENDENTE contradizendo o próprio corpo; já estava executado desde 2026-08-29. Foto, áudio, vídeo e documento chegavam como MARCADOR de texto (`[áudio]`, `[imagem]`): o evento do WhatsApp não traz o arquivo, só o aviso. `whatsapp-media.ts` pega o base64 (do payload, se o Manager estiver com **Webhook Base64** ligado, senão busca em `/chat/getBase64FromMediaMessage`), sobe pro bucket PRIVADO `whatsapp-media` e grava o PATH em `whatsapp_messages.media_url` (path, não URL — assinatura expira). Portal (`BolhaConteudo`) pede URL assinada em lote (`createSignedUrls`, 1h) e renderiza foto com lightbox, player de áudio, vídeo e link de documento; a lista de conversas mostra a transcrição em vez de "[áudio]".
- **Áudio é transcrito** (Whisper, coluna `transcript`) e **entra no histórico que a IA lê** — antes ela respondia no vácuo quando o cliente mandava voz. `loadTurns` usa `transcript || body` e descarta marcador sem transcrição.
- Tudo best-effort: falha de download/upload/Whisper não impede a mensagem de ser gravada nem derruba o 200 do webhook.
- **O `readBody` do webhook subiu de 1MB pra 20MB** por causa disso: com Base64 ligado o ARQUIVO viaja dentro do JSON e infla ~37%. No limite antigo uma foto grande estourava e a mensagem INTEIRA era descartada (o catch devolve 200 sem gravar) — a foto da parede sumia do portal.
- Migration `/migrations/2026-08-29-whatsapp-media.sql` — executada, e "Webhook Base64" já ligado no Manager da Evolution.

### Cloud API / Dualhook (2026-09-05) — mecanismo diferente
A conversa mostrava `[audio]` e `[sticker]` secos: o webhook da Meta **não tratava mídia nenhuma**. Toda a Wave 49 acima foi escrita pra Evolution (base64 no próprio evento); o webhook da Cloud API/Dualhook nunca chamava `processarMidia`.
- **Na Cloud API o arquivo não vem no webhook**: vem um `id`, e os bytes se buscam em DOIS passos (`GET /{id}` devolve URL temporária; a URL entrega o arquivo). Os dois pedem o mesmo Bearer. `baixarMidiaCloudApi` faz isso; upload, transcrição e nome de arquivo reaproveitam a lógica da Wave 49.
- **O objeto da mídia vem numa chave com o NOME DO TIPO** (`audio`, `image`, `sticker`, `video`, `document`), não numa chave fixa — foi o detalhe que o parser teve que acertar.
- Legenda de foto/vídeo (`caption`) vira o corpo da mensagem; áudio continua sendo transcrito, entrando no histórico que a IA lê.
- Tudo best-effort: falhar deixa a mensagem com o marcador do tipo, que é pior que ter o arquivo e muito melhor que perder a mensagem.
- **Incerteza declarada:** a URL temporária costuma apontar pro CDN da Meta, e a nossa credencial é do Dualhook. Se o CDN recusar, o corpo da recusa vai pro log — é a única pista de que o caminho precisa de outra credencial.

## Resposta pelo celular, reação e edição na conversa (2026-09-09)
Relato do usuário: "não está aparecendo as mensagens respondidas pelo celular, e reaction e edits". Portal v=20260909d, SEM SQL. Três causas distintas:

- **Eco do celular vinha em OUTRO campo.** Em Coexistence, o que a loja manda pelo APP do WhatsApp chega no webhook como `field='smb_message_echoes'` com `value.message_echoes[]` (a contraparte é o `to`; o `from` é o próprio número da loja). `classifyWebhookPayload` só processava `messages` e respondia "ignorado" pro resto — a resposta dada no aparelho nunca existia no portal e a conversa parecia abandonada. `parseEchoMessages` lê esse campo; o webhook grava como `direction='out'` + `origin='celular'` (o chip 📱 já lia isso) e NUNCA chama a IA pra eco. O wamid UNIQUE descarta o eco do que saiu pelo portal/IA. **Incerteza declarada:** depende de o Dualhook repassar esse campo; se a resposta do celular seguir sem aparecer, é assinatura do lado deles.
- **`[reaction]`/`[edit]`/`[unsupported]` secos:** o parser só lia `text.body`. `textoDeReacaoOuEdicao` pega `reaction.emoji` (vazio = removeu a reação) e o texto novo de `edit.text.body`/`text.body` (formato da edição não é documentado pela Meta — best-effort, com `refMessageId` pro wamid alvo). `TIPOS_SEM_CONVERSA` (reaction, edit, unsupported, system) grava no histórico mas NÃO acorda a IA — responder a um 👍 com parágrafo seria loop de constrangimento.
- **Portal:** `rotuloDeTipo` (bolha + prévia da lista): "👍 reagiu a uma mensagem", "✏️ editou: …", e pra `unsupported` a explicação (enquete, contato, temporária — a API não repassa o conteúdo; ver no celular da loja). Testado em `portalAbordagemEntrega.test.ts`.

## Chats 3-Way (cliente + pintor + loja) — 2026-08-22
Não existe tabela de conversas: tudo é `messages` com `conversation_id` texto. Loja entra pelo banner dentro da conversa (`__STORE_ADDED__` marcador + saudação). Fix de RLS: policy de SELECT precisava de participante ESTRUTURAL (`POSITION(auth.uid()::text IN conversation_id) > 0`), não "tem mensagem sua nessa conversa" (permitiria vazamento — o convId é derivado de UUIDs públicos, qualquer um poderia inserir mensagem na conversa alheia e passar a ler). Atalho "🎨 Loja" na lista de conversas abre/cria direto. *(Este chat é o interno app↔app, não confundir com `whatsapp_messages` — mas o mesmo padrão de terceiro entrando numa conversa 1:1 se repete aqui.)*

## Modal "+ Nova conversa" — busca de contatos no banco (2026-09-05)
`prompt()` do Chrome saiu do "+ Nova conversa". Virou modal do portal com busca nos contatos que a loja já conhece (leads + perfis com telefone), validação do número à vista e campo de nome. **Contato novo é salvo em `leads`** (`source='portal'`) de propósito: tabela nova exigiria SQL e criaria duas listas de contato pra manter em sincronia. Os `prompt()` das abas de Pessoas continuam lá — outro fluxo, não foi tocado.

### Lista de contatos: busca NO BANCO + índice A-Z (2026-09-05)
A 1ª versão do modal trazia 500 leads + 500 perfis e filtrava em memória. Com **1072 leads**, quem estava fora dos primeiros 500 ficava INVISÍVEL pra busca — digitar o nome não achava nada, e a tela não dava pista de que faltava gente. **Lista truncada que se parece com lista completa é pior que lista vazia.** Fix: a busca consulta o banco (ilike em nome E telefone, 250ms de atraso) e há índice A-Z que também consulta — clicar numa letra não filtra o que já está na tela, senão sofreria do mesmo problema. A tela mostra o total e diz que está exibindo um pedaço.

## Templates com nome, follow-up de template e 132001
Detalhe completo das regras de template (`calicolors`, `calicolors_nome`, `calicolors_abordagem_v2`), variável `{{1}}` nunca vazia e aviso de marketing para número dos EUA: [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]]. Uso das variáveis especificamente na abordagem de lead (`{{2}}` cidade, `{{3}}` ramo): [[WhatsApp - IA, Follow-up e Leads]].

---
## Envio de texto otimista no portal (2026-09-23, PR #394, v=20260923a, SEM SQL)
A bolha só aparecia depois de `/api/whatsapp/send` responder (auth + Dualhook, alguns segundos) e o botão travava em "Enviando…". Agora `enviar` põe o eco na hora (`_envio:'enviando'`, 🕓), limpa o campo e não trava o botão; falha → eco vira "⚠ falhou", erro acima do campo e o texto volta pro input.

- `mesclarMensagens` não apaga eco que falhou e só casa eco com linha real criada até 2min antes dele (senão um "oi" antigo do mesmo contato apagaria o eco de um "oi" novo).
- Template segue com o fluxo antigo (botão com estágio).
- `app.js` recompilado pela receita (build do HEAD conferido idêntico antes); SRI e `?v=` (`20260921a`→`20260923a`) atualizados. Teste em `portalWhatsAppNaoLidas.test.ts`.

## Ver também
[[WhatsApp - IA, Follow-up e Leads]] · [[Performance - Índices, RPCs e Paginação]] · [[Portal - Pessoas, Produtos e Ferramentas]] · [[Leads - Importação e Funil de Abordagem]]
