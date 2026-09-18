---
tags: [moc, índice, queroumacor]
---

# QueroUmaCor — Índice Geral

Vault migrado do `CLAUDE.md` do repo `queroumacorapp` (migração feita em 2026-09-18). Este arquivo é o *Map of Content* — ponto de entrada pra navegar por tema. O `CLAUDE.md` original continua sendo a fonte no repo (não foi apagado); este vault é uma reorganização temática do mesmo conteúdo, pra navegação estilo Obsidian.

> **Como ler as notas de SQL/migration:** quando uma nota diz "JÁ EXECUTADO no Supabase", isso é um FATO operacional confirmado pelo usuário em produção — não pedir pra rodar de novo. Quando diz "PENDENTE" ou "MANUAL ACTION REQUIRED", é uma ação real ainda não feita.

## 🔐 Segurança
- [[Segurança - Auditorias Externas (Webhooks e Integrações)]]
- [[Segurança - Auditoria CI-CD]]
- [[Segurança - Auditoria Supabase (RLS e Banco)]]
- [[Segurança - Rate Limiting e Abuse]]
- [[Segurança - Firebase FCM e Push]]
- [[Segurança - Mobile (Capacitor Android iOS)]]
- [[Segurança - Cloudflare]]
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

## 📸 Conteúdo
- [[Posts, Stories e Feed]]

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
