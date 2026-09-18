---
tags: [segurança, moderação, gemini, csam, ia]
---

# Moderação Gemini no Publish + Blocklist de Hash CSAM

**Data:** 2026-09-17, PR #325. SQL `/migrations/2026-09-17-moderation-quota-and-media-hash-coverage.sql` **JÁ EXECUTADO** (confirmado, 6 linhas `ok=true`).

## O que mudou
- **`usePublishPost` passou a chamar `/api/moderate` de verdade.** Antes, publicar não passava por triagem nova nenhuma — cobre TODA foto do carrossel (achado do Codex: fotos 2-5 furavam Gemini e blocklist). Legenda só reenviada na checagem da 1ª foto. Bloqueia se `flagged`/`approved:false`.
- **Vídeo ganhou moderação de verdade.** `/api/moderate-video` existia pronto desde o RELEASE_AUDIT mas nunca tinha caller (achado do Codex: "the endpoint merely exists"). `usePublishPost` chama depois de `createPost`. Todo caminho `'pending'` agora **enfileira de verdade** em `media_review_queue` (2ª rodada do Codex: `moderateVideoPost` devolvia `'pending'` sem gravar nada).
- **Cota própria de moderação**, separada da cota geral de IA. RPC `reserve_moderation_usage` (irmã de `reserve_ai_usage`, mesmo padrão atômico), teto 1000/mês.
- **429 deixou de ser fail-open** (achado do Codex): antes qualquer `!res.ok` (incluindo 429) era tratado como "infra fora do ar". Agora só 429 bloqueia; qualquer OUTRA resposta não-2xx segue fail-open (decisão de produto em aberto, não ampliada aqui).
- **Blocklist de hash CSAM estendida a avatar e biblioteca de artes** (AR Grafite). Mas a defesa real não é o trigger (que confia no hash do CLIENTE) — `uploadAvatar` e `uploadArtReference` chamam `assertMediaApproved` ANTES de persistir, que calcula o hash NO SERVIDOR. `removeUploadedAvatar` fecha o gap de avatar reprovado ficar no bucket (2ª rodada do Codex).

## Gap conhecido, não fechado
**Inserir em `posts` direto via PostgREST pula `/api/moderate` inteiro.** RLS permite qualquer `authenticated` inserir a própria linha; `createPost` grava `status:'approved'` direto. Fechar de verdade exige mover a CRIAÇÃO do post pro servidor (INSERT com service_role) — mudança arquitetural maior, não decidida.

---
## Ver também
[[Segurança - Auditorias Externas (Webhooks e Integrações)]] · [[Posts, Stories e Feed]]
