// lib/services/moderateMedia.ts — gate de moderação compartilhado por TODO
// upload de imagem pública do usuário (posts, avatar, biblioteca de artes
// do AR Grafite). Client-safe (`fetchGated`, sem import de lib/api/security).
//
// Criado em resposta a 2 achados do Codex na revisão da PR que fechou as
// pendências da auditoria de negócio 2026-09-16 (#325):
//
//   1. "Do not publish after moderation quota or rate denials" — o check
//      original tratava QUALQUER `!res.ok` (incluindo 429 de rate limit OU
//      da cota de moderação) como "infra indisponível, segue sem bloquear".
//      Isso transformava o próprio limite anti-abuso num bypass: estourar
//      de propósito o rate limit de `/api/moderate` liberava publicar sem
//      moderação nenhuma. Agora só 503/rede (infra de verdade fora do ar)
//      é fail-open; 429 (o servidor respondeu, e respondeu "não agora")
//      BLOQUEIA.
//   2. "Derive blocklist hashes from authoritative media bytes" (avatar/
//      art-references) — as triggers de blocklist em `profiles.avatar_hash`
//      e `art_references.image_hash` confiam no hash que o CLIENTE manda,
//      e RLS deixa o dono escrever a própria linha direto via PostgREST —
//      então a única defesa contra conteúdo bloqueado era falsificável (só
//      não mandar o hash certo). `/api/moderate` já resolve isso pra posts:
//      quando recebe `mediaUrl`, baixa o arquivo e calcula o hash NO
//      SERVIDOR (não confia em nada que o cliente mandou) — é essa mesma
//      chamada que agora roda também no upload de avatar e de art-reference,
//      então a checagem de verdade deixa de depender só do trigger
//      (que fica como defesa em profundidade, igual sempre foi pra posts).

import { ValidationError } from '@/lib/errors';
import { fetchGated } from '@/lib/services/fetchGated';

/**
 * Verifica uma imagem já publicada num bucket do Supabase Storage contra
 * moderação (blocklist de hash + Gemini). Lança `ValidationError` quando
 * reprovada OU quando o servidor está deliberadamente recusando por
 * excesso de chamadas (429 — rate limit ou cota de moderação estourados).
 *
 * Fail-OPEN só em falha de INFRAESTRUTURA de verdade (rede, 503 sem
 * `GEMINI_API_KEY`, resposta que não parseia) — moderação é defesa em
 * profundidade, não pode travar quem publica quando o Gemini está fora do
 * ar. Mas 429 significa que o servidor RESPONDEU e disse "não agora": não
 * é falha de infra, é o próprio limite anti-abuso — deixar passar ali
 * transformaria o limite num bypass (achado do Codex na PR #325).
 */
export async function assertMediaApproved(args: {
  mediaUrl: string;
  text?: string | null;
}): Promise<void> {
  try {
    const res = await fetchGated('/api/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaUrl: args.mediaUrl,
        text: args.text || undefined,
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        flagged?: boolean;
        approved?: boolean;
      };
      if (json.flagged === true || json.approved === false) {
        throw new ValidationError(
          'Este conteúdo não pode ser publicado por violar as diretrizes da comunidade.',
        );
      }
      return;
    }
    if (res.status === 429) {
      throw new ValidationError(
        'Muitas verificações de moderação em pouco tempo — aguarde um instante e tente de novo.',
      );
    }
    // Outro status não-ok (503 sem GEMINI_API_KEY, 500, etc.): infra
    // indisponível, não o servidor recusando — segue sem bloquear.
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    // Rede/parse: infra indisponível, segue sem bloquear.
  }
}
