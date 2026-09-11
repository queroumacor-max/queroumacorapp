// TelaReconectando — a tela de erro do SERVIDOR que se recupera sozinha.
//
// Compartilhada por `pages/500.tsx` e `pages/_error.tsx` porque o Next tem
// DOIS caminhos de erro de servidor e eles não são o mesmo:
//
//   - `pages/500.tsx` cobre a página 500 ESTÁTICA;
//   - `pages/_error.tsx` cobre o erro em TEMPO DE EXECUÇÃO.
//
// Cobrir só o primeiro foi o meu erro em 01/09/2026: o build gerava a
// página nova certinha (dá pra conferir o "Reconectando" dentro de
// `.next/server/pages/500.html`) e mesmo assim o aparelho continuava
// recebendo o "500 | Server Error" cru — porque quem respondia era o
// `_error` padrão do Next, que eu não tinha substituído.
//
// Contexto do bug que isto ataca: com a tela do celular apagada o Android
// mata o processo do RENDERIZADOR da WebView; ao voltar, a WebView recria o
// renderizador e RE-NAVEGA pra URL atual. Se essa navegação pega um soluço
// do edge, vem 500 — e a página interna do Next não tem uma linha de JS
// nosso: nem service worker, nem boundary, nem retry. Uma lápide. Só saía
// reiniciando o app porque nada mais navegava.
//
// CSP (2026-09-11): a política do app não tem mais 'unsafe-inline' em
// script-src, e este inline roda sem nonce (Pages Router, sem `headers()`;
// a 500 é até estática). Ele entra na CSP por HASH — `RETRY_SCRIPT_HASH` em
// `lib/csp.ts`. Mudou UM caractere aqui? `__tests__/csp-nonce.test.ts`
// recalcula o hash e aponta o valor novo; sem atualizar, o auto-retry é
// bloqueado em silêncio.

export const RETRY = `(function () {
  var CHAVE = 'qucAutoRetry';
  var MAX = 6, JANELA = 120000, BASE = 2500, PASSO = 1500;
  var agora = Date.now();
  var st = { n: 0, t: agora };
  try {
    var cru = sessionStorage.getItem(CHAVE);
    var lido = cru ? JSON.parse(cru) : null;
    if (lido && typeof lido.n === 'number' && agora - lido.t <= JANELA) st = lido;
  } catch (e) {}
  var recarregar = function () { location.reload(); };
  if (st.n >= MAX) {
    var aviso = document.getElementById('qm-status');
    if (aviso) {
      aviso.textContent =
        'Não consegui abrir depois de várias tentativas. Toque no botão pra tentar de novo.';
    }
    var titulo = document.getElementById('qm-titulo');
    if (titulo) titulo.textContent = 'QueroUmaCor';
    return;
  }
  st.n += 1;
  try { sessionStorage.setItem(CHAVE, JSON.stringify(st)); } catch (e) {}
  setTimeout(recarregar, BASE + st.n * PASSO);
  window.addEventListener('online', recarregar, { once: true });
})();`;

export function TelaReconectando() {
  return (
    <div
      style={{
        margin: 0,
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fdfbf7',
        color: '#1a1a2e',
        font: '400 15px/1.6 system-ui, -apple-system, sans-serif',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div>
        <div style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">
          📶
        </div>
        <h1 id="qm-titulo" style={{ fontSize: 19, margin: '0 0 8px' }}>
          Reconectando…
        </h1>
        <p id="qm-status" style={{ margin: '0 0 20px', color: '#6b6b7b', maxWidth: 280 }}>
          O app teve uma instabilidade ao voltar. Vou tentar de novo sozinho em
          instantes — não precisa fechar nada.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            border: 0,
            borderRadius: 10,
            background: '#ff6b35',
            color: '#fff',
            font: '700 15px system-ui',
            padding: '12px 26px',
          }}
        >
          Tentar agora
        </button>
      </div>
      {/* Inline de propósito — ver o comentário no topo do arquivo. */}
      <script dangerouslySetInnerHTML={{ __html: RETRY }} />
    </div>
  );
}
