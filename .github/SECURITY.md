# Política de Segurança

Este é o repositório do app QueroUmaCor / portal Cali Colors. Não é um
projeto open source aberto a contribuição externa — o relatório abaixo é
para quem encontrar uma vulnerabilidade real em produção.

## Reportando uma vulnerabilidade

**Não abra uma issue pública** para uma vulnerabilidade de segurança.

Envie um e-mail para **loja@calicolors.com.br** com:
- descrição do problema e impacto;
- passos para reproduzir (se aplicável);
- URL/endpoint afetado.

Vulnerabilidades em dependências de terceiros (CVEs do `npm audit`, do
Dependabot, de uma GitHub Action) não precisam desse fluxo — abra ou
comente na PR/issue que o Dependabot já gera.

## Escopo

- App e portal em produção (`queroumacor.com.br` e subdomínios).
- Pipeline de CI/CD deste repositório (`.github/workflows/`).
- Não inclui infraestrutura de terceiros (Supabase, Cloudflare, Meta/
  WhatsApp Cloud API, Mercado Pago) — reporte a eles diretamente.

## O que NÃO fazer

- Não teste contra dados de usuários reais além do necessário para provar o
  achado.
- Não execute ataques de negação de serviço (rate-limit flooding, etc.)
  contra produção.
- Não exfiltre dados além de uma amostra mínima suficiente para a prova de
  conceito.
