// app/api/whatsapp-evo/webhook/route.ts — recebe eventos do Evolution API
// (WhatsApp via Baileys no Render) e grava as mensagens em
// `whatsapp_messages` (mesma tabela/tela do canal Meta — /admin/whatsapp).
//
// Autenticação: a Evolution NÃO assina eventos (sem HMAC tipo Meta), então o
// segredo vai na PRÓPRIA URL configurada no Manager:
//   https://www.queroumacor.com.br/api/whatsapp-evo/webhook?token=<EVOLUTION_WEBHOOK_TOKEN>
// Token errado/ausente → 401 e nada é processado.
//
// Depois de autenticado, SEMPRE 200 (anti retry-storm, igual mp-webhook e
// whatsapp/webhook): falha de persistência não pode fazer a Evolution
// re-entregar em loop — persistWhatsAppMessage já é best-effort e o
// message_id UNIQUE deduplica retries.
//
// Configurar no Manager: instância `meu-whatsapp` → Configurations →
// Webhook → URL acima, evento MESSAGES_UPSERT habilitado.

import { type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/lib/api/env';
import { jsonResponse, readBody, ServiceError, serviceErrorResponse } from '@/lib/api/security';
import { persistWhatsAppMessage, safeEqual } from '@/lib/api/_services/whatsapp';
import { parseEvolutionWebhook } from '@/lib/api/_services/whatsapp-evo';
import { maybeAutoReply } from '@/lib/api/_services/whatsapp-ai-runner';
import { processarMidia } from '@/lib/api/_services/whatsapp-media';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const expected = getRuntimeEnv('EVOLUTION_WEBHOOK_TOKEN') || '';
  if (!expected) {
    return jsonResponse(
      { error: 'webhook não configurado (EVOLUTION_WEBHOOK_TOKEN ausente)' },
      503
    );
  }
  const provided = request.nextUrl.searchParams.get('token') || '';
  // Comparação em tempo constante, igual ao webhook da Meta (`safeEqual`).
  if (!safeEqual(provided, expected)) {
    return jsonResponse({ error: 'token inválido' }, 401);
  }

  let payload: unknown;
  try {
    // 20MB porque, com "Webhook Base64" ligado no Manager, o ARQUIVO vem
    // dentro do JSON — e base64 infla ~37%. Com o limite antigo de 1MB uma
    // foto grande estourava e a mensagem inteira era descartada (o catch
    // devolve 200 e nao grava nada): o cliente mandava a foto da parede e
    // ela sumia do portal. O teto de mídia guardada continua sendo o
    // MAX_MEDIA_BYTES do whatsapp-media (12MB).
    payload = await readBody(request, { maxBytes: 20 * 1024 * 1024 });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    // Corpo não-JSON: 200 mesmo assim — não vale retry.
    return jsonResponse({ ok: true, ignored: 'corpo inválido' });
  }

  try {
    const messages = parseEvolutionWebhook(payload);
    let persisted = 0;
    const ia: string[] = [];
    for (const msg of messages) {
      // Foto, áudio, vídeo e documento: guarda o ARQUIVO (bucket privado)
      // e transcreve o áudio. Sem isso o portal só mostrava "[áudio]" e
      // quem atendia tinha que abrir o celular pra saber o que era.
      const midia =
        msg.type !== 'text'
          ? await processarMidia({
              waId: msg.waId,
              messageId: msg.messageId,
              tipo: msg.type,
              item: msg.raw,
              key: msg.key,
            })
          : { mediaUrl: null, mediaMime: null, transcript: null };

      const ok = await persistWhatsAppMessage({
        direction: msg.direction,
        // 'out' vindo do webhook = digitada no CELULAR. O eco do que o
        // portal/IA enviou chega aqui também, mas colide no message_id e o
        // ignore-duplicates descarta — só sobra o que nasceu no aparelho.
        origin: msg.direction === 'out' ? 'celular' : null,
        waId: msg.waId,
        profileName: msg.profileName,
        messageId: msg.messageId,
        type: msg.type,
        body: msg.text,
        waTimestamp: msg.timestamp,
        mediaUrl: midia.mediaUrl,
        mediaMime: midia.mediaMime,
        transcript: midia.transcript,
      });
      if (ok) persisted++;

      // Atendimento automático: só pra mensagem RECEBIDA. Nunca pra 'out'
      // (senão a IA responderia a si mesma em loop). Áudio TRANSCRITO
      // entra como texto — antes a IA ficava muda quando o cliente
      // mandava voz, que é metade das mensagens no Brasil. O runner é
      // best-effort e decide sozinho se age — ver whatsapp-ai-runner.ts.
      const paraIa = msg.type === 'text' ? msg.text : midia.transcript || '';
      if (msg.direction === 'in' && paraIa.trim()) {
        const r = await maybeAutoReply({ waId: msg.waId, text: paraIa });
        ia.push(r.why);
      }
    }
    return jsonResponse({ ok: true, received: messages.length, persisted, ia });
  } catch (e) {
    // Nunca 5xx pós-token: loga e devolve 200 pra Evolution não re-entregar.
    console.warn('whatsapp-evo webhook erro:', e instanceof Error ? e.message : e);
    return jsonResponse({ ok: true, error: 'processamento falhou (logado)' });
  }
}
