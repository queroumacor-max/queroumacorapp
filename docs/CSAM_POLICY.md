# Política de CSAM (Child Sexual Abuse Material)

**Versão:** 1.0 — 2026-06-11
**Operador:** CALICOLORS TINTAS LTDA — CNPJ 47.677.346/0001-92
**Contato DPO:** loja@calicolors.com.br | WhatsApp (11) 95976-5031

---

## 1. Política do app

QueroUmaCor tem **tolerância zero** com material de abuso sexual infantil
(CSAM). Qualquer conteúdo deste tipo:

1. **Bloqueia o upload** automaticamente quando o hash bate em qualquer
   uma das nossas listas (blocklist interna `media_hash_blocklist`
   alimentada por admin + Cloudflare CSAM Scanning Tool).
2. **Bane permanentemente** a conta autora.
3. **É reportado ao NCMEC** (National Center for Missing & Exploited
   Children) via SaferNet ou CyberTipline direto.
4. **Preserva a evidência** por até 90 dias antes de qualquer deleção
   permanente (LGPD permite retenção legal pra cumprir obrigação
   regulatória — art. 16, II).

A política vale igualmente pra:
- Posts publicados no feed
- Stories
- Anexos em chat 1:1
- Avatares e capas de perfil
- Imagens em produtos da loja
- Referências de arte ("AR Grafite")

---

## 2. Arquitetura da camada de scanning

Fluxo de defesa em profundidade (cada camada falha-aberta pra próxima):

```
[ Browser ]
   │
   ▼ upload File via uploadMedia()
   │  ↳ calcula SHA-256 local
   │
[ Supabase Storage (bucket `posts`) ]
   │
   ▼ URL pública
   │
[ /api/moderate ] ← chamado pelo cliente antes/depois do publish
   │
   ├─ 1. Hash check contra `media_hash_blocklist`
   │     ↳ HIT → return flagged=true (sem chamar Gemini)
   │            ↳ enqueueMediaReview(severity=critical)
   │
   ├─ 2. Gemini moderate (texto + imagem)
   │     ↳ severity=hard → flagged
   │            ↳ enqueueMediaReview(severity=high)
   │
   └─ 3. Resposta { flagged, approved, mediaHash, severity }
   │
   ▼
[ Cliente decide: publicar ou não ]
   │
   ▼
[ Cloudflare CSAM Scanning Tool ]  ← scan PASSIVO em todo tráfego
   │  (configurado no painel CF — ver §3)
   │
   ▼ se detectar CSAM:
   │  - bloqueia request
   │  - notifica admin do app
   │  - reporta ao NCMEC automaticamente
```

Tabelas envolvidas (Wave 29):
- `posts.media_hash` — SHA-256 da primeira mídia, pra dedup e audit
- `media_hash_blocklist` — deny-list interna alimentada por admin
- `media_review_queue` — fila de quarentena pra revisão humana

Endpoints:
- `POST /api/moderate` — enriquecido com `mediaUrl`, agora calcula hash
  + checa blocklist + enfileira na review queue conforme severidade.
- `/admin/media-review` — dashboard pro admin agir nas mídias flagadas.

---

## 3. Cloudflare CSAM Scanning Tool — ativação via opt-in legal

A integração **NÃO** é code-actionable **e também não é um toggle de
painel**. A página `/stream/csam` no Dashboard existe mas **carrega em
branco** — a Cloudflare exige um **processo de opt-in manual com acordo
legal** antes de habilitar a ferramenta. Não dá pra ligar sozinho pelo
painel.

### Processo real (descoberto 2026-06-12)

1. O **titular da conta Cloudflare** precisa **entrar em contato com o
   suporte da Cloudflare** (ticket no Dashboard) **ou enviar email para
   `cloudflare-csam@cloudflare.com`** solicitando a habilitação da
   CSAM Scanning Tool para o domínio **queroumacor.com.br**.
2. A Cloudflare envia um **acordo legal específico** (inclui o **NCMEC
   Reporting Agreement** — termo que autoriza a CF a reportar ao NCMEC
   em nome do operador). É preciso **assinar** antes de a ferramenta ser
   habilitada.
3. Fornecer os dados do **responsável legal / DPO** (usar dados Cali
   Colors):
   - Nome legal: CALICOLORS TINTAS LTDA
   - CNPJ: 47.677.346/0001-92
   - Endereço: Est. Presidente Juscelino Kubitschek de Oliveira, 1071 —
     Jardim dos Pimentas — Guarulhos/SP — CEP 07.272-345
   - Contato responsável: loja@calicolors.com.br
4. Definir o(s) email(s) de notificação (pra onde a CF avisa ao detectar
   CSAM): **loja@calicolors.com.br**.
5. Só **depois** que a CF processa o opt-in e assina o acordo é que a
   página `/stream/csam` passa a renderizar e a varredura é ativada.

> ⚠️ **Status:** PENDENTE — depende do titular da conta abrir o
> contato/assinar o acordo. Não é destravável pelo Claude nem por toggle.

### O que acontece depois

- CF escaneia **todas** as imagens servidas pelo seu domínio contra o
  banco de hashes do NCMEC (PhotoDNA + outros).
- Quando detectar:
  - Bloqueia automaticamente a request (resposta 451 ou 403)
  - Notifica os emails configurados
  - Reporta ao NCMEC com timestamp + URL + IP
- Não há cota — é **gratuito** mesmo em conta Free (estamos em Pro).
- Reference: https://developers.cloudflare.com/cache/reference/csam-scanning/

### Limitações

- Cobre só conteúdo servido **via Cloudflare** (queroumacor.com.br).
  Mídias servidas direto do Supabase Storage (`*.supabase.co`) **NÃO**
  passam pelo scanner CF.
- Mitigação: o `/api/moderate` faz o gate antes da publicação, com
  Gemini multimodal + nossa blocklist interna.
- Mitigação adicional: usar Cloudflare como CDN na frente do Supabase
  (config Image Resizing `/cdn-cgi/image/...` já reescreve via CF —
  ver `next-app/lib/cfImg.ts`).

---

## 4. PhotoDNA (Microsoft) — fallback

Caso o Cloudflare CSAM Scanning Tool não atenda ou queiramos defesa
adicional, [PhotoDNA da Microsoft](https://www.microsoft.com/en-us/photodna)
é a alternativa de facto.

### Diferenças vs. Cloudflare

| Aspecto | Cloudflare CSAM | PhotoDNA |
|---|---|---|
| Custo | Grátis | Grátis (NGOs/empresas verificadas) |
| Aprovação | Auto-serve via Dashboard | Aplicação manual + NDA |
| API | Não — só passivo no edge | REST API explícita (`POST /v1.0/hash`) |
| Cobertura | Tráfego via CF | Qualquer mídia (upload-time) |
| Latência adicional | 0 (passivo) | +200-500ms por imagem |
| Reporting | Automático ao NCMEC | Manual via CyberTipline |

### Integração futura (não implementada ainda)

Quando/se ativar PhotoDNA:

1. Criar conta em https://www.microsoft.com/en-us/photodna/cloudservice
2. Aguardar aprovação (~2-4 semanas)
3. Receber chave API
4. Configurar env `PHOTODNA_API_KEY` no Cloudflare Pages
5. Modificar `next-app/lib/api/mediaHash.ts`:
   - Adicionar `checkPhotoDna(buffer)` que chama
     `POST https://api.microsoftmoderator.com/photodna/v1.0/Match`
     com header `Ocp-Apim-Subscription-Key`
   - Chamar em paralelo com `checkHashBlocklist()` no `/api/moderate`
   - Se PhotoDNA reportar match → flagged + enqueueReview severity
     critical + alerta admin imediato (email loja@calicolors.com.br)

---

## 5. Procedimento pro admin quando algo é detectado

### Fluxo padrão

1. Admin recebe email do Cloudflare OU vê novo item em `/admin/media-review`
   com severity `critical` ou `high`.
2. **NÃO clicar em "deletar" no painel admin antes de preservar evidência.**
3. Logar em `/admin/media-review`, filtrar por **Pendentes**.
4. Abrir a mídia (clique no thumbnail abre nova aba).
5. **Avaliar:**
   - Falso positivo (ex.: Gemini errou com arte abstrata) → **Dispensar**
   - Conteúdo abusivo / spam / scam (não-CSAM) → **Bloquear permanente**
     (entra na blocklist como `reported`, post é soft-deletado, hash
     bloqueia futuros uploads idênticos)
   - **CSAM confirmado** → **Escalar NCMEC** (ver §6 abaixo)

### Importante

- O botão "Bloquear permanente" e "Escalar NCMEC" só funcionam quando
  o registro tem `media_hash` preenchido. Sem hash, só dá pra dispensar
  ou aprovar (caso edge).
- Soft-delete (Wave 8) preserva o post no banco por 30 dias antes do
  hard-delete por `cleanup_soft_deleted` (Wave 28). Isso garante janela
  legal pra cumprir mandado/oficio sem perda de evidência.

---

## 6. Procedimento legal — CSAM confirmado

**LEIA INTEIRO ANTES DE AGIR.** Erros aqui podem comprometer
investigação criminal.

### O que NÃO fazer

- ❌ NÃO deletar a mídia da Storage imediatamente.
- ❌ NÃO repassar a mídia por WhatsApp, email ou chat com terceiros
  fora do procedimento oficial — em algumas jurisdições isso é
  re-distribuição criminal mesmo entre staff investigando.
- ❌ NÃO confrontar o usuário publicamente — banimento é silencioso.
- ❌ NÃO descrever a mídia em detalhes em logs ou tickets.

### O que fazer

1. **Preservar a evidência.**
   - O soft-delete via "Escalar NCMEC" no `/admin/media-review` já
     deixa o post recuperável por 30 dias. Suficiente pra mandado.
   - O hash entra em `media_hash_blocklist` com `category='csam'` e
     `reported_to_ncmec=true`.

2. **Reportar ao NCMEC.**

   **Opção A — Via SaferNet Brasil (recomendado pra .br):**
   - Site: https://safernet.org.br
   - Canal de denúncia: https://new.safernet.org.br/denuncie
   - Categoria: "Pornografia Infantil"
   - Eles repassam pro NCMEC + Polícia Federal automaticamente.

   **Opção B — Direto via NCMEC CyberTipline:**
   - Site: https://report.cybertip.org
   - Disponível em PT-BR
   - Requer cadastro institucional (uma vez) com dados Cali Colors
   - Anexar: URL da mídia, timestamp UTC, IP do uploader (consultar
     no Supabase: `select * from auth.audit_log_entries where
     payload->>'actor_id' = '<user_id>' order by created_at desc
     limit 50`)

3. **Reportar à Polícia Federal.**
   - Email: ddh@dpf.gov.br (Divisão de Direitos Humanos)
   - OU presencialmente na delegacia mais próxima
   - OU via portal: https://www.gov.br/pf/pt-br

4. **Documentar internamente.**
   - Adicionar nota em `media_hash_blocklist.notes` com:
     - Data/hora da detecção
     - Quem reviewou
     - Número de protocolo NCMEC/SaferNet
     - Número de protocolo PF
   - Atualizar `media_hash_blocklist.ncmec_report_id` com o protocolo.

5. **Banir a conta.**
   - Marcar o profile como `banned=true` (campo a criar se necessário).
   - Revogar todos os tokens auth (Supabase admin → Users → "Sign out").
   - Bloquear IP + email no `auth.audit_log_entries`.

6. **Notificar parceiros se aplicável.**
   - Mercado Pago (se conta PRO): pode haver chargeback / KYC issue.
   - Plano Cloudflare PRO: abrir ticket com referência ao incidente.

### Prazo de retenção

| Tipo de dado | Retenção mínima | Razão |
|---|---|---|
| Hash em blocklist | Permanente | Defesa de futuros uploads |
| Soft-deleted post | 30 dias (cleanup_soft_deleted) | Janela pra mandado |
| Audit log (`audit_log`) | 1 ano (cleanup_old_audit_log) | LGPD art. 16, II + investigação |
| Mídia original no Storage | 30 dias após soft-delete | `cleanup_orphan_media` (Wave 5/28) |

**Se receber mandado judicial:** suspender qualquer cleanup automático
do user/post envolvido até ordem expressa do delegado/promotor.

---

## 7. Treinamento mínimo pro admin

Antes de operar `/admin/media-review`, ler:

- [SaferNet — Guia para empresas](https://new.safernet.org.br/empresas/)
- [NCMEC CyberTipline FAQ](https://www.missingkids.org/cybertipline)
- Marco Civil da Internet (Lei 12.965/2014), arts. 10-15 (guarda
  de registros + responsabilidade)
- ECA art. 240/241 (criminalização CSAM)

---

## 8. Checklist de compliance pra publicar nas lojas

### Apple App Store (Guideline 1.2)

- [x] Política CSAM documentada (este doc)
- [x] Mecanismo de moderação (Gemini + blocklist)
- [x] Mecanismo de denúncia user-facing (tabela `reports` + `submitReport()`)
- [x] Fila de revisão admin (`/admin/media-review`)
- [ ] **Cloudflare CSAM Scanning Tool ATIVADO** (passo manual — ver §3)
- [x] Email de contato pra denúncias: loja@calicolors.com.br
- [x] Procedimento NCMEC documentado (§6)

### Google Play (User Generated Content policy)

- [x] Política de conteúdo no app (`/info/termos`)
- [x] Sistema de denúncia (botão "Denunciar" no PostCard)
- [x] Sistema de bloqueio (Wave 21)
- [x] Moderação proativa (Gemini + blocklist)
- [ ] **Cloudflare CSAM Scanning Tool ATIVADO** (passo manual)
- [x] Removal automatizado de conteúdo flagado (soft-delete via admin)

---

## 9. Mudanças de política

Atualizações desta política devem ser anunciadas:
- Aos usuários via banner no app (`announcements` + email)
- Aos colaboradores via canal interno
- Versionadas neste doc com timestamp + autor.

**Histórico:**

- 2026-06-11 — v1.0 — Criação inicial (Wave 29, C4 RELEASE_AUDIT).
