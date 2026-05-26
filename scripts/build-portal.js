// Compila portal/app.jsx → portal/app.js usando @babel/standalone.
// Uso: npm run build:portal
// Depois de compilar, atualize o atributo `integrity=` em portal/index.html
// com o hash impresso no console.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'portal/app.jsx');
const DST = path.join(ROOT, 'portal/app.js');

globalThis.self = globalThis;
const { default: Babel } = await import('@babel/standalone');

const jsx = fs.readFileSync(SRC, 'utf8');
const t0 = Date.now();
const out = Babel.transform(jsx, { presets: ['react'] });
fs.writeFileSync(DST, out.code);

const sri = 'sha384-' + createHash('sha384').update(out.code).digest('base64');
console.log(`Compiled ${jsx.length} → ${out.code.length} bytes in ${Date.now() - t0}ms`);
console.log(`Output: ${DST}`);
console.log(`SRI: integrity="${sri}"`);
console.log('→ Atualize portal/index.html (tag <script src="/portal/app.js">) com este SRI.');
