# Google Play Console — Checklist de Publicação (QueroUmaCor)

Separação do que é **código** (já feito/neste repo) vs **config no Play
Console / build nativo / assets de design**. Itens numerados do audit
2026-06-18.

---

## Data Safety Form (item 1) — preencher no Play Console → App content → Data safety

> Não faz tracking pra publicidade; sem data brokers. Coleta abaixo é toda
> pra funcionamento do app. Política: **https://www.queroumacor.com.br/info/privacidade**

| Categoria | Tipo | Coletado | Compartilhado | Finalidade |
|---|---|---|---|---|
| Location | Approximate location | Sim | Não | App functionality ("Perto de você") |
| Personal info | Name | Sim | Não | App functionality, Account management |
| Personal info | Email address | Sim | Não | App functionality, Account management |
| Personal info | Phone number | Sim* | Não | App functionality, Customer support |
| Photos and videos | Photos/Videos | Sim | Não | App functionality (portfólio/perfil/posts) |
| Messages | Other in-app messages | Sim | Não | App functionality (chat de orçamentos) |
| App activity | App interactions | Sim | Não | App functionality, Analytics |
| Device/other IDs | Device or other IDs | Sim | Não | App functionality (técnico/segurança) |
| App info & perf | Crash logs / Diagnostics | Sim | Não | Analytics (Sentry, sem PII) |

\* Telefone é opcional pro Cliente, obrigatório pro Profissional → declarar como coletado.

- Encryption in transit: **Sim** (HTTPS/TLS).
- Users can request deletion: **Sim** → `https://www.queroumacor.com.br/delete-account`.

## Privacy policy URL (item 9) — Play Console → Store listing
Colar no campo dedicado: `https://www.queroumacor.com.br/info/privacidade`
(não basta estar dentro dos Termos).

## Classificação etária IARC 18+ (item 10) — questionário IARC na publicação
O app já valida 18+ no cadastro (código). No questionário IARC, responder de
forma a refletir a restrição (conteúdo gerado por usuário, interação social,
contato entre usuários) pra a classificação sair correta na ficha.

## Categorias (item 8) — Store settings
- Principal: **Business**
- Secundária: **Productivity** (ou Tools)

## Descrição: app é intermediário/marketplace (item 11) — Store listing
Reforçar na descrição (já está nos Termos): *"O QueroUmaCor é uma plataforma
que conecta clientes a profissionais de pintura. Não somos parte dos contratos
e não garantimos a execução dos serviços — a negociação é entre as partes."*

---

## Itens de BUILD NATIVO (TWA/Bubblewrap ou Capacitor) — fora do código web

- **Target API Level 35 (item 3):** definido no build Android. No fluxo TWA, o
  `bubblewrap build` seta o `targetSdkVersion` (use a versão mais recente do
  bubblewrap, que já mira API 35). `twa-manifest.json` versiona `minSdkVersion`
  (23); o target é resolvido no build. Conferir com `bubblewrap doctor`.
- **Ícone adaptativo (item 6):** gerar foreground+background (camadas) no
  projeto Android (`res/mipmap-anydpi-v26/ic_launcher.xml`). Bubblewrap gera a
  partir do ícone do manifest; validar no Android Studio. Asset de design.
- **Permissão de câmera com justificativa (item 4):** ver nota de código abaixo.

## Assets de design (não-código) — itens 5 e 12
- **Screenshots (item 5):** mín. 2; recomendado 6–8 — Feed, Busca, Perfil de
  pintor c/ portfólio, Loja Cali Colors, Orçamento, Perfil "Meu Negócio".
- **Feature Graphic (item 12):** 1024×500px.
- **Ícone ficha:** 512×512px.

---

## STATUS — o que JÁ está resolvido em código
- **Item 2 (Google Play Billing):** N/A — PRO é ativado **só por troca de
  pontos** (grátis, sem compra in-app). Não há venda de bem digital por
  dinheiro no app → Play Billing não é exigido. (Mercado Pago do PRO é fluxo web.)
- **Item 7 (Autofill de senha):** já correto — `autoComplete="current-password"`
  no login e `"new-password"` no signup; email/tel/nome/username/bday também
  têm `autocomplete`. No TWA/PWA, o atributo HTML vira o autofill hint do
  Android. Nada a fazer.
- **Idade 18+ (base do item 10):** validada no cadastro (Zod + server), com
  feedback em tempo real.
- **URL de exclusão de conta:** `/delete-account` já existe (Play Policy 2023).

## Pendência de código sugerida (item 4 — rationale de câmera/microfone)
As telas de AR (`ArtAROverlay`, `WallARView`) e o gravador de voz pedem
câmera/mic via `getUserMedia` no mount. São abertas por ação explícita do
usuário (já há contexto), mas o Google recomenda uma **mensagem de motivo antes
do prompt do sistema**. Dá pra adicionar um aviso curto ("Precisamos da câmera
pra projetar a arte na parede") antes de iniciar o stream. Decisão de UX —
implementar se quiser.
