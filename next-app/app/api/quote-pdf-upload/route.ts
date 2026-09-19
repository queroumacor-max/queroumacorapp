// app/api/quote-pdf-upload/route.ts — o PDF do orçamento sobe pelo SERVIDOR.
//
// Por que existe (2026-08-30): o upload direto do app pro bucket `exports`
// falhava SEMPRE em produção — e falhou desde o primeiro dia (era isso que
// empurrava o compartilhar pro fallback de data URL que congelava o app).
// A telemetria `pdf-link-fail` provou as DUAS causas em produção:
//   - "new row violates row-level security policy" no upload direto → o
//     bucket EXISTE, mas o bloco de policies da Wave 41 nunca rodou;
//   - "401 token inválido" no GoTrue → token com ASSINATURA válida cuja
//     sessão o GoTrue não reconhece mais (rotação de refresh; acontece com
//     a mesma conta no app e no Chrome). O resto do app segue funcionando
//     porque PostgREST/Storage validam só a assinatura — stateless.
//
// Por isso a autenticação aqui tem DOIS degraus:
//   1. GoTrue confirmou o usuário → sobe com a SERVICE ROLE (não passa por
//      policy nenhuma; cobre o banco sem as policies da Wave 41). Se o
//      bucket não existir, CRIA (parâmetros da Wave 41) e tenta de novo.
//   2. GoTrue recusou → sobe com o TOKEN DO PRÓPRIO USUÁRIO: quem valida
//      passa a ser o Storage (assinatura + policy amarrando o path ao
//      auth.uid()). Ninguém forja identidade — o `sub` do JWT só decide o
//      prefixo do path, e a RLS confere que ele bate com o dono do token.
//      (Este degrau exige as policies no banco; com elas rodadas, cobre o
//      token session-stale que o degrau 1 rejeita.)
//
// Não é anônima: endpoint de upload sem login vira hospedagem grátis de
// arquivo. Path sempre com uuid → nunca sobrescreve nada (sem x-upsert).

import type { NextRequest } from 'next/server';
import {
  ServiceError,
  checkRateLimit,
  getServiceKey,
  getToken,
  jsonResponse,
  rateLimitResponse,
  requireAuth,
  resolveSupabaseEnv,
  serviceErrorResponse,
} from '@/lib/api/security';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

const BUCKET = 'exports';
const MAX_PDF_BYTES = 8 * 1024 * 1024; // bucket aceita 10MB; folga de cabeçalho
const UPLOAD_TIMEOUT_MS = 20_000;

export async function POST(request: NextRequest) {
  try {
    const token = getToken(request);
    if (!token) throw new ServiceError('login obrigatório', 401);

    // Degrau 1 de identidade: GoTrue (fail-open — user null se recusar).
    const auth = await requireAuth(request);
    // `sub` do JWT: NÃO é prova de identidade (payload é legível por
    // qualquer um) — serve só pro prefixo do path e pro rate limit. A
    // prova, quando o GoTrue recusa, é o Storage aceitar o token no
    // degrau 2, onde a policy compara o path com auth.uid().
    const sub = auth.user?.id || decodeJwtSub(token);
    if (!sub) throw new ServiceError('token ilegível', 401);

    // A chave PRECISA ser um uuid puro: check_rate_limit declara
    // `p_user_id uuid`, e chave decorada ('quote-pdf:<uuid>') faz o cast
    // falhar → o helper abre em silêncio e a rota fica sem proteção
    // (achado da revisão de 2026-08-30). O escopo por rota já vem do
    // campo `endpoint`.
    const rl = await checkRateLimit({
      userId: sub,
      endpoint: 'quote-pdf-upload',
      limit: 20,
    });
    if (!rl.allowed) return rateLimitResponse(rl);

    // Par ÚNICO — a anon key e a URL têm que ser do mesmo projeto, senão o
    // Storage recusa o degrau 2 (upload com o token do próprio usuário).
    const { url: supabaseUrl, anonKey } = resolveSupabaseEnv();
    const serviceKey = getServiceKey();

    // Corpo = o PDF cru. Teto ANTES de ler quando o header existir; o
    // byteLength confere de verdade depois (Content-Length é opcional).
    const declared = Number(request.headers.get('content-length') || '0');
    if (declared > MAX_PDF_BYTES) {
      throw new ServiceError('PDF grande demais (máx 8MB)', 413);
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new ServiceError('PDF grande demais (máx 8MB)', 413);
    }
    if (bytes.byteLength < 5) throw new ServiceError('corpo vazio', 400);
    // Só PDF de verdade: os 5 primeiros bytes são "%PDF-". Barra qualquer
    // outra coisa que tentem depositar aqui.
    const head = new Uint8Array(bytes.slice(0, 5));
    if (String.fromCharCode(...head) !== '%PDF-') {
      throw new ServiceError('o arquivo não é um PDF', 415);
    }

    // Nome vem do app (x-filename) mas ninguém confia em nome de arquivo:
    // só [a-z0-9._-], sempre terminando em .pdf, com teto de tamanho.
    const cru = request.headers.get('x-filename') || 'orcamento.pdf';
    const filename =
      (cru.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) ||
        'orcamento').replace(/(\.pdf)?$/, '') + '.pdf';

    // Dois formatos de path, um por degrau:
    //  - degrau 1 (service role): `l/<id curto>.pdf` — vira o link
    //    `queroumacor.com.br/pdf/<id>` (rota /pdf/[id] redireciona). O
    //    endereço gigante do Supabase no WhatsApp era queixa do usuário.
    //  - degrau 2 (token do usuário): PRECISA começar no uid, porque é a
    //    policy que valida; o link sai comprido, mas esse degrau é raro.
    const idCurto = Array.from(crypto.getRandomValues(new Uint8Array(9)))
      .map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36])
      .join('');
    const pathCurto = `l/${idCurto}.pdf`;
    const pathUid = `${sub}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${filename}`;

    const upload = (alvo: string, bearer: string, key: string) =>
      fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${alvo}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/pdf',
        },
        body: bytes,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });

    let res: Response;
    let comoFalhou = '';
    let linkCurto = false;

    if (auth.user && serviceKey) {
      // Degrau 1: identidade confirmada → service role, imune a policy.
      res = await upload(pathCurto, serviceKey, serviceKey);
      linkCurto = res.ok;
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        comoFalhou = `service ${res.status}: ${errText.slice(0, 200)}`;
        // Bucket nunca criado: cria com os parâmetros da Wave 41 e tenta
        // de novo UMA vez. Bucket público serve leitura sem policy.
        if (/bucket.*not.*found/i.test(errText) || res.status === 404) {
          const criar = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
            method: 'POST',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: BUCKET,
              name: BUCKET,
              public: true,
              file_size_limit: 10485760,
              allowed_mime_types: ['application/pdf'],
            }),
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          });
          // 409 = alguém criou no meio tempo — ótimo, segue pro retry.
          if (criar.ok || criar.status === 409) {
            res = await upload(pathCurto, serviceKey, serviceKey);
            linkCurto = res.ok;
          }
        }
      }
    } else {
      // Degrau 2: GoTrue recusou (sessão rotacionada) → o token do usuário
      // vai direto pro Storage, que valida a assinatura e amarra o path ao
      // auth.uid() via policy.
      res = await upload(pathUid, token, anonKey);
      if (!res.ok) comoFalhou = `user-token ${res.status}`;
      // Identidade PROVADA pelo Storage (a policy aceitou o token no path
      // do próprio uid) → agora pode ganhar o link curto também: a service
      // role regrava os mesmos bytes no path curto. Era o ÚNICO caso que
      // ainda saía com o endereço gigante do Supabase no WhatsApp
      // (2026-08-30, captura do usuário) — o aparelho dele vive nesse
      // degrau. Best-effort: falhou, vai o link longo, que funciona.
      if (res.ok && serviceKey) {
        try {
          const copia = await upload(pathCurto, serviceKey, serviceKey);
          linkCurto = copia.ok;
        } catch {
          /* fica o link longo */
        }
      }
    }

    if (!res.ok) {
      const finalText = await res.text().catch(() => '');
      console.warn('[quote-pdf-upload] storage recusou:', comoFalhou, finalText.slice(0, 200));
      throw new ServiceError('não consegui guardar o PDF', 502);
    }

    // Link curto no NOSSO domínio sempre que o path curto existir; senão o
    // público do Storage. `new URL(request.url).origin` acompanha o domínio
    // que atendeu (produção ou preview .pages.dev).
    const url = linkCurto
      ? `${new URL(request.url).origin}/pdf/${idCurto}`
      : `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${pathUid}`;
    return jsonResponse({ ok: true, url });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.error('quote-pdf-upload:', e);
    return jsonResponse({ error: 'internal' }, 500);
  }
}

/** `sub` do payload do JWT, sem verificar assinatura (quem verifica é o
 *  Storage no degrau 2). Base64url → JSON → sub. Null se ilegível. */
function decodeJwtSub(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    // Formato de uuid OBRIGATÓRIO: o sub vira prefixo de path e chave do
    // rate limit — um sub forjado com '/' ou lixo não passa daqui.
    return typeof sub === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sub)
      ? sub
      : null;
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
