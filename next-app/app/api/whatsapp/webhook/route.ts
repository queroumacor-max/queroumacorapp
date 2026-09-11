// app/api/whatsapp/webhook/route.ts — webhook do WhatsApp Cloud API (Meta).
//
// GET  = verificação de assinatura do webhook (painel da Meta ou Dualhook):
//        confere `hub.verify_token` contra WHATSAPP_WEBHOOK_VERIFY_TOKEN e
//        devolve `hub.challenge` em texto puro.
// POST = eventos (mensagens recebidas + status de entrega). Duas checagens,
//        nesta ordem:
//          1. o `?token=` da URL contra WHATSAPP_WEBHOOK_URL_SECRET
//             (constant-time) — é ISTO que autentica o remetente;
//          2. o envelope: `object` = whatsapp_business_account, `entry[].id`
//             = WHATSAPP_WABA_ID e `metadata.phone_number_id` =
//             WHATSAPP_PHONE_NUMBER_ID.
//        Envelope de outra conta → 403. Evento do NOSSO WABA que não é de
//        mensagem (status de template, mudança de conta) → 200 e ignora: a
//        Meta reenvia indefinidamente o que não recebeu 200, e "não me
//        interessa" não é "não recebi".
//
// O `X-Hub-Signature-256` NÃO é mais validado no POST (2026-09-05). Com a
// WABA inscrita no app Meta DO DUALHOOK, a assinatura é feita com o App
// Secret deles — que não é exposto —, então o HMAC com META_APP_SECRET
// jamais bateria e todo POST caía em 401. Os IDs do envelope, sozinhos, não
// autenticam ninguém (são públicos): quem faz esse papel é o segredo de URL.
//
// Passou nas duas: responde 200 NA HORA e processa o payload depois da
// resposta (`runAfterResponse` → `ctx.waitUntil` do worker). A Meta espera
// resposta rápida e desativa webhook que demora ou falha; gravar no banco
// antes de responder colocava a latência do Supabase no caminho dela.
//
// REGRA que custou um 500 em produção (2026-09-05): nada no processamento
// assíncrono pode derrubar a resposta. `runAfterResponse` chamava
// `ctx.waitUntil` desamarrado do `ctx` e o runtime nativo lançava
// `Illegal invocation` de forma SÍNCRONA, dentro do handler — a mensagem
// aparecia no log e logo depois vinha 500. Hoje o keep-alive é chamado no
// objeto dono e embrulhado em try/catch, e o teste da rota
// (`__tests__/api/whatsapp-webhook.test.ts`) trava o 200 mesmo com o
// `waitUntil` recusando e com o atendimento automático lançando.
//
// O POST reconhece, loga, persiste (console → Cloudflare logs; tabela
// `whatsapp_messages`) e dispara o ATENDIMENTO AUTOMÁTICO. Este último elo
// faltava: o `maybeAutoReply` só era chamado pelo webhook da Evolution, que
// foi aposentada — a IA parou de responder sem ninguém notar, porque a
// mensagem continuava chegando no portal normalmente.

import { type NextRequest, NextResponse } from 'next/server';
import { paraLog } from '@/lib/api/_services/_untrusted';
import { getRuntimeEnv, runAfterResponse } from '@/lib/api/env';
import {
  checkWebhookUrlSecret,
  getPhoneNumberId,
  getWabaId,
  getWebhookAuthMode,
  classifyWebhookPayload,
  parseInboundMessages,
  parseEchoMessages,
  parseStatusUpdates,
  persistStatusDoLead,
  persistStatusEntrega,
  persistWhatsAppMessage,
  statusAvanca,
  TIPOS_SEM_CONVERSA,
  type AtualizacaoDeStatus,
  resumirEnvelope,
  type InboundWhatsAppMessage,
} from '@/lib/api/_services/whatsapp';
import { maybeAutoReply } from '@/lib/api/_services/whatsapp-ai-runner';
import {
  baixarMidiaCloudApi,
  caminhoMidia,
  subirMidia,
  transcreverAudio,
} from '@/lib/api/_services/whatsapp-media';
import {
  DUALHOOK_API_BASE,
  GRAPH_API_VERSION,
} from '@/lib/api/_services/whatsapp';

export const runtime = 'edge';

// Tetos do webhook (auditoria 2026-09-11). Ver comentários no POST.
const WEBHOOK_MAX_BYTES = 2 * 1024 * 1024;
const WEBHOOK_MAX_ITENS = 50;

export async function GET(request: NextRequest) {
  const verifyToken = getRuntimeEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  if (!verifyToken) {
    return NextResponse.json(
      { error: 'webhook não configurado (WHATSAPP_WEBHOOK_VERIFY_TOKEN ausente)' },
      { status: 503 }
    );
  }
  const url = new URL(request.url);
  if (getWebhookAuthMode() === 'payload') {
    const check = checkWebhookUrlSecret(url, getRuntimeEnv('WHATSAPP_WEBHOOK_URL_SECRET'));
    if (check === 'missing-config') {
      return NextResponse.json(
        { error: 'webhook não configurado (WHATSAPP_WEBHOOK_URL_SECRET ausente)' },
        { status: 503 }
      );
    }
    if (check === 'invalid') {
      return NextResponse.json({ error: 'verificação inválida' }, { status: 403 });
    }
  }
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    // A Meta espera o challenge cru em texto puro, status 200.
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return NextResponse.json({ error: 'verificação inválida' }, { status: 403 });
}

/**
 * Busca o arquivo de uma mensagem de mídia e sobe pro bucket privado.
 *
 * Best-effort em cada degrau: falhar aqui deixa a mensagem na conversa com o
 * marcador do tipo, que é pior que ter o arquivo mas MUITO melhor que perder
 * a mensagem. Nada aqui pode lançar — isto roda depois da resposta, e a Meta
 * já recebeu o 200.
 *
 * Áudio ainda é transcrito (Whisper): é o que faz a mensagem de voz entrar na
 * prévia da lista e no histórico que a IA lê — sem isso ela responderia no
 * vácuo quando o cliente manda áudio.
 */
async function materializarMidia(
  msg: InboundWhatsAppMessage
): Promise<{ path?: string; mime?: string; transcript?: string } | null> {
  if (!msg.mediaId) return null;
  try {
    const token = getRuntimeEnv('DUALHOOK_API_KEY') || '';
    if (!token) return null;
    const baixado = await baixarMidiaCloudApi(
      msg.mediaId,
      DUALHOOK_API_BASE,
      GRAPH_API_VERSION,
      token
    );
    if (!baixado) return null;

    const mime = baixado.mime || msg.mediaMime || '';
    const path = caminhoMidia(msg.from, msg.messageId, mime, msg.type);
    const salvo = await subirMidia(path, baixado.bytes, mime);
    if (!salvo) return null;

    let transcript: string | undefined;
    if (msg.type === 'audio' || msg.type === 'voice') {
      const t = await transcreverAudio(baixado.bytes, mime);
      if (t) transcript = t;
    }
    return { path: salvo, mime, transcript };
  } catch (e) {
    console.warn(
      '[whatsapp-webhook] mídia não materializada:',
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * Loga e grava as mensagens. Roda DEPOIS da resposta (ver `runAfterResponse`),
 * então nada aqui pode afetar o status — só o log conta o que aconteceu.
 */
async function processarEntrada(messages: InboundWhatsAppMessage[]): Promise<void> {
  for (const msg of messages) {
    // Log estruturado → Cloudflare logs. Não logar o corpo inteiro
    // (conversa de cliente); preview basta pra depurar entrega.
    // `paraLog`: nome de contato/texto com `\n` forjava linha de log inteira.
    console.log(
      `[whatsapp-webhook] msg de ${paraLog(msg.from, 20)} (${paraLog(msg.profileName || 'sem nome', 40)}) ` +
        `type=${paraLog(msg.type, 20)} id=${paraLog(msg.messageId, 80)} preview="${paraLog(msg.text, 60)}"`
    );
  }
  // Mídia recebida (áudio, foto, vídeo, figurinha, documento). Na Cloud API
  // o webhook traz só um id; os bytes se buscam depois. Sem isto a conversa
  // mostrava "[audio]" e "[sticker]" secos, sem como ouvir nem ver.
  const midias = await Promise.all(messages.map((m) => materializarMidia(m)));

  // SQL Wave 38: grava em `whatsapp_messages` (best-effort; wamid UNIQUE
  // dedupa retries da Meta).
  const persisted = await Promise.all(
    messages.map((msg, i) =>
      persistWhatsAppMessage({
        // Eco do celular (2026-09-09): a loja respondeu pelo app do
        // aparelho. Entra como 'out' com origem 'celular' — é o que o chip
        // 📱 da lista de conversas lê. Sem isto a resposta dada no celular
        // não existia no portal e a conversa parecia abandonada.
        direction: msg.echo ? 'out' : 'in',
        waId: msg.from,
        profileName: msg.echo ? undefined : msg.profileName,
        messageId: msg.messageId,
        type: msg.type,
        body: msg.text,
        waTimestamp: msg.timestamp,
        ...(msg.echo ? { origin: 'celular' as const } : {}),
        mediaUrl: midias[i]?.path,
        mediaMime: midias[i]?.mime,
        transcript: midias[i]?.transcript,
      })
    )
  );
  if (persisted.some((ok) => !ok)) {
    console.warn('[whatsapp-webhook] falha ao persistir parte das mensagens (best-effort)');
  }

  // Atendimento automático. SÓ pra mensagem de texto recebida — nunca pra
  // 'out', senão a IA responderia a si mesma em loop. O runner é best-effort
  // e decide sozinho se age (horário, opt-out, teto diário, chave da
  // conversa); aqui só registramos o que ele decidiu.
  //
  // Roda DEPOIS da resposta (este `processarEntrada` inteiro está no
  // waitUntil), então a IA pode levar o tempo dela sem atrasar o 200 que a
  // Meta espera.
  for (const msg of messages) {
    const texto = (msg.text || '').trim();
    if (!texto) continue;
    // Eco do celular é a LOJA falando; reação/edição não é a pessoa
    // falando. Nenhum dos dois acorda a IA.
    if (msg.echo || TIPOS_SEM_CONVERSA.has(msg.type)) continue;
    try {
      const r = await maybeAutoReply({ waId: msg.from, text: texto });
      console.log(`[whatsapp-webhook] ia ${msg.from}: ${r.acted ? '✓' : '·'} ${r.why}`);
    } catch (e) {
      // maybeAutoReply promete não lançar; se lançar mesmo assim, não pode
      // derrubar o trabalho de fundo das outras mensagens.
      console.error(
        '[whatsapp-webhook] runner da IA falhou:',
        e instanceof Error ? e.message : e
      );
    }
  }
}

/**
 * Grava os avisos de entrega. Roda depois da resposta, como o resto.
 *
 * A Meta reenvia e pode entregar FORA DE ORDEM — um `sent` atrasado
 * chegando depois do `read` não pode fazer o status andar pra trás. Quem
 * decide é `statusAvanca`; aqui só deduplicamos o lote antes de escrever,
 * pra não gastar N PATCHs na mesma mensagem quando o envelope traz
 * `sent`+`delivered` juntos.
 */
async function processarStatus(lista: AtualizacaoDeStatus[]): Promise<void> {
  const maisAvancado = new Map<string, AtualizacaoDeStatus>();
  for (const st of lista) {
    const atual = maisAvancado.get(st.messageId);
    if (!atual || statusAvanca(atual.status, st.status)) {
      maisAvancado.set(st.messageId, st);
    }
  }
  for (const st of maisAvancado.values()) {
    // `failed` é o que o operador precisa ver, então vai pro log com o
    // motivo: é ele que separa "número sem WhatsApp" de "recusou marketing"
    // de "limite da Meta".
    if (st.status === 'failed') {
      console.warn(
        `[whatsapp-status] FALHOU msg=${paraLog(st.messageId, 80)} para=${paraLog(st.recipientId, 20)}: ${paraLog(st.erro || 'sem detalhe', 160)}`
      );
    }
    await persistStatusEntrega(st);
    await levarStatusAoLead(st);
  }
}

// Folga pro vínculo wamid→lead da rota de envio pousar. A Meta pode mandar
// o `sent` antes de a rota terminar a escrituração (os dois correm em
// paralelo, em máquinas diferentes); sem esta segunda chance o lead ficaria
// `novo` pra sempre com a mensagem entregue.
const ESPERA_VINCULO_MS = 1500;

/**
 * Leva o aviso até o lead (2026-09-09): é o que faz `contactado` na tela de
 * Leads significar "a Meta confirmou", e `failed` desfazer a marcação.
 * Best-effort como o resto; 'sem-lead' é normal (mensagem que não era
 * abordagem) — só tentamos de novo uma vez, pela corrida acima.
 */
async function levarStatusAoLead(st: AtualizacaoDeStatus): Promise<void> {
  let r = await persistStatusDoLead(st);
  if (r === 'sem-lead') {
    await new Promise((resolve) => setTimeout(resolve, ESPERA_VINCULO_MS));
    r = await persistStatusDoLead(st);
  }
  if (r === 'contactado' || r === 'desfeito') {
    console.log(`[whatsapp-lead] ${r} msg=${st.messageId} status=${st.status}`);
  }
}

export async function POST(request: NextRequest) {
  // (1) Segredo de URL — o que realmente autentica o remetente.
  const check = checkWebhookUrlSecret(
    new URL(request.url),
    getRuntimeEnv('WHATSAPP_WEBHOOK_URL_SECRET')
  );
  if (check !== 'ok') {
    // Fail-closed também quando a env falta: sem segredo não dá pra
    // distinguir a Meta de qualquer um. O motivo vai no corpo — 403 sozinho
    // não diferencia "env não subiu" de "token errado", e essa distinção é
    // a primeira pergunta de quem for depurar.
    console.warn(`[whatsapp-webhook] POST recusado: url-secret ${check}`);
    return NextResponse.json(
      {
        error: 'não autorizado',
        reason: check === 'missing-config' ? 'url_secret_ausente' : 'token_invalido',
      },
      { status: 403 }
    );
  }

  // Teto de corpo (2026-09-11): era `request.text()` sem limite — a única
  // rota de webhook sem `readBody`. O envelope da Meta tem poucos KB; os
  // bytes de mídia NÃO vêm nele (só um id). 2MB sobra e barra o resto.
  const tamanho = parseInt(request.headers.get('content-length') || '0', 10);
  if (Number.isFinite(tamanho) && tamanho > WEBHOOK_MAX_BYTES) {
    return NextResponse.json({ error: 'payload grande demais' }, { status: 413 });
  }
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    /* body vazio cai no parse abaixo */
  }
  if (rawBody.length > WEBHOOK_MAX_BYTES) {
    return NextResponse.json({ error: 'payload grande demais' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json(
      { error: 'não autorizado', reason: 'payload_invalido' },
      { status: 403 }
    );
  }

  // (2) O envelope tem que ser do NOSSO WABA + número.
  const expected = { wabaId: getWabaId(), phoneNumberId: getPhoneNumberId() };
  const veredito = classifyWebhookPayload(payload, expected);

  // Evento que não é de mensagem (status de template, mudança de conta):
  // 200 e segue a vida. 403 aqui fazia a Meta REENVIAR pra sempre um evento
  // que nunca íamos processar — "não interessa" não é "não recebi".
  if (veredito === 'ignorar') {
    console.log(`[whatsapp-webhook] evento ignorado — ${resumirEnvelope(payload)}`);
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  if (veredito === 'rejeitar') {
    // Nomear os dois lados é o ponto: este 403 é INVISÍVEL pra quem usa o
    // portal (a entrega some, nada aparece na tela), então esta linha é a
    // única pista. Recebido × esperado responde na hora se o caso é env
    // errada no Cloudflare ou webhook apontado pra outra conta.
    console.warn(
      `[whatsapp-webhook] payload rejeitado — recebido: ${resumirEnvelope(payload)} | ` +
        `esperado: waba=${expected.wabaId} phone_number_id=${expected.phoneNumberId}`
    );
    return NextResponse.json(
      { error: 'não autorizado', reason: 'payload_inesperado' },
      { status: 403 }
    );
  }

  // Autenticado: 200 IMEDIATO, processamento depois da resposta. O parse é
  // barato e fica aqui pra um payload malformado não sumir no silêncio do
  // trabalho de fundo; o que custa (Supabase) é que vai pro waitUntil.
  let messages: InboundWhatsAppMessage[] = [];
  try {
    // Recebidas + ecos do que a loja mandou pelo celular, no mesmo lote: o
    // processamento é o mesmo (mídia, gravação), só muda direção/origem.
    messages = [...parseInboundMessages(payload), ...parseEchoMessages(payload)];
  } catch (e) {
    console.error(
      'whatsapp-webhook: falha ao ler o payload (200 mesmo assim):',
      e instanceof Error ? e.message : e
    );
  }
  // Avisos de ENTREGA (sent/delivered/read/failed) das mensagens que a loja
  // mandou. Vinham no mesmo envelope e eram DESCARTADOS: o parse de
  // mensagens devolvia lista vazia e nada mais olhava o payload. O portal
  // registrava que mandamos e nunca sabia se chegou.
  // Teto por lote: cada mensagem custa download de mídia + Whisper + IA +
  // um envio de WhatsApp, e cada status pode custar 1,5s de espera. Um
  // envelope autenticado com milhares de itens virava fatura e travamento.
  const statuses = parseStatusUpdates(payload).slice(0, WEBHOOK_MAX_ITENS);
  if (messages.length > WEBHOOK_MAX_ITENS) {
    console.warn(`[whatsapp-webhook] lote com ${messages.length} mensagens; processando ${WEBHOOK_MAX_ITENS}`);
    messages = messages.slice(0, WEBHOOK_MAX_ITENS);
  }

  if (messages.length > 0) runAfterResponse(processarEntrada(messages));
  if (statuses.length > 0) runAfterResponse(processarStatus(statuses));

  return NextResponse.json({ received: true }, { status: 200 });
}
