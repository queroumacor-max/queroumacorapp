---
tags: [orçamentos, quotes, pdf, abrapp]
---

# Orçamentos (Quotes) — Wizard, PDF e Tabela ABRAPP

## Múltiplos serviços por orçamento (2026-09-07)
`QuoteWizard`: cada serviço tem espaço, material e itens da Tabela ABRAPP próprios (não um Espaço/Material único). Seção começa VAZIA — bloco nasce do item escolhido (`servicoComItem`), nunca pré-montado com defaults que virariam afirmação falsa no PDF. Valor do item nasce vazio; sugestão da tabela fica ao lado com "Usar média". **Valor final: digitado > soma dos itens preenchidos > IA.**
Lógica pura em `lib/orcamentoServicos.ts`, testada — tela, PDF e WhatsApp usam a MESMA conta (`resumoDoServico`/`detalhesDoServico`/`descreverServico`).

## PDF no layout de referência (100% fiel à LP Decor Pinturas, 4 páginas)
Um modelo, dois renderizadores: `lib/orcamentoDocumento.ts` (`montarDocumento`, puro) faz a conta; `lib/pdf/quotePdf.ts` (jsPDF, o que o cliente recebe) e `OrcamentoDocumento.tsx` (HTML, prévia) desenham. O que o banco não tem vive em `quote_data` (número, visita técnica, endereço do cliente, desconto, laudo técnico, pagamento, PIX, descrição por item). Aprovar/Recusar são links `wa.me`, não há aprovação server-side.

## `quotes.post_id` — Wave 53
Coluna criada (SQL confirmado no banco em 2026-09-05, anotação antiga dizia "PENDENTE" errado por meses). "Enviar orçamento" morria com 42703 porque a RPC `create_quote_from_post` foi recriada gravando `post_id` antes de a coluna existir. **Regra: conferir schema real antes de escrever INSERT em SQL** — mesmo erro cometido 2x.

## Nome do cliente no orçamento (Wave 56)
Trigger BEFORE INSERT `trg_fill_quote_client_info` congela nome+telefone do perfil na ÉPOCA do pedido (não RPC — bloco grande corrompia colagem no celular).

## PDF: as duas causas de falha em produção, nomeadas
(1) Bucket `exports` existia mas policies da Wave 41 nunca tinham rodado (confirmado depois que rodaram); (2) GoTrue recusa token de sessão rotacionada enquanto Storage/PostgREST aceitam o mesmo token (só validam assinatura). Fix: rota `/api/quote-pdf-upload` com autenticação em dois degraus (service role como fallback do GoTrue recusado).

## Tabela de Preços ABRAPP
Ver [[Portal - Pessoas, Produtos e Ferramentas]] (seção dedicada).

---
## Ver também
[[Portal - Pessoas, Produtos e Ferramentas]] · [[Pagamentos, PRO e Compliance Apple]]
