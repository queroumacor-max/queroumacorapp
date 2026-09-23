# PRD — QueroUmaCor

> Product Requirements Document. Descreve **o que** o produto faz e **quais
> regras** ele obedece. O **como** está no [TRD](TRD.md); as telas no
> [APP_FLOW](APP_FLOW.md). Visão de uma página: [BRIEF](BRIEF.md).
>
> Status das funcionalidades: ✅ no ar · 🟡 parcial · ⏳ planejado.
> Escrito em 2026-09-23 a partir do código.

## 1. Objetivos

| # | Objetivo | Como medir (fonte) |
|---|---|---|
| O1 | Ser a ferramenta diária do profissional de pintura | Orçamentos criados/mês, uso de agenda/financeiro (`/portal` → Uso do app) |
| O2 | Conectar cliente e profissional | Pedidos de orçamento vindos de post/perfil (`quotes` com `client_id`) |
| O3 | Gerar venda para a Cali Colors | Pedidos da loja (`orders`), leads abordados que respondem (`leads.abordagem_status`) |
| O4 | Comunidade ativa | Posts, curtidas, comentários, seguidores por semana |
| O5 | Retenção via PRO | Resgates de PRO por pontos, uso de IA por plano (`ai_usage`) |

## 2. Personas

| Persona | Necessidade principal | Dor atual |
|---|---|---|
| **Pintor autônomo** | Fechar serviço e se organizar | Orçamento no papel, preço chutado, agenda no WhatsApp |
| **Grafiteiro** | Mostrar e vender arte | Portfólio disperso, sem canal de venda |
| **Funileiro/automotivo** | Vitrine + orçamento | Mesmo do pintor, ofício diferente |
| **Arquiteto/engenheiro** | Indicar profissional e ser achado | Precisa dos dois lados: contrata e presta |
| **Cliente final** | Achar profissional confiável perto | Indicação boca a boca, sem avaliações |
| **Operador Cali Colors** | Vender e atender | Leads sem acompanhamento, WhatsApp manual |

Papéis no código: `lib/roles.ts` (`pintor`, `grafiteiro`, `automotivo`
[sinônimo `funileiro`], `arquiteto` [sinônimo `engenheiro`], `cliente`;
`admin` à parte). Papel novo = uma entrada lá.

## 3. Escopo funcional

### 3.1 Conta e identidade ✅
- Cadastro em 3 passos (papel → dados → senha + termos) ou Google/Apple.
- Campos obrigatórios: nome, @tag, e-mail, telefone, data de nascimento,
  estado e cidade (IBGE). **Foto opcional** (decisão deliberada: no Android
  a galeria pode matar o app).
- Login social cai em `/completar-perfil` (categoria + @tag).
- Perfil incompleto é redirecionado para completar em qualquer tela.
- Editar perfil, especialidades por papel, raio de atendimento, links
  (Instagram/site), logo do negócio.
- Exclusão de conta (app e página pública `/delete-account`).

**Regras**
- R-1: idade mínima **18 anos** (`MIN_AGE`), validada no cliente e por
  CHECK no banco para quem declara data real.
- R-2: publicar, comentar e mandar mensagem exigem **e-mail confirmado**
  (checado no app e na RLS).
- R-3: `role='admin'`, `is_pro`, `portal_access`, `verified` não podem ser
  alterados pelo próprio usuário (trigger no banco).

### 3.2 Rede social ✅
- Feed com filtros por papel, stories de 24h, posts com até **5 fotos**
  (carrossel) ou vídeo, enquadramento (original/1:1/4:5/16:9).
- Curtir, comentar, salvar, compartilhar, seguir, bloquear, denunciar.
- Menções `@user`, hashtags `#tag`, links clicáveis.
- Explorar (em alta na semana), busca unificada (profissionais, posts,
  produtos), sugestões de quem seguir.
- Selo verificado; destaque de post por 7 dias (PRO).
- Notificações in-app + push (nativo FCM e web push).
- Undo de 10 s em exclusões (soft delete, recuperável por 30 dias).

**Regras**
- R-4: toda mídia passa por moderação de IA antes de publicar; foto em
  blocklist de hash (CSAM) é recusada sempre.
- R-5: bloqueio vale nos dois sentidos para mensagem, follow, curtida e
  comentário (aplicado na RLS).
- R-6: só profissionais marcam post "à venda" (cliente não).
- R-7: admin pode apagar post/comentário de qualquer pessoa.

### 3.3 Mensagens ✅
- Chat 1:1 em tempo real, anexos, envio otimista (instantâneo).
- **Chat 3-way**: o profissional adiciona a Cali Colors na conversa com o
  cliente; a loja responde pelo portal.
- Respostas automáticas configuráveis pelo profissional.
- Moderação de mensagem no servidor, depois do envio (reprovada some para
  os dois lados em segundos).

**Regras**
- R-8: 30 mensagens/min por par remetente→destinatário.
- R-9: push de mensagem nunca mostra o texto (só "Fulano enviou uma
  mensagem").

### 3.4 Orçamentos ✅
- Cliente pede orçamento a partir de post ou perfil.
- Profissional monta orçamento com **vários serviços**, cada um com itens
  da tabela de preços ABRAPP 2026 ou avulsos, espaço, material e acesso.
- PDF no layout de mercado (cabeçalho do profissional, cliente, visita
  técnica, serviços, descontos, laudo, pagamento, PIX, Aprovar/Recusar por
  WhatsApp).
- Pipeline: A orçar → Enviado → Aprovado → Em execução → Concluído/Recusado.
- Avaliação do serviço pelo cliente.

**Regras**
- R-10: a tabela de preços **sugere**; o valor digitado pelo profissional
  vence. Valor final = digitado > soma dos itens > sugestão da IA.
- R-11: desconto em R$ ou % por toggle (teclado numérico não tem `%`).

### 3.5 Ferramentas do profissional
| Ferramenta | Status | Plano |
|---|---|---|
| Agenda, Financeiro, Anotações (texto e áudio), Calculadora de tinta | ✅ | Grátis com limites / PRO |
| CRM (reativar clientes) | ✅ | PRO |
| Tabela de Preços ABRAPP 2026 | ✅ | Pintor/arquiteto |
| Portfólio | ✅ | Todos |
| Camisetas com logo, gerador de logo (IA) | ✅ | Todos |
| AR Grafite (projetar arte na parede pela câmera) | ✅ | Grafiteiro |
| Revista Click Rua | ✅ | Grafiteiro |
| Formação (cursos/certificados) | ✅ | Todos |
| Pontos e indicações | ✅ | Todos |

### 3.6 Assistentes de IA ✅
| Persona | Para | Plano |
|---|---|---|
| Seu Zé | Pintor, arquiteto | PRO |
| Fê | Grafiteiro | PRO |
| Senna | Automotivo | PRO |
| Alice | Cliente (decoração) | Grátis |

**Regras**
- R-12: cota mensal de IA por plano — grátis 30, PRO 500, admin ilimitado
  (`plan_limits`). Moderação tem cota própria (1000/mês) que não consome a
  do usuário.
- R-13: consentimento explícito antes do primeiro uso de IA.

### 3.7 Loja ✅
- Seleção de loja (tabela `stores`); hoje só a Cali Colors tem catálogo
  (~21 mil produtos), as outras mostram "Catálogo em preparação".
- Catálogo com busca, categorias, variantes de tamanho, Cores do Ano.
- Lista de pedido → "Enviar Lista" grava pedido `pending`.

**Regras**
- R-14: **nenhum pagamento dentro do app** (Apple 3.1.3(e)). A venda fecha
  com a loja por WhatsApp.

### 3.8 Plano PRO ✅
- Ativado trocando **1000 pontos = 1 mês** (instantâneo), ou manualmente
  pela loja no portal.
- Período de carência de 3 dias após vencer.
- 🟡 Cobrança recorrente via Mercado Pago existe no servidor, **sem tela**
  (desligada por decisão; não reativar sem revisar regra das lojas).

### 3.9 Portal da Cali Colors (back-office) ✅
- **Principal:** dashboard, avisos, chats 3-way, WhatsApp, orçamentos,
  moderação.
- **Pessoas:** listas por papel com edição, PRO, promoção a admin,
  exclusão.
- **Loja:** leads (60 mil+, importação CSV/Excel), lojas, pedidos,
  produtos, camisetas, cursos, Click Rua, marketing.
- **Dados:** uso do app, analytics, indicações, avaliações.

### 3.10 WhatsApp da loja 🟡
- Envio/recebimento pelo número oficial via Dualhook (Cloud API).
- Abordagem de lead **só por template aprovado** (fora da janela de 24h a
  Meta não aceita texto livre); envio em lote.
- Status de entrega (✓, ✓✓, lida, falhou com motivo) e lead só vira
  "contactado" com confirmação da Meta.
- IA de atendimento (horário comercial, teto de 30 respostas/dia por
  conversa, prompt editável no portal), mensagem de ausência, follow-up
  automático de hora em hora.
- 🟡 **Em aberto (2026-09-23):** nenhuma mensagem recebida chega desde
  2026-09-17. Diagnóstico entre Dualhook e o endpoint — ver
  `CLAUDE.md`.

**Regras**
- R-15: a IA **nunca** fala preço, desconto, condição ou orçamento — escala
  para humano (trava no prompt **e** em código).
- R-16: "PARE" ou "Não tenho interesse" tira o contato de toda automação.
- R-17: follow-up fora da janela de 24h exige template aprovado.

## 4. Requisitos não funcionais (resumo — detalhe no TRD)

- Mobile-first, funciona em WebView (Android/iOS) e navegador.
- Todo horário exibido em Brasília.
- Tela nunca fica presa em erro: auto-retry em 5xx, offline com aviso.
- LGPD: consentimento registrado, exportação e exclusão de dados, push sem
  conteúdo sensível.
- Segurança: RLS em todas as tabelas, rotas de IA autenticadas e com cota,
  webhooks autenticados.

## 5. Fora de escopo (decisões)

- Pagamento dentro do app (loja e PRO).
- Modo visitante (removido em 2026-06-18).
- Catálogo multi-loja real (exigiria `store_id` em produtos).
- Banner de "atualize o app" (adiado).
- WebIntoApp (descontinuado; casca é Capacitor).

## 6. Riscos e questões em aberto

| # | Item | Impacto |
|---|---|---|
| Q1 | WhatsApp não recebe mensagens desde 17/09 | Atendimento e leads parados |
| Q2 | Insert direto em `posts` via API pula a moderação | Conteúdo não moderado no feed |
| Q3 | Concentração de contas admin numa identidade só | Risco de takeover |
| Q4 | "Resize images from any origin" ligado no Cloudflare | Abuso de banda / phishing |
| Q5 | RPO/RTO não definidos | Recuperação imprevisível |
