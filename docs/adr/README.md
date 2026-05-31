# Architectural Decision Records (ADRs)

Este diretório guarda decisões arquiteturais do QueroUmaCor no formato
Michael Nygard. Cada ADR captura **uma decisão**, o contexto que
motivou, alternativas avaliadas, e as consequências (positivas e
negativas) — pra que futuro mantenedor (humano ou agent) entenda
**porque** o código está como está, sem ter que arqueologizar git log.

---

## Índice

| ID   | Título                                                                                          | Status   |
| ---- | ----------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Vanilla JS com IIFE + shim em vez de Next.js/TS/React](./0001-vanilla-js-com-iife-shim.md)     | Accepted |
| 0002 | [Supabase com defense in depth (RLS + filtros + policies)](./0002-supabase-com-defense-in-depth.md) | Accepted |
| 0003 | [Backend em Cloudflare Pages Functions (V8 isolates)](./0003-cloudflare-pages-functions.md)     | Accepted |
| 0004 | [Arquitetura modular com IIFE + shims (Fase 4 da modularização)](./0004-arquitetura-modular-com-shims.md) | Accepted |
| 0005 | [Observabilidade em camadas (Sentry + tabela `errors` caseira)](./0005-observability-defense-em-camada.md) | Accepted |

Status possíveis:

- **Proposed** — em discussão, ainda não decidido.
- **Accepted** — decisão tomada, código reflete.
- **Superseded** — substituído por outro ADR (referenciar qual).
- **Deprecated** — decisão revertida sem substituto direto.

---

## Quando criar um ADR

Crie um ADR quando:

1. **Escolher entre opções estruturais que afetam o repo todo.**
   Exemplo: framework, runtime, padrão de modularização, estratégia
   de autorização, sistema de observabilidade, política de cache.
2. **A decisão é difícil de reverter** (custo > 1 sprint pra desfazer).
3. **Tem trade-offs visíveis** — o "óbvio" não é universal e alguém vai
   perguntar "por que não X?".
4. **Outras decisões vão referenciar.** ADRs novos podem usar
   "conforme ADR 0001/0003".

**Não** crie ADR pra:

- Bug fix.
- Refactor local (uma feature, um módulo).
- Mudança de UI/UX que não toca infra.
- Detalhe de implementação coberto por `CONVENTIONS.md` ou
  `ARCHITECTURE.md` (esses são docs vivos; ADR é snapshot histórico).

Se ficar em dúvida: comentário no PR pode bastar. ADR é pra ficar
encontrável anos depois.

---

## Como criar um ADR

1. Pegue o próximo número livre (`ls docs/adr/`).
2. Nome do arquivo: `NNNN-slug-em-kebab-case.md`. Use 4 dígitos.
3. Use o template abaixo.
4. Linka nos ADRs relacionados (Referências) e na Decisão se houver
   sucessão (`Status: Superseded by 00XX`).
5. Adicione linha no índice acima.
6. Commit no padrão `docs: ADR NNNN — <título curto>`.

### Template

```markdown
# ADR NNNN — <título curto, frase decisória>

- **Status**: Proposed | Accepted | Superseded by 00XX | Deprecated
- **Date**: AAAA-MM-DD
- **Deciders**: <quem participou da decisão>
- **Tags**: <área>, <subárea> (ex.: frontend, runtime, security)

## Context

Fatos que motivam a decisão. O que o sistema é hoje, o que mudou ou
está pressionando pra mudar, restrições (técnicas, de equipe, de
produto, de custo). Sem opinião — só o cenário. Datas, números,
referências a arquivos quando ajudar.

## Decision

A decisão em si, em 1–3 parágrafos. Imperativo. Diz **o que** vai
ser feito (ou não-feito). Inclui escopo claro: "em todo lugar X" ou
"só na feature Y por enquanto".

## Consequences

### Positive

Lista de benefícios concretos que esperamos. Sem hype — coisas
mensuráveis ou pelo menos visíveis no dia-a-dia.

### Negative

Lista honesta dos downsides. Custos cognitivos, riscos, dívida que
está sendo aceita, limitações que ficam.

## Alternativas consideradas

Outras opções avaliadas e por que perderam. Pra cada uma: o que era,
o que perdeu, contra qual critério.

## Quando re-avaliar

Gatilhos concretos pra abrir um ADR de superseção. Métricas, eventos,
ou mudanças de contexto que invalidariam a decisão.

## Referências

- Arquivos do repo que materializam a decisão.
- Docs relacionados (ARCHITECTURE.md, LAYERS.md, etc.).
- ADRs relacionados.
- Links externos (RFCs, posts, discussões).
```

---

## Convenções

- **Português** (PT-BR) no texto. Identificadores de código em inglês
  (igual `CONVENTIONS.md §Idioma`).
- **Tamanho**: 80–150 linhas é o sweet spot. ADR longo demais perde
  leitor; curto demais perde nuance.
- **Honesto sobre downsides**: a seção "Negative" é tão importante
  quanto a "Positive". Decisão sem custos é decisão mal documentada.
- **Imutável depois de Accepted**: ADR aceito não se edita pra mudar a
  decisão. Crie um ADR novo marcando o antigo como `Superseded`.
  Pequenas correções (typo, link quebrado, referência a arquivo
  renomeado) são OK.
- **Status no topo**: scanear o índice já mostra o que ainda vale.

---

## Relação com outros docs

| Doc                       | Cobre                                                    |
| ------------------------- | -------------------------------------------------------- |
| `ARCHITECTURE.md`         | Estado atual concreto da arquitetura (descritivo)        |
| `LAYERS.md`               | Como camadas conceituais mapeiam pros arquivos reais     |
| `ARCHITECTURE_PLAN.md`    | Plano histórico da Fase 4 da modularização               |
| `CONVENTIONS.md`          | Regras de código (naming, estilo, enforcement)           |
| `CONTRIBUTING.md`         | Workflow de contribuição (branch, PR, testes)            |
| `DEPLOYMENT.md`           | Pipeline operacional (CI, deploy, rollback, cache, CSP)  |
| `STAGING.md`              | Preview deploys                                          |
| `docs/adr/*`              | **Por que** decisões foram tomadas (este diretório)      |

ADRs respondem **"por quê"**. Os outros docs respondem **"como"** e
**"o quê"**.
