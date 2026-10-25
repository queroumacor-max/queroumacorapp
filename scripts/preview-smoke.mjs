// Teste de fumaça do Worker de PREVIEW, rodado pelo deploy.yml ANTES de
// publicar produção. Abre as telas públicas num Chromium de celular e
// confere que cada uma sai do loading, hidrata, não tem violação de CSP e
// que /feed deslogado manda pro /login (prova que o JS do AuthProvider
// rodou).
//
// Existe porque a linha 16.4 do Next derrubou o app duas vezes sob o
// OpenNext (16.4.0 e 16.4.2) com CI, tsc, vitest e `next build` todos
// verdes: o defeito só aparece rodando o Worker de verdade. Ver CLAUDE.md,
// entrada "NEXT 16.4.2 QUEBROU O APP DE NOVO".
//
// Não roda contra queroumacor.com.br: o WAF da Cloudflare bloqueia IP de
// datacenter (runner do GitHub) com 403. O *.workers.dev não passa pelo WAF.
import { chromium } from 'playwright';

const BASE = (process.env.PREVIEW_URL || 'https://queroumacor-next-preview.queroumacor.workers.dev').replace(/\/$/, '');

// [rota, prefixo esperado da URL final]
const ROTAS = [
  ['/', '/login'],
  ['/login', '/login'],
  ['/signup', '/signup'],
  ['/feed', '/login'],
  ['/info/sobre', '/info/sobre'],
];

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';

// O deploy acabou de sair: espera o Worker responder antes de julgar.
async function esperarNoAr() {
  for (let i = 0; i < 12; i++) {
    try {
      const r = await fetch(BASE + '/login', { redirect: 'manual' });
      if (r.status > 0 && r.status < 500) return;
    } catch { /* rede ainda subindo */ }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
}

async function testar(b, path, esperado) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, userAgent: UA });
  const erros = [];
  p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => erros.push('PAGEERROR ' + e.message.slice(0, 200)));
  let status = 0;
  try {
    const r = await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    status = r?.status() ?? 0;
  } catch (e) {
    erros.push('GOTO ' + e.message.slice(0, 200));
  }
  await p.waitForTimeout(4000);
  const url = new URL(p.url()).pathname;
  const texto = (await p.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
  const hidratou = await p.evaluate(() => typeof window.next !== 'undefined').catch(() => false);
  const csp = erros.filter((e) => /Content Security Policy|Refused to/i.test(e));
  const preso = /Reconectando|Carregando|Server Error|Algo deu errado/i.test(texto) && texto.length < 200;
  const ok = status > 0 && status < 400 && hidratou && !csp.length && !preso && url.startsWith(esperado);
  if (!ok || path === '/login') await p.screenshot({ path: `smoke${path.replace(/\//g, '_') || '_raiz'}.png` }).catch(() => {});
  await p.close();
  return { ok, status, url, hidratou, csp: csp.length, texto, erros: [...new Set(erros)].slice(0, 6) };
}

await esperarNoAr();
const b = await chromium.launch();
let falhou = false;
for (const [path, esperado] of ROTAS) {
  // Uma 2ª chance por rota: soluço de rede do runner não é quebra do app.
  let r = await testar(b, path, esperado);
  if (!r.ok) r = await testar(b, path, esperado);
  if (!r.ok) falhou = true;
  console.log(`${r.ok ? 'OK   ' : 'FALHA'} ${path} status=${r.status} final=${r.url} hidratou=${r.hidratou} csp=${r.csp}`);
  console.log(`      texto: ${r.texto}`);
  for (const e of r.erros) console.log(`      erro: ${e}`);
}
await b.close();
if (falhou) console.log('::error::O preview não abriu direito — produção NÃO foi publicada.');
process.exit(falhou ? 1 : 0);
