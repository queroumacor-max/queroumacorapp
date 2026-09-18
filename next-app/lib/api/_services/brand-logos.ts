// lib/api/_services/brand-logos.ts — materializa os logos que a IA devolve
// em arquivos no Storage e registra cada um em `public.brand_logos`.
//
// Por que no servidor: o gpt-image-1 responde `b64_json`, então o que chegava
// no cliente era uma data URL de ~1.5MB. Salvar isso em
// `profiles.business_logo_url` (coluna text) funcionava por acidente, mas as
// variantes não escolhidas evaporavam e o /portal não tinha o que mostrar.
// Aqui o base64 vira PNG no bucket `posts` (já público pra leitura) sob
// `<userId>/logos/<uuid>.png` — o prefixo de userId é o que as policies de
// storage (Wave 27) exigem — e a linha em `brand_logos` guarda o dono e o
// prompt.
//
// Contrato de falha: NUNCA derruba a geração. Se o upload ou o insert
// falharem, devolvemos a imagem original (data URL) pro cliente e a tela
// segue funcionando como antes — o pintor não perde o logo que acabou de
// gerar por causa de um 500 do storage. Mas falha silenciosa é perda
// invisível, então toda falha é reportada (ver `reportLoss`).

import * as Sentry from '@sentry/nextjs';
import { getServiceKey, getSupabaseUrl } from '../security';
import { isPubliclyRoutableHttpsUrl } from '../ssrf-guard';

const BUCKET = 'posts';

// Uma segunda tentativa por imagem. A regra do produto é "toda imagem gerada
// fica salva", e um 500 passageiro do storage não pode ser o motivo de uma
// arte sumir — a geração já custou ~40s e cota de IA, então +300ms de retry
// é barato perto de perder o arquivo.
const RETRY_DELAY_MS = 300;

export interface PersistBrandLogosArgs {
  /** Dono do logo. Sem ele não há o que registrar — devolve as imagens cruas. */
  userId: string | undefined;
  /** Imagens como vieram da IA: data URL base64 ou URL http. */
  images: string[];
  promptName?: string;
  promptStyle?: string;
}

interface LossContext {
  supaUrl?: string;
  serviceKey?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

/**
 * Roda `fn`, e se ela devolver null tenta de novo depois de um respiro.
 * `ctxFn` é função (não objeto) de propósito: o motivo real da falha —
 * status HTTP, corpo do erro — só existe DEPOIS da tentativa, então
 * montar o contexto na hora da chamada gravaria sempre `null`.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T | null>,
  ctxFn?: () => LossContext
): Promise<T | null> {
  const first = await fn();
  if (first !== null) return first;
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  const second = await fn();
  if (second === null) await reportLoss(label, ctxFn?.());
  return second;
}

/**
 * Registra uma perda em 3 canais, do mais acessível pro mais técnico:
 *   1. tabela `errors` (`type='brand_logos'`) — dá pra ler com um SELECT,
 *      sem depender de painel externo. Foi o que faltou pra diagnosticar
 *      "não salvou" nas primeiras rodadas;
 *   2. Sentry;
 *   3. console (logs do Cloudflare).
 * Fail-safe em todos: nenhum deles pode derrubar a geração.
 */
async function reportLoss(label: string, ctx?: LossContext): Promise<void> {
  console.warn(`persistBrandLogos: ${label}`, ctx?.extra ?? '');
  try {
    Sentry.captureMessage(`brand_logos: ${label}`, {
      level: 'warning',
      tags: { service: 'brand-logos' },
      extra: ctx?.extra,
    });
  } catch {
    /* Sentry off no edge — os outros canais já registraram. */
  }
  if (!ctx?.supaUrl || !ctx?.serviceKey) return;
  try {
    await fetch(`${ctx.supaUrl}/rest/v1/errors`, {
      method: 'POST',
      headers: {
        apikey: ctx.serviceKey,
        Authorization: `Bearer ${ctx.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        type: 'brand_logos',
        msg: label.slice(0, 500),
        url: '/api/generate-logo',
        user_id: ctx.userId ?? null,
        ctx: ctx.extra ?? null,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* Se nem o insert de erro passa, o console fica como último recurso. */
  }
}

/**
 * Decodifica `data:image/png;base64,...` em bytes. Null se não for data URL
 * OU se o base64 estiver corrompido — `atob` joga em padding inválido, e uma
 * imagem quebrada não pode derrubar a resposta inteira da geração.
 */
function decodeDataUrl(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2].replace(/\s+/g, '');
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime };
  } catch {
    return null;
  }
}

/** Baixa uma URL http(s) (quando a IA devolve link em vez de base64). */
/**
 * Baixa uma URL http(s) (quando a IA devolve link em vez de base64).
 *
 * Auditoria de webhooks 2026-09-17 (achado L2): `src` vem da RESPOSTA da
 * IA (OpenAI), não de input do usuário — mas uma resposta de provider é
 * dado estruturado, não comando confiável (item 90 do checklist da
 * auditoria). Sem checagem, um `fetch` aqui podia ser direcionado pra rede
 * interna/metadado de nuvem se a resposta algum dia trouxer uma URL
 * assim. `isPubliclyRoutableHttpsUrl` bloqueia loopback/RFC1918/
 * link-local/CGNAT antes do fetch — ver `lib/api/ssrf-guard.ts` pro porquê
 * de ser blocklist e não allowlist aqui.
 */
async function fetchBytes(
  src: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!isPubliclyRoutableHttpsUrl(src)) return null;
  try {
    const r = await fetch(src, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const mime = r.headers.get('content-type') || 'image/png';
    if (!mime.startsWith('image/')) return null;
    return { bytes: new Uint8Array(buf), mime };
  } catch {
    return null;
  }
}

function extFor(mime: string): string {
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'png';
}

/**
 * Sobe cada imagem no Storage e grava a linha em `brand_logos`.
 * Devolve as URLs finais na MESMA ordem de entrada — a original quando
 * a persistência daquela imagem falhou.
 */
export async function persistBrandLogos(
  args: PersistBrandLogosArgs
): Promise<string[]> {
  const { userId, images, promptName, promptStyle } = args;
  if (images.length === 0) return images;
  if (!userId) {
    // Não deveria acontecer (o gate de auth roda antes), mas se acontecer a
    // arte some sem deixar rastro — daí o alerta em vez de return mudo.
    await reportLoss('sem userId — geração não arquivada', {
      extra: { images: images.length },
    });
    return images;
  }

  const serviceKey = getServiceKey();
  if (!serviceKey) {
    await reportLoss('service role ausente — nenhum logo arquivado');
    return images;
  }
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    await reportLoss('SUPABASE_URL ausente — nenhum logo arquivado');
    return images;
  }

  const rows: Array<Record<string, unknown>> = [];
  // TODAS as imagens da geração são arquivadas, independente do que o pintor
  // fizer depois — ele não precisa escolher, salvar nem pedir camiseta. É o
  // acervo da loja.
  const finalUrls = await Promise.all(
    images.map(async (src, i) => {
      const decoded = decodeDataUrl(src) ?? (await fetchBytes(src));
      if (!decoded) {
        await reportLoss('imagem da IA ilegível (nem data URL nem download)', {
          supaUrl,
          serviceKey,
          userId,
          extra: { index: i, prefix: src.slice(0, 40) },
        });
        return src;
      }

      const path = `${userId}/logos/${crypto.randomUUID()}.${extFor(decoded.mime)}`;
      // Preenchidos dentro da tentativa pra o relatório dizer o motivo real
      // (status do storage, corpo do erro) em vez de só "não deu".
      let status: number | null = null;
      let detail: string | null = null;

      const uploaded = await withRetry(
        `upload no storage falhou (imagem ${i + 1})`,
        async () => {
          try {
            const up = await fetch(
              `${supaUrl}/storage/v1/object/${BUCKET}/${path}`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${serviceKey}`,
                  'Content-Type': decoded.mime,
                  'x-upsert': 'true',
                  'Cache-Control': 'public, max-age=31536000',
                },
                body: decoded.bytes.buffer as ArrayBuffer,
              }
            );
            if (up.ok) return true;
            status = up.status;
            detail = (await up.text()).slice(0, 200);
            return null;
          } catch (e) {
            detail = e instanceof Error ? e.message : String(e);
            return null;
          }
        },
        () => ({
          supaUrl,
          serviceKey,
          userId,
          extra: { path, bytes: decoded.bytes.length, status, detail },
        })
      );
      if (!uploaded) return src;

      const publicUrl = `${supaUrl}/storage/v1/object/public/${BUCKET}/${path}`;
      rows.push({
        user_id: userId,
        image_url: publicUrl,
        storage_path: path,
        source: 'ai',
        prompt_name: promptName || null,
        prompt_style: promptStyle || null,
      });
      return publicUrl;
    })
  );

  if (rows.length > 0) {
    // O arquivo já está no bucket; sem a linha aqui ele fica invisível pro
    // /portal. Por isso o insert também tem 2ª chance.
    let status: number | null = null;
    let detail: string | null = null;
    await withRetry(
      'insert em brand_logos falhou',
      async () => {
        try {
          const ins = await fetch(`${supaUrl}/rest/v1/brand_logos`, {
            method: 'POST',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              // `merge-duplicates` porque o índice único (user_id,
              // md5(image_url)) pode bater no retry; duplicar não ajuda.
              Prefer: 'return=minimal,resolution=merge-duplicates',
            },
            body: JSON.stringify(rows),
          });
          if (ins.ok) return true;
          status = ins.status;
          detail = (await ins.text()).slice(0, 200);
          return null;
        } catch (e) {
          detail = e instanceof Error ? e.message : String(e);
          return null;
        }
      },
      () => ({
        supaUrl,
        serviceKey,
        userId,
        extra: { rows: rows.length, status, detail },
      })
    );
  }

  return finalUrls;
}
