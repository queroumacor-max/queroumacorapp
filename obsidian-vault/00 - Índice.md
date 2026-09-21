---
tags: [moc, índice, queroumacor]
---

# QueroUmaCor — Índice Geral

Vault migrado do `CLAUDE.md` do repo `queroumacorapp` (migração feita em 2026-09-18) e **ressincronizado com paridade total de detalhe em 2026-09-21** (pedido explícito do usuário: "quero 100% sincronizado a tudo feito... toda memoria do claude com todos os detalhes"). Este arquivo é o *Map of Content* — ponto de entrada pra navegar por tema. O `CLAUDE.md` original continua sendo a fonte canônica no repo (não foi apagado, e não é reescrito por este vault); este vault é uma reorganização temática do mesmo conteúdo, com todo o detalhe técnico preservado, pra navegação estilo Obsidian.

> **Como ler as notas de SQL/migration:** quando uma nota diz "JÁ EXECUTADO no Supabase", isso é um FATO operacional confirmado pelo usuário em produção — não pedir pra rodar de novo. Quando diz "PENDENTE" ou "MANUAL ACTION REQUIRED", é uma ação real ainda não feita.

> **Este vault NÃO se mantém sincronizado sozinho.** A ressincronização de 2026-09-21 cobriu tudo que existia no `CLAUDE.md` até aquela data (186 entradas datadas, conferidas por varredura). Qualquer entrada nova adicionada ao `CLAUDE.md` DEPOIS dessa data só chega aqui numa próxima sincronização manual — não presumir que este vault está atualizado além do que a data acima diz.

## 🔐 Segurança
- [[Segurança - Auditoria Supabase (RLS e Banco)]] — RLS/policies/grants/roles/functions/RPCs/triggers/views/Storage/Realtime/Auth, achado crítico de `leads` sem RLS, os 5 CRITICALs do release audit de 2026-06-12
- [[Segurança - Rate Limiting e Abuse]]
- [[Segurança - Firebase FCM e Push]]
- [[Segurança - Mobile (Capacitor Android iOS)]]
- [[Segurança - Cloudflare]] — inclui CSP/headers nunca ativos em produção, HostedScan, DNSSEC/CAA/SSL-TLS
- [[Segurança - Auditoria CI-CD]]
- [[Segurança - Auditorias Externas (Webhooks e Integrações)]]
- [[Segurança - Auditoria Final (Bloco 21, OWASP ASVS, Release Gate)]]
- [[Segurança - Pentest Integrado Final]]
- [[Segurança - Auditoria de Privacidade e LGPD]]
- [[Segurança - Logging, Observabilidade e Audit Trails]]
- [[Segurança - Identidade Externa e Contas Administrativas]]
- [[Segurança - Disaster Recovery e Business Continuity]]
- [[Segurança - CVEs e Dependências (Next.js, postcss, adapters)]]
- [[Moderação de Conteúdo (Gemini e CSAM)]]

## 💬 WhatsApp
- [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]]
- [[WhatsApp - IA, Follow-up e Leads]]
- [[WhatsApp - Portal e Mídia]]
- [[Leads - Importação e Funil de Abordagem]]

## 🖥️ Portal Admin
- [[Portal - Pessoas, Produtos e Ferramentas]]

## 📱 Mobile
- [[Mobile - Build, Deploy e Push Nativo]]
- [[Mobile - Bugs de WebView e Picker]]

## 🔑 Autenticação e Perfil
- [[Auth - OAuth, Cadastro e RLS de Sessão]]
- [[Perfil - Edição, Avatar, Cadastro e Especialidades]]

## 📸 Conteúdo e Chat
- [[Posts, Stories e Feed]]
- [[Chat - 3-Way, Não Lidas e Respostas Automáticas]]

## 🧾 Orçamentos e Pagamentos
- [[Orçamentos (Quotes) - Wizard, PDF e Tabela ABRAPP]]
- [[Pagamentos, PRO e Compliance Apple]]

## ⚡ Performance e Infra
- [[Performance - Índices, RPCs e Paginação]]
- [[Infraestrutura - Cloudflare, Env Vars e Deploy]]

## 🐛 Incidentes e Regras
- [[Incidentes Notáveis]]
- [[Convenções Gerais de Desenvolvimento]]

## 🏢 Empresa
- [[Dados Oficiais - Cali Colors]]

## 📋 Pendências
- [[Pendências Reais (Ação Manual Necessária)]]

---
#### Nota sobre "🚫 WebIntoApp"
WebIntoApp e o repo `queroumacor-ios` estão **descontinuados desde 2026-09-04** (decisão do usuário). As DUAS lojas (Android e iOS) saem de **Codemagic + Capacitor**, deste mesmo repo. Ver [[Mobile - Build, Deploy e Push Nativo]]. Qualquer menção a WebIntoApp em notas antigas é registro histórico de incidentes já resolvidos, não orientação atual.
