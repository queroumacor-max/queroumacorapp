---
tags: [portal, admin, produtos, pessoas, tabela-de-preços]
---

# Portal Admin — Pessoas, Produtos, Tabela de Preços e Outras Ferramentas

O `/portal` é um arquivo único sem bundler (`app.jsx` → compilado pra `app.js`, com SRI). **Regra crítica: mexeu no `app.js`, refaz o `integrity` (SHA-384) no `index.html` E bump o `?v=` nas tags `<script>`, senão o navegador recusa em silêncio ("Carregando Portal..." eterno).** Recompilar: `@babel/preset-react` `runtime:'classic'`, `jsescOption.minimal:false`, `compact:false`, sem quebra de linha no fim — reproduzível byte a byte.

## Edição de pessoas
Fim dos `prompt()` do navegador (2026-09-07) — modal único `EditarPessoaModal` por linha, com especialidade em CHECKBOX contra o MESMO catálogo do app (`ROLE_SPECS`/`PERFIL_SPECS`, testado igual nos dois lados — texto livre gerava "Piso Epoxi"/"piso epoxi" como valores distintos pro filtro).
- E-mail: `profiles.email` é só espelho — pode ficar NULL se o cadastro nunca preencheu. Action `sync_email` lê do GoTrue admin e espelha. Lápis pra criar/trocar login via `set_email`.
- Colunas de telefone: `PhoneCell` normaliza por `normalizeWhatsAppTarget` (não `normalizeBrPhone` — mesmo erro que já derrubou envio com número estrangeiro).
- Alterar período do PRO: modal com atalhos +1/+3/+6 meses/+1 ano, soma a partir da expiração vigente.

## Exclusão de conta (Wave 44, SQL executado)
502 no delete — causa raiz: FK `quotes_painter_id_fkey` (e outras) sem `ON DELETE` referenciando profiles. RPC `admin_delete_user(uuid, p_force_admin)` roda a cascata dentro do Postgres. Varredura dinâmica corrigiu TODAS as FKs public→profiles/auth.users com NO ACTION/RESTRICT.

## Produtos (catálogo ~21 mil linhas)
Performance (2026-08-29): só colunas do card no select; 1ª página pinta a tela; janela de 60 cards; `_cat`/`_q` pré-calculados; cache em memória; emenda em vez de recarregar tudo. Índice `idx_products_name` (Wave 52, CONCURRENTLY). Foto: caixa de mídia com `object-contain` (era `cover`, cortava a peça) — mesma correção na loja do app.
Variantes de tamanho (Wave 25, `product_variants`, RLS pública pra SELECT).

## Tabela de Preços ABRAPP 2026 (Wave, SQL completo, confirmado: 328 itens / 212 com altura / 19 folhas)
PDF transcrito à mão (imagem pura, sem camada de texto) — `__tests__/priceTableData.test.ts` trava estrutura, vocabulário e `mín ≤ média ≤ máx`. Tile só pra `role='pintor'`+admin. Fidelidade ao impresso é regra: erro de digitação do PDF fica, linha zerada vira "sem valor publicado". **Lição de processo registrada duas vezes**: "SQL executado" a partir de "relato no chat" já deu errado (marcou tudo executado quando só 5/19 folhas tinham entrado) — sempre reconferir com query de contagem, e o número de conferência tem que vir do fonte, não de estimativa de cabeça.

## Click Rua (revista de graffiti, tile só pra grafiteiro)
Páginas foram pro bucket `click-rua` + tabela `click_rua_editions` (SQL executado, confirmado nos dois lados). Portal converte pra WebP no navegador. Leitor é tela cheia com virada de página 3D (`rotateY`, sem perspectiva de propósito — senão a captura mentiria sobre o CSS). `z-[1100]` (não `z-[400]`) porque abre de DENTRO do BottomSheet (`z-[1000]`).

## Uso do App (dashboard)
`/api/admin/stats` agrega no SERVIDOR (RLS de `ai_usage`/`referrals`/`points` é "cada um vê o seu" — consulta direta do portal mostraria só linhas do próprio admin). Personas de IA nunca foram registradas até o CHECK de `ai_usage.feature` ser derrubado (Alice/Fê/Senna gravavam features fora da lista original, INSERT falhava com 23514, `recordAiUsageViaRest` só dava `console.warn`).

## Chats 3-Way, WhatsApp
Ver [[WhatsApp - Portal e Mídia]].

## Outras correções notáveis do portal
- Formulário de produto virou gaveta lateral fixa (era card no topo, sumia ao rolar).
- Modal de abordagem espelhado (prévia esquerda, campos+enviar direita).
- Importador de leads aceita Excel direto (SheetJS vendorado, SRI travado por teste).

---
## Ver também
[[WhatsApp - Portal e Mídia]] · [[Leads - Importação e Funil de Abordagem]] · [[Performance - Índices, RPCs e Paginação]]
