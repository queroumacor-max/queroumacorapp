// Smoke test do preview do Worker (temporário — PR #480). Abre telas
// rodada 2: next 16.4.2 + adapter 1.20.13 + zod 4
// públicas num Chromium real e confere: sai do loading, hidrata, sem
// violação de CSP, e /feed deslogado manda pro /login (prova que o JS
// do AuthProvider rodou).
import { chromium } from 'playwright';
const BASE = process.env.PREVIEW_URL || 'https://queroumacor-next-preview.queroumacor.workers.dev';
const b = await chromium.launch();
let falhou = false;
for (const [path, esperado] of [['/', '/login'], ['/login', '/login'], ['/signup', '/signup'], ['/feed', '/login'], ['/info/sobre', '/info/sobre']]) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' });
  const erros = [];
  p.on('console', m => { if (m.type() === 'error') erros.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => erros.push('PAGEERROR ' + e.message.slice(0, 200)));
  let status = 0;
  try {
    const r = await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    status = r?.status() ?? 0;
  } catch (e) { erros.push('GOTO ' + e.message.slice(0, 200)); }
  await p.waitForTimeout(4000);
  const url = new URL(p.url()).pathname;
  const texto = (await p.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
  const next = await p.evaluate(() => typeof window.next !== 'undefined').catch(() => false);
  const csp = erros.filter(e => /Content Security Policy|Refused to/i.test(e));
  const preso = /Reconectando|Carregando|Server Error|Algo deu errado/i.test(texto) && texto.length < 200;
  const ok = status > 0 && status < 400 && next && !csp.length && !preso && url.startsWith(esperado);
  if (!ok) falhou = true;
  console.log(`${ok ? 'OK ' : 'FALHA'} ${path} status=${status} final=${url} hidratou=${next} csp=${csp.length}`);
  console.log(`     texto: ${texto}`);
  for (const e of [...new Set(erros)].slice(0, 6)) console.log(`     erro: ${e}`);
  if (path === '/login') await p.screenshot({ path: 'preview-login.png' });
  await p.close();
}
await b.close();
process.exit(falhou ? 1 : 0);
