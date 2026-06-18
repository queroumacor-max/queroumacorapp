# App Store Connect — Privacy Nutrition Label (QueroUmaCor)

Mapa dado-por-dado pra preencher em **App Store Connect → App Privacy**.
Baseado no que o app realmente coleta (auditoria 2026-06-18). Mantenha
consistente com o app — inconsistência = rejeição (Apple Guideline 5.1.1).

> Para cada tipo: marque o uso, se é **linkado à identidade** do usuário
> (Linked) e se é usado pra **rastreamento** (Tracking). O QueroUmaCor
> **NÃO faz tracking cross-app/cross-site** nem usa data brokers → em TODOS
> os itens, **Tracking = NÃO**.

---

## Contact Info
| Dado | Coletado? | Linked | Usos | Onde no app |
|---|---|---|---|---|
| Name | Sim | Sim | App Functionality | cadastro / perfil |
| Email Address | Sim | Sim | App Functionality, Account Mgmt | cadastro / auth (Supabase) |
| Phone Number | Sim* | Sim | App Functionality, Customer Support | cadastro (obrigatório p/ profissional, **opcional p/ cliente**) |

\* Telefone é opcional pro perfil Cliente — declare como coletado, pois ainda
é coletado de profissionais.

## Identifiers
| Dado | Coletado? | Linked | Usos |
|---|---|---|---|
| User ID | Sim | Sim | App Functionality (conta, posts, follows) |
| (tag/@username) | Sim | Sim | App Functionality (identificador público de perfil) |

> Sem **Device ID** pra advertising. Sem IDFA.

## Location
| Dado | Coletado? | Linked | Usos |
|---|---|---|---|
| Coarse Location | Sim | Sim | App Functionality (mostrar profissionais/serviços por perto) |

> **Precise Location = NÃO.** Usamos só cidade/UF aproximada informada pelo
> usuário, não GPS fino.

## User Content
| Dado | Coletado? | Linked | Usos |
|---|---|---|---|
| Photos or Videos | Sim | Sim | App Functionality (portfólio, posts, stories, avatar) |
| Customer Support | Sim | Sim | Customer Support (mensagens ao suporte) |
| Other User Content | Sim | Sim | App Functionality (textos/legendas, orçamentos, avaliações, mensagens de chat) |

## Usage Data
| Dado | Coletado? | Linked | Usos |
|---|---|---|---|
| Product Interaction | Sim | Sim | App Functionality, Analytics (orçamentos, mensagens, navegação) |

## Diagnostics
| Dado | Coletado? | Linked | Usos |
|---|---|---|---|
| Crash Data | Sim | **Não** (Not Linked) | App Functionality / Analytics (Sentry) |
| Performance Data | Sim | **Não** | Analytics (Sentry Web Vitals) |

> Sentry coleta erros/performance sem PII identificável → marque **Not Linked**.

---

## Sub-processadores / terceiros (pra referência interna e item 5 da Privacidade)
- **Supabase** (EUA) — banco, auth, storage.
- **Cloudflare** (EUA) — CDN/edge, proteção.
- **OpenAI** e **Google (Gemini)** (EUA) — recursos de IA (Seu Zé/Alice/Senna/Fê).
  Há **opt-in explícito de consentimento** antes do 1º uso (AiConsentGate).
- **Sentry** (EUA) — erros/performance (sem PII).
- **Mercado Pago** (Brasil) — pagamento do plano PRO via web (no app, PRO é por
  troca de pontos; sem cobrança in-app).

## Checklist de consistência (evita rejeição)
- [ ] Tracking = NÃO em todos os itens (sem ATT prompt necessário).
- [ ] Telefone declarado mesmo sendo opcional p/ cliente.
- [ ] Coarse (não Precise) Location.
- [ ] Crash/Performance = Not Linked.
- [ ] IA com consentimento explícito documentado (Guideline 5.1.1).
- [ ] Texto da Política de Privacidade (`/info/privacidade`) bate com esta tabela.
