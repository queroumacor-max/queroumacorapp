# Push Notifications (Web Push API + VAPID)

Release C8 (2026-06-11). Habilita notificações push do navegador (chrome/edge
desktop+mobile, Firefox, Safari 16.4+ em PWA standalone) usando o protocolo
[Web Push](https://datatracker.ietf.org/doc/html/rfc8030) + cifração
[aes128gcm](https://datatracker.ietf.org/doc/html/rfc8291) + autenticação
[VAPID](https://datatracker.ietf.org/doc/html/rfc8292).

## Arquitetura

```
+----------------+   subscribe()   +-------------+   upsert    +-------------------------+
| navegador (PWA)| --------------> | Service     | --------->  | Supabase                |
|                |                 | Worker      |             | push_subscriptions      |
| PushOptIn UI   |                 | (sw.js)     |             | (RLS user-owned)        |
+----------------+                 +-------------+             +-----------+-------------+
       ^                                                                   |
       |                                                                   | trigger
       | push event (encrypted)                                            v
+----------------+                              +------------+    pg_net   +---------------+
| Browser/FCM/   | <------- POST encrypted ---- | /api/push- | <---------- | dispatch_push |
| Mozilla auto-  |                              | notify     |             | on insert     |
| push           |                              | (edge)     |             | notifications |
+----------------+                              +------------+             +---------------+
```

## Quem precisa fazer o quê

### 1) Gerar chaves VAPID (uma vez)

```bash
npx web-push generate-vapid-keys
```

Saída:

```
Public Key:  BL...
Private Key: aS...
```

Guardar as duas. A privada NUNCA pode vazar — quem tem acesso a ela pode
enviar push em nome do app.

### 2) Setar env vars no Cloudflare Pages

`Settings → Environment Variables` (Production scope):

| Variável                       | Onde            | Valor                                      |
| ------------------------------ | --------------- | ------------------------------------------ |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Plain text      | (public key acima)                         |
| `VAPID_PRIVATE_KEY`            | Secret          | (private key acima)                        |
| `VAPID_SUBJECT`                | Plain text      | `mailto:loja@calicolors.com.br`            |
| `PUSH_INTERNAL_SECRET`         | Secret          | string aleatória ≥ 32 chars (gerar nova)   |

**Importante**: `NEXT_PUBLIC_*` precisa ser Plain text (não Secret) pra ser
inlined no build do Next. As outras podem ser Secret.

### 3) Rodar SQL no Supabase

`SQL Editor` → cole o conteúdo de
[`migrations/2026-06-11-push-subscriptions.sql`](../migrations/2026-06-11-push-subscriptions.sql)
→ Run.

O script:

- Cria extensão `pg_net` se ainda não habilitada
- Cria tabela `push_subscriptions` + RLS owner-only + UPDATE policy
- Cria função `dispatch_push_on_notification()` + trigger
  `trg_dispatch_push_notification` em `notifications`

Depois rode **uma vez** (em conexão separada, ainda no SQL Editor):

```sql
ALTER DATABASE postgres SET app.push_notify_url =
  'https://queroumacor.com.br/api/push-notify';

ALTER DATABASE postgres SET app.push_internal_secret = '<MESMO valor de PUSH_INTERNAL_SECRET>';
```

Sem isso, o trigger fica em no-op silencioso (notification ainda é inserida
no sininho, mas nenhum push é enviado).

Pra forçar o pool a reler:

```sql
SELECT pg_reload_conf();
```

(Settings carregadas via `current_setting()` em `SECURITY DEFINER` são lidas
por conexão; pool do PostgREST recicla normalmente em ~minutos.)

### 4) Habilitar pg_net se necessário

`Database → Extensions → pg_net` → toggle ON. (Já incluso no migration
via `CREATE EXTENSION IF NOT EXISTS pg_net`, mas alguns projetos exigem o
toggle UI.)

## Limitações conhecidas

| Plataforma                    | Suporte                                              |
| ----------------------------- | ---------------------------------------------------- |
| Chrome desktop/Android        | OK                                                   |
| Firefox desktop/Android       | OK                                                   |
| Edge desktop                  | OK                                                   |
| Safari macOS 16+              | OK                                                   |
| Safari iOS < 16.4             | **NÃO suportado**                                    |
| Safari iOS ≥ 16.4 (web direto)| **NÃO suportado**                                    |
| Safari iOS ≥ 16.4 (PWA)       | OK, somente em modo "Adicionar à Tela de Início"     |

Mensagem mostrada pro user com `'unsupported'`:
> "Seu navegador não suporta. No iPhone, instale como app na tela inicial
> (iOS 16.4+)."

## Como testar localmente

1. Local: `npm run dev`.
2. Acesse `http://localhost:3000` em Chrome.
3. Login + vá pra `/perfil`.
4. No card "Receber notificações", clique no toggle.
5. Aceite a permission do browser.
6. Inserir uma row de teste em `notifications`:
   ```sql
   INSERT INTO notifications (user_id, type, title, body)
   VALUES ('<seu user_id>', 'test', 'Teste', 'Hello from push!');
   ```
7. Notificação deve aparecer em ~1-2s. Se não, ver logs:
   - Cloudflare Pages → Functions → `/api/push-notify` → Recent invocations
   - Supabase → Logs → Postgres logs → procurar por `dispatch_push_on_notification`
   - Browser DevTools → Application → Service Workers → inspecione console

## Testar manualmente sem trigger

```bash
curl -X POST https://queroumacor.com.br/api/push-notify \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $PUSH_INTERNAL_SECRET" \
  -d '{
    "userIds": ["<seu user_id>"],
    "title": "Manual test",
    "body": "Sent from curl",
    "url": "/notificacoes"
  }'
```

Resposta esperada:
```json
{ "ok": true, "sent": 1, "removed": 0, "total": 1 }
```

## Observabilidade

- Endpoints que respondem 404/410 são automaticamente removidos da tabela
  (subscription expirou ou user revogou no nível do OS).
- O trigger `dispatch_push_on_notification` é `exception when others →
  return new` (best-effort): falha de rede **não** bloqueia o insert da
  notificação. Sininho continua funcionando.
- Pra reabilitar, basta o user clicar de novo no toggle (idempotente:
  re-subscribe + upsert).

## Troubleshooting

| Sintoma                                       | Causa provável                          | Fix                                                                 |
| --------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| Toggle aparece desabilitado / estado unsupported | Sem `NEXT_PUBLIC_VAPID_PUBLIC_KEY` ou iOS sem PWA | Setar env var + Plain text + rebuild; iOS precisa "Adicionar à Tela" |
| Permission "denied" mesmo no primeiro click    | User negou no passado                   | Limpar permission em `chrome://settings/content/notifications`      |
| 401 unauthorized no `/api/push-notify`         | `PUSH_INTERNAL_SECRET` diferente entre Pages e Supabase | Reset os dois pro mesmo valor                                       |
| Notification aparece no sininho mas sem push   | Trigger não disparou OU `pg_net` desabilitado | `SELECT * FROM cron.job` + `SELECT extname FROM pg_extension`; reabilitar |
| Push chega no Chrome mas não no Safari/iOS     | Esperado se não estiver em PWA standalone   | Documentado em "Limitações conhecidas"                              |
