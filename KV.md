# Cloudflare KV — Cache de Edge

Documento operacional do uso de Cloudflare KV (Workers KV) como cache de
edge compartilhado entre PoPs para os endpoints `/api/*` (Pages Functions).

---

## 1. O que é KV no contexto do projeto

Cloudflare KV é um key-value store distribuído globalmente, eventually
consistent (~60s de propagação entre PoPs). Diferente do cache HTTP do
CDN, KV:

- Sobrevive a purges manuais e ao expiry do CDN.
- É **compartilhado** entre todos os PoPs (qualquer request HIT em qualquer
  região se beneficia do mesmo write).
- Tem TTL configurável por chave (não preso ao `Cache-Control`).
- Permite escrita programática a partir de dentro das Pages Functions
  (não só por header de response).

Onde se encaixa nas camadas de cache existentes:

```
Browser cache  →  Cloudflare CDN  →  Cloudflare KV  →  Origin (IBGE / etc.)
   (1 dia)        (30 dias)         (TTL por chave)
```

KV vai **embaixo** do CDN: quando o CDN expira ou purga, KV ainda segura o
hit antes de bater no origin.

---

## 2. Setup pelo usuário (passo manual, não-Claude-actionable)

Claude **não consegue** criar o namespace nem o binding — egress bloqueado
e nenhuma API/CLI exposta. Passos manuais no painel Cloudflare:

```
1. Painel Cloudflare → Workers & Pages → KV → Create namespace
   Nome do namespace: "queroumacor-kv"

2. Pages project "queroumacorapp" → Settings → Functions →
   KV namespace bindings → Add binding
     Variable name: KV
     KV namespace:  queroumacor-kv

3. (Opcional) Repetir o passo 2 no environment "Preview" se quiser cache
   compartilhado nos preview deploys. Se NÃO configurar em Preview, os
   endpoints caem no path BYPASS (sem cache) — sem quebra.

4. Trigger um novo deploy (push trivial em `main` ou "Retry deployment"
   no painel) pra o binding propagar pras Functions em produção.
```

**Importante**: o `Variable name` precisa ser exatamente `KV` (esse é o
nome que o código procura em `env.KV`). Se mudar, mudar também em
`functions/api/_services/cidades.js`.

### Status atual

- [ ] Namespace `queroumacor-kv` criado no painel
- [ ] Binding `KV` configurado em Production
- [ ] Binding `KV` configurado em Preview (opcional)
- [ ] Deploy disparado pra propagar o binding

Enquanto não tiver isso configurado, o endpoint `/api/cidades` segue
funcionando normalmente — só não tem cache KV (header `X-Cache: BYPASS` em
todas as respostas).

---

## 3. Chaves em uso

| Chave            | TTL  | Payload         | Fonte                                  |
| ---------------- | ---- | --------------- | -------------------------------------- |
| `cidades:<UF>`   | 7 d  | `Array<{nome}>` | IBGE `/api/v1/localidades/estados/...` |

`<UF>` é uma das 27 UFs do Brasil (upper-case, 2 letras). Total de 27
chaves possíveis. Dataset muda <1x/ano (criação de município é evento
raro), então TTL de 7 dias é generoso e seguro.

---

## 4. Padrão para futuras adições

Antes de adicionar nova chave em KV, checar se o caso de uso bate:

- **Determinístico** — mesma entrada sempre gera mesma saída.
- **Idempotente** — leitura repetida não afeta nada.
- **Alto volume** — vale o overhead de write/read.
- **TTL natural longo** — minutos não justifica (CDN já cobre); dias ou
  semanas é o sweet spot.
- **Payload pequeno** — KV tem limite de 25 MB por valor, mas <100 KB é o
  ideal.

Candidatos futuros (não implementar sem demanda):

- `autoresponse:<categoria>:<intent>` — respostas pré-canned do chat
- `painter_summary:<id>` — agregado de profile + reviews (TTL curto, 1h)
- `cep:<8digitos>` — proxy ViaCEP/BrasilAPI (mesma forma do `cidades:*`)

Convenção de naming: `<entidade>:<key>` em snake/lowercase. Evitar `:`
duplo. Evitar chaves >512 bytes (limite KV).

---

## 5. Debug

### Listar chaves do namespace

Via painel Cloudflare: `Workers & Pages → KV → queroumacor-kv → View
keys`. Mostra todas as chaves, TTL restante, e valor (clicando).

Via código (em uma function temporária ou no `_services/*`):

```js
const list = await env.KV.list({ prefix: 'cidades:' });
console.log(list.keys);  // [{ name: 'cidades:SP', expiration: ... }, ...]
```

### Inspecionar uma chave específica

```js
const val = await env.KV.get('cidades:SP', 'json');
console.log(val);  // array de cidades, ou null se expired/inexistente
```

### Invalidar manualmente

Via painel: clica na chave → Delete. Via código:

```js
await env.KV.delete('cidades:SP');
```

Próximo request bate no origin e refaz o write. Útil quando o IBGE mudar
a lista (raro) e quisermos forçar refresh sem esperar 7 dias.

### Verificar header `X-Cache` no response

```bash
curl -I 'https://queroumacor.com.br/api/cidades?uf=SP'
# X-Cache: HIT     → veio do KV
# X-Cache: MISS    → KV bindado mas vazio; foi pro IBGE e populou KV
# X-Cache: BYPASS  → KV não bindado (binding faltando ou config errada)
```

Se ver `BYPASS` em produção depois do setup, conferir se o binding
chegou no environment certo (Production vs Preview).

---

## 6. Custos

Plano Cloudflare Pages PRO inclui:

- **Reads**: 100k/dia gratuitos, depois ~$0.50/milhão.
- **Writes**: 1k/dia gratuitos, depois ~$5/milhão.
- **Storage**: 1 GB gratuito, depois ~$0.50/GB-mês.
- **List operations**: 1k/dia gratuitos.

Estimativa pra `cidades:*`:

- ~27 writes/semana (1 por UF a cada expiry de 7d) → **~108/mês**.
- Reads = qtde de carregamentos de signup/perfil. Mesmo 100k/dia
  fica dentro do free tier.
- Storage: 27 chaves × ~10-50 KB = <2 MB total.

Fica **muito abaixo** dos limites gratuitos. Sem custo incremental
esperado.

---

## 7. Falha modes e mitigação

| Cenário                          | Comportamento                                          |
| -------------------------------- | ------------------------------------------------------ |
| Binding `KV` faltando            | `env.KV` undefined → `hasKV=false` → BYPASS, bate origin |
| `env.KV.get()` throws            | catch interno, loga warn, segue pra origin            |
| `env.KV.put()` throws            | catch interno, response volta com source `origin+kv`  |
| KV propaga lento (60s typical)   | até 1 minuto de extra MISS após write — aceitável     |
| Payload corrompido no KV         | `Array.isArray(cached)` falha → trata como MISS       |
| TTL expirado durante request     | `get()` retorna null → trata como MISS               |

Resumo: **KV nunca derruba o endpoint**. Qualquer falha cai em BYPASS ou
MISS, e o origin (IBGE) absorve. Pior caso é perda do cache, não erro 5xx.

---

## 8. Implementação atual

- Service puro: `functions/api/_services/cidades.js` (`getCidades(uf, env)`)
- Controller thin: `functions/api/cidades.js` (HTTP + headers)
- Testes: `tests/integration/api.test.js` (BYPASS + HIT + MISS + erros)
