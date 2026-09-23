# UI / UX — QueroUmaCor

> Sistema visual e padrões de interação. Fonte da verdade:
> `next-app/app/globals.css` (tokens, Tailwind v4 via `@theme`, sem
> `tailwind.config`) e `next-app/components/`. Levantado em 2026-09-23.

## 1. Princípios

1. **Mobile-first, uma coluna.** Largura útil máxima de 430px (`AppShell`),
   mesmo no desktop. Portal da loja é a exceção (desktop).
2. **Ferramenta, não vitrine só.** Profissional usa no meio da obra: toques
   grandes, poucos campos, nada que dependa de digitar muito.
3. **Nunca prender a pessoa.** Toda tela tem saída: erro de servidor se
   recupera sozinho, offline avisa, falha diz o motivo e o que fazer.
4. **Resposta imediata.** Ações otimistas (mensagem, curtida, envio de
   WhatsApp aparecem na hora; falha volta com aviso).
5. **Português simples**, tom próximo, sem jargão técnico nas mensagens.
6. **Horário sempre de Brasília**, em qualquer aparelho.

## 2. Tokens

### Cores — tema claro (padrão)
| Token | Valor | Uso |
|---|---|---|
| `--color-ink` | `#1a1a2e` | Texto principal |
| `--color-ink2` | `#16213e` | Texto secundário escuro |
| `--color-cream` / `--color-bg` | `#f7f3ee` | Fundo do app |
| `--color-white` | `#ffffff` | Superfície de card (**inverte no escuro**) |
| `--color-muted` | `#6b6457` | Texto de apoio |
| `--color-border` | `#e8e2d9` | Bordas |
| `--color-p1` | `#ff6b35` | Laranja da marca (destaque, CTA) |
| `--color-p1-text` / `--color-p1-button` | `#ad4924` | Laranja escurecido para contraste AA |
| `--color-p2` | `#f7c59f` | Pêssego |
| `--color-p3` | `#2ec4b6` | Turquesa |
| `--color-p4` / `--color-danger` | `#e63946` | Vermelho / erro |
| `--color-p5` | `#8338ec` | Violeta |
| `--color-success` | `#16a34a` | Sucesso |
| `--color-ink-fixed` | `#1a1a2e` | Barras escuras que **não** invertem |
| `--color-white-fixed` | `#ffffff` | Texto sobre barra escura, **não** inverte |

### Tema escuro (opt-in)
Ativado só pelo `ThemeToggle` (rodapé do perfil), salvo em
`localStorage.theme`; **não** segue `prefers-color-scheme`. Aplicado antes do
primeiro paint por script inline no `<head>`.

| Token | Escuro |
|---|---|
| ink / ink2 | `#ece8e1` / `#cfd6e4` |
| bg | `#14161d` |
| cream | `#262b38` |
| white (card) | `#1e2230` |
| muted / border | `#a59f95` / `#2f3545` |

**Regra:** em chrome sempre escuro (TopNav, BottomNav, topo da Loja,
cabeçalho do perfil) usar `*-fixed`. `text-white` ali some no modo escuro
(`__tests__/temaEscuroChrome.test.ts` trava isso).

### Tipografia
| Papel | Fonte | Variável |
|---|---|---|
| Display (títulos, logo) | Syne | `--font-display` |
| Corpo | DM Sans | `--font-body` |

Campos de formulário em tela de toque têm **16px no mínimo** (abaixo disso o
iOS dá zoom e a tela "corta").

### Gradientes dos tiles do perfil
| Nome | Gradiente | Uso |
|---|---|---|
| `art` (padrão) | `#ff6b35 → #8338ec` | Ferramentas gerais |
| `pro` | `#2ec4b6 → #8338ec` | Recursos PRO |
| `designer` | `#a78bfa → #7c3aed` | Alice |
| `graf` | `#ff6b35 → #e10600` | Fê / grafite |
| `auto` | `#e10600 → #1a1a2e` | Senna |
| `revista` | `#ff6b35 → #1a1a2e` | Click Rua |

## 3. Componentes-base (`next-app/components/`)

| Componente | Papel |
|---|---|
| `AppShell` | Moldura: TopNav + área rolável + BottomNav; guardas de login/perfil; altura `100dvh` |
| `TopNav` / `BottomNav` | Navegação fixa, badges de não lidas |
| `BottomSheet` | Gaveta de baixo (z-1000); fecha por X, toque fora, Esc ou arrasto |
| `Dialog` | Modal centrado |
| `ComboBox` | Campo com filtro por digitação (estado/cidade) — substitui `<select>` no celular |
| `Avatar` | Foto com fallback de inicial, `srcset` via Image Resizing |
| `ToastViewport` / `showToast()` | Avisos empilhados |
| `FriendlyErrorToast` | Erro traduzido para linguagem simples (`lib/errors-friendly.ts`) |
| `UndoSnackbar` + `useUndoable` | "Desfazer" por 10 s após excluir |
| `Skeletons` | Carregamento com forma do conteúdo |
| `EmailVerifyBanner` | Faixa amarela até confirmar e-mail |
| `OfflineBanner` | Faixa "sem conexão" |
| `AppTour` | Coach marks (holofote + balão) |
| `StoriesCarousel` / `StoryViewer` | Stories; viewer em tela cheia (z-400, portal no body) |
| `AiConsentGate` | Consentimento antes da IA |
| `ThemeToggle` | Claro / escuro |
| `GaleriaBloqueadaSheet`, `CameraCapture` | Saída quando a galeria do aparelho falha |
| `SplashMascotes` | Tela de carregamento com os 4 mascotes |

Específicos de tela: `PostCard` (`app/feed/`), `BusinessCard`
(`app/perfil/BusinessGrid.tsx`), `ProductCard`, `OrderCard`, `LeadCard`.

## 4. Personas e mascotes

| Persona | Público | Tom |
|---|---|---|
| **Seu Zé** | Pintor, arquiteto | Pintor experiente, prático |
| **Alice Codessi** | Cliente | Designer de interiores |
| **Fê** | Grafiteiro | Cena do grafite |
| **Senna** | Automotivo | Funilaria e pintura automotiva |

Imagens em `/img/<id>.webp`. Os mascotes-ursinhos da Cali Colors (Alice, Seu
Zé, Senna, Fê) aparecem na splash de boot.

## 5. Padrões de interação

| Situação | Padrão |
|---|---|
| Ação de rede | Otimista; falha reverte com aviso e o dado volta ao campo |
| Excluir | Soft delete + `UndoSnackbar` de 10 s |
| Formulário inválido | Mensagem "Falta corrigir: …" e rolagem até o campo |
| Erro de servidor (5xx) | Página "Reconectando…" com retry automático (service worker) |
| Sem internet | `OfflineBanner`; retry ao voltar a conexão |
| Lista longa | Janela de itens que cresce por `IntersectionObserver` |
| Escolher arquivo no Android | Botão de câmera ao lado; se a galeria falhar, sheet com saídas |
| Salvar imagem/PDF no app | Share nativo → arquivo → download (nunca `<a download>` cru) |
| Link externo no app | `abrirLinkExterno` (nunca `window.location` para fora) |
| Voltar do Android | Fecha overlay (story, revista) antes de sair da tela |
| Retorno tátil | Haptics ao trocar aba, curtir, salvar, publicar |

## 6. Layout e responsividade

- Altura de tela cheia sempre em `dvh` (o `vh` do Safari esconde conteúdo
  atrás das barras).
- Dentro de `BottomSheet`, breakpoints do Tailwind mentem (olham a janela);
  usar `grid-template-columns: repeat(auto-fill, minmax(…))`.
- `flex-1` em campo de texto pede `min-w-0`; botões ao lado `shrink-0`.
- Filho de coluna flex de altura fixa que pode crescer precisa de
  `overflow` + `min-height: 0`.
- Overlay aberto de dentro de um sheet precisa de z-index > 1000.
- Legenda e comentários preservam quebra de linha (`white-space: pre-wrap`).

## 7. Acessibilidade

- Contraste AA no laranja de texto (`p1-text`).
- Pinch-zoom liberado (nunca `maximum-scale=1`).
- Animações respeitam `prefers-reduced-motion`.
- Alvos de toque de 40px+ em controles de overlay.
- 🟡 Revisão sistemática de `aria-label` e leitura de tela ainda não feita.

## 8. Lacunas conhecidas

- Não existe biblioteca de design (Figma) versionada — o sistema está só no
  código.
- Não há componente `EmptyState` padronizado; cada tela resolve o vazio.
- Portal da loja tem estilo próprio (JSX sem Tailwind), fora deste sistema.
