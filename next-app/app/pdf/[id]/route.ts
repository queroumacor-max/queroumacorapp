// GET /pdf/<id> — o link CURTO do orçamento, no NOSSO domínio.
//
// Três modos:
//   /pdf/<id>            → PÁGINA visualizadora (HTML + pdf.js)
//   /pdf/<id>?raw=1      → o PDF cru, inline (é o que a página desenha)
//   /pdf/<id>?download=x → o PDF como download (attachment)
//
// Por que uma PÁGINA e não o PDF direto (2026-08-30): o link é do nosso
// domínio, então o Android abre ele DENTRO do app instalado — e a WebView
// do wrapper não renderiza PDF: ficava presa no splash "Loading" pra
// sempre (visto em produção). HTML ela renderiza; o pdf.js desenha o
// documento na tela em qualquer lugar — app, Chrome, iPhone — e o botão
// Baixar continua ali. Bônus: a barra de endereço fica em
// queroumacor.com.br o tempo todo (o proxy de bytes serve daqui; nada de
// endereço do Supabase aparecendo — o usuário lia aquilo como "vazou a
// key"; não é key, é path público, mas percepção conta).
//
// Sem banco e sem login: o arquivo é público por design (o link vai pro
// cliente por WhatsApp). O id é estrito — isto NÃO é proxy genérico pro
// bucket. Cache imutável nos bytes: id aleatório, nunca sobrescrito.

import type { NextRequest } from 'next/server';
import { gerarNonce } from '@/lib/csp';
import { getSupabaseUrl } from '@/lib/api/security';

export const runtime = 'edge';

// pdf.js do jsdelivr (host que o projeto já usa em CSP; versão PINADA).
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // {8,24} e não {10,24}: o gerador cria 9 caracteres — a 1ª versão
  // exigia 10 e todo link respondia "não encontrado" (2026-08-30).
  if (!/^[a-z0-9]{8,24}$/.test(id)) {
    return new Response('não encontrado', { status: 404 });
  }

  const q = request.nextUrl.searchParams;
  const querBytes = q.get('raw') !== null || q.get('download') !== null;

  if (!querBytes) return paginaVisualizadora();

  let base: string;
  try {
    base = getSupabaseUrl().replace(/\/$/, '');
  } catch {
    return new Response('indisponível', { status: 503 });
  }
  const upstream = await fetch(
    `${base}/storage/v1/object/public/exports/l/${id}.pdf`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!upstream.ok) return new Response('não encontrado', { status: 404 });

  const download = q.get('download');
  const nome = (download || 'orcamento.pdf')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80) || 'orcamento.pdf';
  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${download !== null ? 'attachment' : 'inline'}; filename="${nome}"`,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  return new Response(upstream.body, { status: 200, headers });
}

function paginaVisualizadora(): Response {
  // Nada dinâmico entra no HTML (o id vem de location.pathname no client),
  // então não há o que escapar. CSP própria e mínima — o middleware NÃO
  // sobrescreve a desta rota (`cspParaPath` devolve null em /pdf/*).
  // Nonce por resposta (pentest Strix, 2026-09-11): o <script> e o <style>
  // inline carregam o mesmo valor que a CSP, sem 'unsafe-inline'. A resposta
  // é cacheável (1h) e continua íntegra: cache guarda HTML e header juntos.
  const nonce = gerarNonce();
  const html = `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orçamento — QueroUmaCor</title>
<style nonce="${nonce}">
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#f7f3ee;font:400 15px/1.5 system-ui,-apple-system,sans-serif;color:#1a1a2e;min-height:100dvh}
  header{position:sticky;top:0;background:#fff;border-bottom:2px solid #ff6b35;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;z-index:2}
  header b{font-size:15px}
  header small{display:block;color:#888;font-size:11px;font-weight:400}
  .acoes{display:flex;gap:8px}
  .btn{border:0;border-radius:10px;padding:9px 14px;font:700 13px system-ui;cursor:pointer;text-decoration:none;white-space:nowrap}
  .btn-p{background:#ff6b35;color:#fff}
  .btn-s{background:#fff;color:#1a1a2e;border:1px solid #ddd}
  main{max-width:860px;margin:0 auto;padding:14px}
  canvas{display:block;width:100%;height:auto;background:#fff;border-radius:6px;box-shadow:0 2px 10px rgba(26,26,46,.12);margin-bottom:14px}
  #st{text-align:center;color:#666;padding:40px 16px}
  #st a{color:#ff6b35;font-weight:700}
</style></head><body>
<header>
  <div><b>Orçamento</b><small>via QueroUmaCor</small></div>
  <div class="acoes">
    <a class="btn btn-s" href="?raw=1">Abrir</a>
    <a class="btn btn-p" href="?download=orcamento.pdf">⬇️ Baixar</a>
  </div>
</header>
<main>
  <div id="st">Carregando orçamento…</div>
  <div id="paginas"></div>
</main>
<script nonce="${nonce}" src="${PDFJS}"></script>
<script nonce="${nonce}">
(async function(){
  var st = document.getElementById('st');
  function falhou(){
    // Sem pdf.js (CDN fora, WebView antiga): os botões de cima seguem
    // funcionando — a página nunca é um beco sem saída.
    st.innerHTML = 'Não consegui mostrar aqui. <a href="?raw=1">Abrir o PDF</a> ou <a href="?download=orcamento.pdf">baixar</a>.';
  }
  try {
    if (!window.pdfjsLib) return falhou();
    // Worker via blob: o CSP desta página só libera worker blob:.
    try {
      var wsrc = await fetch(${JSON.stringify(PDFJS_WORKER)}).then(function(r){ return r.text(); });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([wsrc], { type: 'text/javascript' }));
    } catch (e) { /* pdf.js cai pro modo sem worker sozinho */ }
    var url = location.pathname + '?raw=1';
    var pdf = await pdfjsLib.getDocument(url).promise;
    var cont = document.getElementById('paginas');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (var n = 1; n <= pdf.numPages; n++) {
      var page = await pdf.getPage(n);
      var vw = page.getViewport({ scale: 1 });
      var escala = (cont.clientWidth / vw.width) * dpr;
      var vp = page.getViewport({ scale: escala });
      var c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      cont.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
    st.remove();
  } catch (e) { falhou(); }
})();
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy':
        `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; ` +
        `style-src 'nonce-${nonce}'; connect-src 'self' https://cdn.jsdelivr.net; ` +
        "img-src 'self' data: blob:; worker-src blob:; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
