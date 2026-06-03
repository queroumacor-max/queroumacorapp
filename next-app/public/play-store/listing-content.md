# Play Store — conteúdo da listing

Tudo abaixo é texto/asset que você copia/cola no Play Console. Limites
oficiais do Google já respeitados.

---

## 📛 Título (max 30 caracteres)

```
QueroUmaCor: Pintura PRO
```
(24 caracteres)

Alternativas se quiser testar:
- `QueroUmaCor — App de Pintores` (29)
- `QueroUmaCor: Orçamento + IA` (28)

---

## 📝 Descrição curta (max 80 caracteres)

```
Pintores, grafiteiros e funileiros: orçamento, agenda e portfólio com IA.
```
(72 caracteres)

---

## 📄 Descrição completa (max 4000 caracteres)

```
O QueroUmaCor é o aplicativo dos profissionais de pintura no Brasil.
Pintores, grafiteiros, muralistas, pintores automotivos e funileiros têm
em um só lugar tudo o que precisam pra trabalhar com mais cliente, mais
organização e mais lucro.

✨ DESTAQUES

⚡ Orçamento com IA — Crie orçamentos profissionais em minutos. O Seu Zé,
nosso assistente de IA, sugere preços baseado em metragem, tipo de tinta
e técnica. Gera PDF bonito com seu logo e dados, envia direto pro cliente
por WhatsApp, e-mail ou link.

📅 Pipeline e Agenda — Acompanhe cada orçamento do rascunho à conclusão.
Aprovação congela o escopo como referência. Projetos aprovados viram
automaticamente jobs na agenda. Calendário integrado pra você nunca mais
esquecer uma obra.

💰 Financeiro com IA — Receitas e custos por projeto, lucro líquido em
tempo real, análise mensal do Seu Zé com sugestões pra aumentar margem.
Lance custos de material tirando foto do recibo: IA lê, separa os itens e
preenche o valor.

📸 Portfólio + Feed — Suba fotos e vídeos do seu trabalho. Marque posts
como "à venda" (grafiteiros vendem suas artes). Curtidas, comentários,
compartilhamento — tudo realtime, como Instagram.

🎨 Arte pra Instagram com IA — Foto do seu trabalho vira post profissional
em segundos. 4 estilos diferentes (Profissional, Trabalho Finalizado,
Antes/Depois, Cinematográfico). Aplica seu logo. Gera legenda + hashtags
prontas.

🤖 Seu Zé — Assistente de IA que tira dúvidas de técnica, tinta,
preparação, preço. Conversa por texto ou voz. Treinado pra ajudar quem
trabalha de verdade.

🧮 Calculadora — Quantos litros de tinta? Quanto custa o material? Faça a
conta em segundos. Inclui estimativa de área por foto (IA).

🛒 Loja Cali Colors — Tintas premium, esmaltes, texturas e acessórios
direto pelo app. Pontos por compra, descontos exclusivos para PRO.

✅ Checklist de Obra — Não esquece nem um item. Templates por tipo de
serviço, marcação rápida no canteiro.

🔁 Reativar clientes (CRM) — Follow-up automático com clientes antigos.
O sistema lembra; você dispara quando faz sentido (PRO).

🎁 Programa de pontos — Cada R$10 gastos = 1 ponto. Convide amigo = 1
ponto. 1000 pontos = 1 mês PRO grátis, camiseta personalizada ou R$30
de cashback.

👥 Network entre profissionais — Veja trabalhos de outros pintores,
comente, siga, troque dicas. Marketplace de orçamentos pra clientes
encontrarem o pintor certo.

📝 Anotações — Lembretes de obra com áudio que vira texto (transcrição
IA). Salvo no seu perfil, sincroniza entre dispositivos.

⭐ PRO ilimitado — Por R$ 39/mês desbloqueia tudo: Seu Zé sem limite,
arte pra IG (2/dia), CRM, agenda avançada, financeiro com análise IA,
e pacote de compras adicionais (R$1/imagem extra).

🔒 SEGURANÇA E LGPD
- Conta protegida por autenticação segura (Supabase Auth)
- Dados criptografados em trânsito (HTTPS)
- Conformidade LGPD: exclusão de dados a qualquer momento
- Não vendemos seus dados

🇧🇷 FEITO NO BRASIL
Pra pintores brasileiros. Pagamento via Mercado Pago. Suporte por
WhatsApp em horário comercial.

Operado por CALICOLORS TINTAS LTDA — CNPJ 47.677.346/0001-92
Guarulhos, SP. Loja física + online desde 2019.

Baixe agora e comece a fechar mais orçamentos.
```
(~3.500 caracteres — dentro do limite)

---

## 📸 Screenshots — lista priorizada (8 telas)

Mínimo: 2 phone screenshots. Recomendado: 6-8 pra contar a história do app.
Tamanhos aceitos: 320–3840px, proporção 16:9 ou 9:16.

Dica: tira no celular real (Chrome em www.queroumacor.com.br) → DevTools
do Chrome desktop simula tamanhos (View → Toggle Device Toolbar → escolhe
Pixel 7).

### 1. **Feed (gancho social)**
- Tela: `/feed` ou `/`
- O que mostrar: feed com 2-3 posts, stories no topo, badge ADMIN
- **Caption sugerida**: "Rede social de pintores profissionais"

### 2. **Tile Meu Negócio**
- Tela: `/perfil` rolado pra baixo
- O que mostrar: grid completo de 16 tiles ("Meu Pedido", "Orçamento",
  "Calculadora", "Agenda", "Financeiro", "Seu Zé"...)
- **Caption**: "Tudo o que você precisa em um só lugar"

### 3. **Orçamento — preview do PDF**
- Tela: `/orcamentos/[id]` → clica em "🖨️ Visualizar"
- O que mostrar: o `QuotePdfSheet` aberto, com logo + dados + valor destacado
- **Caption**: "Orçamentos profissionais com seu logo + dados"

### 4. **Seu Zé chat**
- Tela: tile "Seu Zé" aberto no perfil
- O que mostrar: 2-3 mensagens de troca (pergunta sobre tinta, IA responde)
- **Caption**: "Tira dúvidas com IA treinada pra pintura"

### 5. **Arte pra IG — resultado**
- Tela: `/arte-ig` após gerar uma arte
- O que mostrar: a arte gerada + caption + hashtags
- **Caption**: "Foto comum vira post profissional em segundos"

### 6. **Financeiro Dashboard**
- Tela: tile "Financeiro" no perfil
- O que mostrar: cards Receita / Custos / Lucro, gráfico, lista de lançamentos
- **Caption**: "Lucro em tempo real, análise mensal do Seu Zé"

### 7. **Calculadora**
- Tela: tile "Calculadora"
- O que mostrar: campos preenchidos + resultado em litros + R$
- **Caption**: "Calcule tinta e material em segundos"

### 8. **Loja Cali Colors**
- Tela: `/loja`
- O que mostrar: grid de produtos + carrinho
- **Caption**: "Materiais premium direto pelo app"

---

## 🖼️ Feature graphic (1024×500 PNG)

Arquivo SVG fonte: `/next-app/public/play-store/feature-graphic.svg`

**Como converter pra PNG:**
- Online (mais fácil): https://svgtopng.com → cola o SVG → baixa PNG
- CLI Linux: `rsvg-convert -w 1024 -h 500 feature-graphic.svg -o feature-graphic.png`
- Inkscape: File → Export PNG → 1024×500

---

## 🎯 Categoria + Tags

- **Categoria principal**: Empresarial (ou Produtividade)
- **Tags / palavras-chave**:
  - pintura
  - pintor
  - orçamento
  - grafite
  - artesão
  - autônomo
  - construção civil
  - app de obra
  - marketplace
  - inteligência artificial

---

## 🌎 Países disponíveis

Recomendação inicial: **só Brasil**. Depois de tração você adiciona
Portugal, Argentina, etc.

---

## 📋 Outros campos do Play Console

| Campo | Valor |
|---|---|
| Site do app | https://www.queroumacor.com.br |
| Email de contato | loja@calicolors.com.br |
| Telefone (opcional) | (11) 95976-5031 |
| Política de Privacidade | https://www.queroumacor.com.br/info/privacidade |
| Termos de Uso | https://www.queroumacor.com.br/info/termos |
| Classificação etária | 18+ (ou Pegi 12 / Livre — formulário decide) |
| Anúncios | Não |
| Compras dentro do app | Sim (R$ 39/mês PRO + pacotes IA) |

---

## ⚙️ Data Safety form — respostas-cheat

| Coletado? | O quê | Por quê | Compartilhado? |
|---|---|---|---|
| ✅ | Nome, email, telefone | Conta + comunicação | Não |
| ✅ | Foto perfil/portfólio | Funcionalidade do app | Não |
| ✅ | Chat messages | Comunicação entre users | Não |
| ✅ | Atividade in-app | Funcionalidade | Não |
| ✅ | Cidade/estado | Busca por proximidade | Não |
| ✅ | Crash logs | Diagnóstico | Sim → Sentry |
| ❌ | Localização GPS precisa | — | — |
| ❌ | Dados de cartão | (MP processa, não armazenamos) | — |
| ❌ | Microfone (sem voz salva) | — | — |
| ❌ | Contatos | — | — |
| ❌ | Histórico de navegação | — | — |

- **Dados encriptados em trânsito**: SIM (HTTPS obrigatório)
- **Usuário pode pedir exclusão**: SIM (DPO: loja@calicolors.com.br)
- **Conformidade com Family Policy do Google**: NÃO (app é 18+)
