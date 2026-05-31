# Events — Barramento Pub/Sub In-Process

`events.js` expõe `window.Events`: um barramento síncrono in-memory para
desacoplar features dentro do SPA. Cobre os itens **#38 (filas)** e
**#39 (eventos assíncronos)** do audit arquitetural — **sem** depender
de Cloudflare Queues, BullMQ, Redis ou qualquer broker externo.

---

## Por que NÃO Cloudflare Queues / BullMQ hoje?

**YAGNI.** Hoje o QueroUmaCor não tem **nenhum job background necessário**
no produto: não há ETL, não há fan-out de push notification server-side,
não há billing diferido, não há email scheduler próprio (envio sai
direto do Supabase Auth). Toda lógica reativa que existe roda no
browser do usuário ou via Postgres triggers (`award_referral_points`,
`recalc_painter_rating`, `sync_profile_tag_username`, etc.) — que
para o caso atual é a **fila certa**: durável, transacional, gratuita.

**Quando precisar de fila real**, o mesmo padrão escala:
- Trocar o "transport" do `emit()` por um `fetch('/api/queue/enqueue')`
  que escreve numa Cloudflare Queue (plano PRO já suporta).
- Um consumer worker em `functions/queue-consumer.js` lê e dispatcha.
- O contrato dos handlers (`(payload) => Promise<void>`) **não muda**.
- A interface `window.Events.on/emit` permanece — só o adapter por
  baixo é que vira persistente.

Até lá: vanilla pub/sub em 90 linhas resolve. Sem dep, sem custo,
sem broker pra monitorar.

---

## API

```js
// Registra um handler. Retorna função de unsubscribe.
const off = Events.on('post.liked', (payload) => { ... });

// Remove um handler específico.
Events.off('post.liked', handler);

// Dispara o evento. Handlers rodam em ordem de registro.
// Handlers sync rodam inline; handlers async são fire-and-forget.
// Erros (sync throw ou async reject) viram console.warn — chain continua.
Events.emit('post.liked', { postId, likedBy });

// Açúcar: roda uma vez só.
Events.once('auth.session_started', (session) => { ... });

// Introspect (debug/test).
Events._list();      // ['post.liked', 'feed.refreshed', ...]
Events._count(name); // 0..N
Events._clear();     // limpa tudo (útil em tests)
```

### Garantias e não-garantias

| Aspecto                       | Comportamento                                |
|-------------------------------|----------------------------------------------|
| Ordem de execução             | Insertion order (Set preserva)               |
| Handler sync throwa           | Loga e segue (não interrompe os outros)      |
| Handler async rejeita         | Loga via `.catch` (não vira unhandled)       |
| `emit()` bloqueia o publisher | Apenas pelos handlers **sync**; async é fire-and-forget |
| `emit()` devolve resultado    | Não — sempre `undefined`                     |
| Handler chama `off()` no meio | Snapshot tirado antes do loop; emit corrente termina íntegro |

---

## Convenção de nomes

`entity.action` em snake_case quando precisar de duas palavras na ação.

- **entity**: domínio canônico do app (`post`, `chat`, `auth`, `feed`,
  `notif`, `pro`, `order`, `payment`, `user`).
- **action**: verbo no particípio passado (`liked`, `deleted`,
  `received`, `logged_out`, `refreshed`, `upgraded`, `paid`,
  `session_started`). Sinaliza fato consumado, não comando.

Evite verbos no imperativo (`refresh-feed`, `delete-post`) — esses são
**comandos**, não eventos. Comandos = chamadas de função diretas.

---

## Eventos sugeridos para wirar no futuro

Hoje **não há call site no código** usando o bus — é infraestrutura
disponível. Quando a feature pedir desacoplamento, candidatos óbvios:

| Evento                   | Publisher                          | Subscriber sugerido                                  |
|--------------------------|------------------------------------|------------------------------------------------------|
| `post.liked`             | `modules/feed-interactions.js`     | `modules/notif.js` (notifica autor), analytics       |
| `post.deleted`           | `modules/feed.js`                  | cache invalidator do feed, mod log                   |
| `chat.message_received`  | `modules/chat.js` (realtime)       | sininho (`modules/notif.js`), badge dot, som         |
| `auth.session_started`   | `app.js loadSession()`             | preload de feed/notes/notifs                         |
| `auth.logged_out`        | `app.js doLogout()`                | clear de cache local, reset de stores in-memory      |
| `feed.refreshed`         | `modules/feed.js`                  | scroll-restore, pull-to-refresh haptic               |
| `notif.received`         | realtime listener de `notifications` | badge dot, toast, beep                              |
| `pro.upgraded`           | webhook handler / `claimPro()`     | re-render do badge, libera features PRO no UI       |

**Migração não é obrigatória**: cada wiring pode ser feito por PR
isolado, à medida que reduz acoplamento real.

---

## Exemplo de uso

Dois módulos que não se importam um ao outro, conversando pelo bus:

```js
// modules/feed-interactions.js — publisher
async function togglePostLike(postId){
  // ... toggle DB ...
  Events.emit('post.liked', { postId, likedBy: currentUser.id });
}

// modules/notif.js — subscriber (em outro arquivo, sem import)
Events.on('post.liked', async ({ postId, likedBy }) => {
  const post = await DB.posts.byId(postId);
  if(post.user_id !== likedBy){
    await notify(post.user_id, 'curtiu seu post', { postId });
  }
});

// modules/analytics.js — outro subscriber, indiferente aos outros
Events.on('post.liked', ({ postId }) => {
  track('engagement', 'like', { postId });
});
```

Cada subscriber é independente: se `notif.js` quebrar, `analytics.js`
ainda roda. Se um novo módulo `modules/sound-fx.js` quiser tocar um pop
no like, ele só faz `Events.on('post.liked', () => playPop())` — sem
mexer no publisher.

---

## Limitações conscientes

1. **In-memory.** Bus vive no `window` do tab atual. Refresh perde
   handlers; outra aba é outro bus. Não é cross-tab.
2. **Sem persistência.** Eventos perdidos não voltam. Se o usuário
   fechar o app no meio de um `emit()`, handlers async pendentes morrem.
3. **Sem retry / dead-letter.** Falha = `console.warn`. Não há
   re-execução automática.
4. **Fire-and-forget para async.** Publisher não sabe quando handler
   async terminou nem se falhou — não bloqueia `emit()`.
5. **Sem cross-process.** Não chega no edge worker, não chega em outro
   user, não chega no admin dashboard. Puro client-side.

### Quando NÃO usar o bus

Para side-effects **críticos** que não podem ser perdidos:
- **Cobrança / pagamento**: chame o endpoint direto. Persistência via
  Supabase ou Cloudflare Queue.
- **Envio de email transacional**: idem.
- **Logs de auditoria de segurança**: vão pra tabela `errors` ou Sentry,
  não pelo bus.

O bus é pra **acoplamento UI** (notif badge, cache, analytics, scroll
restore) — coisas que falhar silenciosamente é aceitável.

---

## Testes

`tests/events.test.js` cobre 12 cenários: on/emit/off básico, ordem
de registro, `once()`, handler sync que throwa, handler async que
rejeita, fire-and-forget, snapshot anti-corrupção de iterador, e
introspect. Rodar com `npm test`.
