---
tags: [empresa, dados-oficiais, cali-colors]
---

# Dados Oficiais — Cali Colors (operadora/dona do QueroUmaCor)

- **Razão social:** CALICOLORS TINTAS LTDA
- **CNPJ:** 47.677.346/0001-92
- **Endereço:** Est. Presidente Juscelino Kubitschek de Oliveira, 1071
- **Bairro:** Jardim dos Pimentas
- **Cidade/UF:** Guarulhos/SP
- **CEP:** 07.272-345

Usar em documentos legais (termos, privacidade, sobre), metadados de Play Console/App Store, headers de CNPJ no PDF de orçamento (pintor da Cali Colors), e identificação formal de controlador LGPD.

## Contato / atendimento / suporte
- **WhatsApp:** (11) 95976-5031 (formato wa.me: `5511959765031`)
- **E-mail:** loja@calicolors.com.br (mailbox ativa, responde)

Usar sempre que precisar de canal de atendimento/suporte no app ("Fale Conosco", exclusão de conta LGPD etc.). Configurado no objeto `SUPPORT` em `app.js`.

## Número de WhatsApp oficial
+55 11 95976-5031 — ver [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]] pra histórico de canais (Evolution → Cloud API → Dualhook) e por que o número secundário existiu temporariamente.

## Onde esses dados são usados no código
- Documentos legais: `next-app/app/info/privacidade/page.tsx`, `.../termos/page.tsx`, `.../sobre/page.tsx` (ver [[Pagamentos, PRO e Compliance Apple]] pra correção de 2026-09-06 que tirou o Mercado Pago da política de privacidade — a Cali Colors continua sendo o controlador LGPD dos dados independente do meio de pagamento).
- Contato/suporte configurado no objeto `SUPPORT` em `app.js` (portal vanilla) e reutilizado em qualquer "Fale Conosco"/exclusão de conta LGPD do app Next.
- CNPJ/endereço são também os dados que o wizard de orçamento (`QuoteWizard`) usa como fallback pro cabeçalho do PDF quando o pintor é da própria Cali Colors — ver [[Orçamentos (Quotes) - Wizard, PDF e Tabela ABRAPP]] (o perfil comum não tem coluna de CNPJ/CPF, só o pintor da loja tem esses dados fixos).

---
## Ver também
[[Pagamentos, PRO e Compliance Apple]] · [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]] · [[Orçamentos (Quotes) - Wizard, PDF e Tabela ABRAPP]] · [[Portal - Pessoas, Produtos e Ferramentas]]
