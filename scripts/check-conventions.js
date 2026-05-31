#!/usr/bin/env node
// scripts/check-conventions.js — lint leve pras convenções do projeto.
// Cobre item #18 (nomes/padrões consistentes) do audit. Sem deps novas:
// só `fs`/`path` + regex. Roda em <2s no projeto inteiro.
//
// Uso:
//   node scripts/check-conventions.js           # summary, sempre exit 0
//   node scripts/check-conventions.js --strict  # exit 1 se houver FAIL
//   node scripts/check-conventions.js --json    # output JSON (CI parseável)
//
// Checks:
//   a) IIFE pattern em modules/*.js
//   b) 'use strict' dentro do IIFE de modules/*.js
//      (functions/api/*.js são ES modules → strict implícito; ignorado)
//   c) Exatamente 1 export `window.Modules.<name> = {...}` por module
//   d) index.html: ?v= em todo <script src="/..."> local
//   e) console.log proibido em modules/* e app.js (warn/error/info OK)
//   f) // TODO ou // FIXME sem contexto (#issue ou data YYYY-MM-DD)
//   g) Cobertura de shim: cada window.Modules.X precisa estar em shims.js
//
// Fonte da verdade: CONVENTIONS.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ── flags ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const JSON_OUT = argv.includes('--json');
const NO_COLOR = argv.includes('--no-color') || !process.stdout.isTTY;

// ── ANSI helpers (sem chalk) ────────────────────────────────────────────
const c = (code, s) => NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`;
const green  = s => c('32', s);
const yellow = s => c('33', s);
const red    = s => c('31', s);
const dim    = s => c('2',  s);
const bold   = s => c('1',  s);

// ── fs helpers ──────────────────────────────────────────────────────────
function listFiles(dir, pattern){
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => pattern.test(f))
    .map(f => path.join(dir, f));
}
function read(p){ return fs.readFileSync(p, 'utf8'); }
function rel(p){ return path.relative(ROOT, p); }

// ── coleta de violações ─────────────────────────────────────────────────
// `results` é o array global usado pelo CLI. Os checks aceitam um `sink`
// opcional pra que os testes consigam capturar resultados num array isolado
// (sem poluir o global e sem ordem-dependência).
/** @type {{check:string, severity:'PASS'|'WARN'|'FAIL', count:number, items:string[]}[]} */
const results = [];

function record(check, severity, items){
  results.push({ check, severity, count: items.length, items });
}

// ────────────────────────────────────────────────────────────────────────
// CHECK A — IIFE pattern em modules/*.js
// ────────────────────────────────────────────────────────────────────────
export function checkIIFE(moduleFiles, sink = record){
  const bad = [];
  // Tolerante a whitespace/comentários iniciais. Procura `(function(`
  // nas primeiras ~30 linhas (após header de comentário) e `})();` nas
  // últimas ~10 linhas. Não força o ponto-e-vírgula final exato.
  const IIFE_START = /\(\s*function\s*\(\s*\)\s*\{/;
  const IIFE_END   = /\}\s*\)\s*\(\s*\)\s*;?\s*$/m;
  for(const f of moduleFiles){
    const src = read(f);
    const head = src.split('\n').slice(0, 40).join('\n');
    const tail = src.split('\n').slice(-15).join('\n');
    if(!IIFE_START.test(head)) bad.push(`${rel(f)} — abertura IIFE não encontrada nas primeiras 40 linhas`);
    else if(!IIFE_END.test(tail)) bad.push(`${rel(f)} — fechamento "})();" não encontrado nas últimas 15 linhas`);
  }
  sink('IIFE pattern em modules/*.js', bad.length ? 'FAIL' : 'PASS', bad);
  return bad;
}

// ────────────────────────────────────────────────────────────────────────
// CHECK B — 'use strict' em modules/*.js (dentro do IIFE)
// (functions/api/*.js são ES modules, strict implícito)
// ────────────────────────────────────────────────────────────────────────
export function checkStrict(moduleFiles, sink = record){
  const bad = [];
  for(const f of moduleFiles){
    const src = read(f);
    // Aceita aspas simples ou duplas, opcionalmente com ;.
    if(!/['"]use strict['"]\s*;?/.test(src)) bad.push(rel(f));
  }
  sink("'use strict' em modules/*.js", bad.length ? 'FAIL' : 'PASS', bad);
  return bad;
}

// ────────────────────────────────────────────────────────────────────────
// CHECK C — Module export único `window.Modules.<name> = { ... }`
// Retorna também a lista de exports detectados pra alimentar check G.
// ────────────────────────────────────────────────────────────────────────
export function checkModuleExport(moduleFiles, sink = record){
  const bad = [];
  /** @type {{file:string,name:string}[]} */
  const detected = [];
  const RE = /window\.Modules\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\{/g;
  for(const f of moduleFiles){
    const src = read(f);
    const matches = [...src.matchAll(RE)];
    if(matches.length === 0){
      bad.push(`${rel(f)} — nenhum "window.Modules.<name> = { ... }" encontrado`);
    } else if(matches.length > 1){
      bad.push(`${rel(f)} — ${matches.length} exports (esperado 1): ${matches.map(m=>m[1]).join(', ')}`);
    } else {
      detected.push({ file: rel(f), name: matches[0][1] });
    }
  }
  sink('Module export único window.Modules.<name>', bad.length ? 'FAIL' : 'PASS', bad);
  return detected;
}

// ────────────────────────────────────────────────────────────────────────
// CHECK D — index.html: ?v= em todo <script src="/..."> local
// Ignora URLs externas (http://, https://, //cdn...).
// ────────────────────────────────────────────────────────────────────────
export function checkCacheBust(indexPath = path.join(ROOT, 'index.html'), sink = record){
  if(!fs.existsSync(indexPath)){
    sink('Cache-bust ?v= em index.html', 'WARN', ['index.html não encontrado']);
    return [];
  }
  const src = read(indexPath);
  const tagRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g;
  const bad = [];
  let m;
  while((m = tagRe.exec(src))){
    const url = m[1];
    // Externo? pula.
    if(/^(https?:)?\/\//i.test(url)) continue;
    // Local sem ?v= ? reporta.
    if(!/\?v=/.test(url)) bad.push(url);
  }
  sink('Cache-bust ?v= em <script src> locais do index.html', bad.length ? 'FAIL' : 'PASS', bad);
  return bad;
}

// ────────────────────────────────────────────────────────────────────────
// CHECK E — console.log proibido em modules/* e app.js
// warn/error/info estão OK. console.log em comentário não conta.
// ────────────────────────────────────────────────────────────────────────
export function checkConsoleLog(moduleFiles, sink = record, appJs = path.join(ROOT, 'app.js')){
  const targets = [...moduleFiles, appJs].filter(p => fs.existsSync(p));
  const bad = [];
  for(const f of targets){
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      // Strip comentário de linha simples antes de buscar.
      const code = line.replace(/\/\/.*$/, '');
      if(/\bconsole\s*\.\s*log\s*\(/.test(code)){
        bad.push(`${rel(f)}:${i+1}`);
      }
    });
  }
  sink('console.log em modules/* e app.js', bad.length ? 'WARN' : 'PASS', bad);
  return bad;
}

// ────────────────────────────────────────────────────────────────────────
// CHECK F — // TODO ou // FIXME sem contexto (#1234 ou (YYYY-MM-DD))
// ────────────────────────────────────────────────────────────────────────
export function checkTodos(moduleFiles, sink = record, extraTargets = null){
  const targets = (extraTargets || [
    ...moduleFiles,
    path.join(ROOT, 'app.js'),
    path.join(ROOT, 'head.js'),
    path.join(ROOT, 'utils.js'),
    path.join(ROOT, 'db.js'),
    path.join(ROOT, 'validators.js'),
    path.join(ROOT, 'shims.js'),
    path.join(ROOT, 'errors.js'),
    path.join(ROOT, 'logger.js'),
    path.join(ROOT, 'policies.js'),
    path.join(ROOT, 'config.js'),
  ]).filter(p => fs.existsSync(p));
  // TODO/FIXME em comentário de linha. Contexto válido: #<digits> ou
  // (YYYY-MM-DD) na MESMA linha após o marker.
  const RE = /\/\/\s*(TODO|FIXME)\b([^\n]*)/i;
  const CTX = /(#\d+|\(\d{4}-\d{2}-\d{2}\))/;
  const bad = [];
  for(const f of targets){
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      const m = RE.exec(line);
      if(!m) return;
      if(!CTX.test(m[2])) bad.push(`${rel(f)}:${i+1}  ${line.trim().slice(0, 100)}`);
    });
  }
  sink('// TODO/FIXME sem contexto (#issue ou YYYY-MM-DD)', bad.length ? 'WARN' : 'PASS', bad);
  return bad;
}

// ────────────────────────────────────────────────────────────────────────
// CHECK G — Cobertura de shim: cada Modules.X precisa aparecer em shims.js
// (warn-only: nem todo módulo precisa de shim — alguns são interface livre
// pra outro módulo. Mas a maioria deve ter, então flag é informativo.)
// ────────────────────────────────────────────────────────────────────────
export function checkShimCoverage(detectedExports, shimsPath = path.join(ROOT, 'shims.js'), sink = record){
  if(!fs.existsSync(shimsPath)){
    sink('Cobertura de shim', 'WARN', ['shims.js não encontrado']);
    return [];
  }
  const shims = read(shimsPath);
  // Match tanto `expose('foo', ...)` quanto `M.foo` / `Modules.foo`.
  const bad = [];
  for(const { file, name } of detectedExports){
    const re = new RegExp(
      `(expose\\s*\\(\\s*['"]${name}['"]|M\\s*\\.\\s*${name}\\b|Modules\\s*\\.\\s*${name}\\b)`
    );
    if(!re.test(shims)) bad.push(`${file} — Modules.${name} não aparece em shims.js`);
  }
  sink('Cobertura de shim para window.Modules.*', bad.length ? 'WARN' : 'PASS', bad);
  return bad;
}

// ────────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────────
function main(){
  const moduleFiles = listFiles(path.join(ROOT, 'modules'), /\.js$/);

  checkIIFE(moduleFiles);
  checkStrict(moduleFiles);
  const exports = checkModuleExport(moduleFiles);
  checkCacheBust();
  checkConsoleLog(moduleFiles);
  checkTodos(moduleFiles);
  checkShimCoverage(exports);

  if(JSON_OUT){
    process.stdout.write(JSON.stringify({ results, strict: STRICT }, null, 2) + '\n');
  } else {
    printSummary();
  }

  const hasFail = results.some(r => r.severity === 'FAIL');
  if(STRICT && hasFail) process.exit(1);
  process.exit(0);
}

function printSummary(){
  const tag = sev => {
    if(sev === 'PASS') return green('PASS');
    if(sev === 'WARN') return yellow('WARN');
    return red('FAIL');
  };
  process.stdout.write(bold('\nconvention checks (item #18)\n'));
  process.stdout.write(dim('  see CONVENTIONS.md for rules\n\n'));
  for(const r of results){
    const head = `  ${tag(r.severity)}  ${r.check}  ${dim(`(${r.count})`)}`;
    process.stdout.write(head + '\n');
    if(r.items.length){
      const shown = r.items.slice(0, 10);
      for(const it of shown) process.stdout.write(dim('       · ') + it + '\n');
      if(r.items.length > shown.length){
        process.stdout.write(dim(`       … +${r.items.length - shown.length} more\n`));
      }
    }
  }
  const fails = results.filter(r => r.severity === 'FAIL').length;
  const warns = results.filter(r => r.severity === 'WARN' && r.count > 0).length;
  const passes = results.filter(r => r.severity === 'PASS').length;
  process.stdout.write('\n' + bold('summary: ')
    + green(`${passes} pass`) + ' · '
    + yellow(`${warns} warn`) + ' · '
    + red(`${fails} fail`) + '\n');
  if(STRICT && fails) process.stdout.write(red('  --strict: exiting 1\n'));
  else process.stdout.write(dim('  (run with --strict to fail CI on FAILs)\n'));
}

// CLI guard: só roda main() quando o arquivo foi invocado diretamente pelo
// shell (não quando importado por um teste). process.argv[1] aponta pro
// script executado; comparar com a URL do módulo nos diz se somos o entry.
const _invokedDirect = process.argv[1]
  && path.resolve(process.argv[1]) === __filename;
if(_invokedDirect) main();

export { results as _results };
