#!/usr/bin/env node
// scripts/check-deps.js — análise estática de dependências entre arquivos JS
// do projeto (vanilla, sem ES modules). Heurística baseada em regex; honesto
// sobre limitações (ver DEPENDENCIES.md). Cobre item #16 do audit arquitetural.
//
// Uso:
//   node scripts/check-deps.js          # output Markdown
//   node scripts/check-deps.js --json   # output JSON pra integração futura
//
// LIMITAÇÕES (importantes pra interpretar o output):
//   • Sem ES modules, não temos import graph spec'd. A heurística infere deps
//     a partir de chamadas a namespaces conhecidos (Modules.X, DB.X, Utils.X,
//     Policies.X, Validators.X, Errors.X, Schemas.X, Events.X).
//   • Bare globals (e.g. `toast`, `loadFeed`, `getSupabase`) são IGNORADOS
//     como deps de arquivo-pra-arquivo. Em vanilla JS+IIFE, o ciclo só
//     importa se a chamada acontece DURANTE o registro do módulo (top-level
//     do IIFE) — quase nunca o caso. Chamadas dentro de função body são
//     resolvidas no runtime, depois que tudo carregou; não criam ciclo de
//     load order.
//   • Ciclos reportados são SCCs (Tarjan) — cada SCC com >1 nó é um ciclo
//     genuíno na heurística. Pra ciclos de runtime aceitos pelo design,
//     ver DEPENDENCIES.md.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AS_JSON = process.argv.includes('--json');

// ── 1) Coleta arquivos do escopo (raiz + modules/* + schemas/*) ────────────
const ROOT_FILES = ['app.js','head.js','shims.js','db.js','utils.js',
  'policies.js','validators.js','errors.js','logger.js','config.js','events.js'];
function listDir(rel){
  const dir = path.join(ROOT, rel);
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.js'))
    .map(f => path.join(rel, f));
}
const FILES = []
  .concat(ROOT_FILES.filter(f => fs.existsSync(path.join(ROOT, f))))
  .concat(listDir('modules'))
  .concat(listDir('schemas'));

// ── 2) Provides: símbolos namespacados declarados pelo arquivo ────────────
// Foco em namespaces — sinal alto, ruído baixo.
const NS_PARENTS = new Set(['Modules','DB','Utils','Policies','Validators',
  'Errors','AppErrors','Logger','Config','Schemas','Events']);

function stripCommentsAndStrings(src){
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function extractProvides(src){
  const provides = new Set();
  let m;
  // window.Modules.foo = ... | window.Modules['foo'] = ...
  const reModReg = /\bwindow\.Modules\.([A-Za-z_$][\w$]*)\s*=/g;
  while((m = reModReg.exec(src))) provides.add('Modules.' + m[1]);
  const reModRegBr = /\bwindow\.Modules\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]\s*=/g;
  while((m = reModRegBr.exec(src))) provides.add('Modules.' + m[1]);
  // window.NS = ... onde NS é namespace conhecido (DB, Utils, Policies, etc.)
  const reWinNs = /\bwindow\.([A-Za-z_$][\w$]*)\s*=/g;
  while((m = reWinNs.exec(src))){
    if(NS_PARENTS.has(m[1])) provides.add(m[1]);
  }
  // window.NS.Y = ... (DB.profiles, Utils.foo etc.) — registra "NS.Y"
  const reWinNsDot = /\bwindow\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=/g;
  while((m = reWinNsDot.exec(src))){
    if(NS_PARENTS.has(m[1])) provides.add(m[1] + '.' + m[2]);
  }
  return provides;
}

function extractUses(src){
  const uses = new Set();
  let m;
  // NS.Y onde NS é namespace conhecido. Pra Modules.X, registra só Modules.X
  // (assim casamos com o "provides" do arquivo dono). Pra outros NS, registra
  // tanto NS.Y quanto NS (alguns arquivos só fazem `window.DB` sem .Y).
  const reNs = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
  while((m = reNs.exec(src))){
    if(!NS_PARENTS.has(m[1])) continue;
    uses.add(m[1] + '.' + m[2]);
    if(m[1] !== 'Modules') uses.add(m[1]);  // NS bare (excl. Modules pra evitar SCC)
  }
  // window.NS — pega refs do tipo `const U = window.Utils;`
  const reWinNs = /\bwindow\.([A-Za-z_$][\w$]*)/g;
  while((m = reWinNs.exec(src))){
    if(NS_PARENTS.has(m[1]) && m[1] !== 'Modules') uses.add(m[1]);
  }
  return uses;
}

// ── 3) Lê arquivos, monta provides/uses ───────────────────────────────────
const fileInfo = {}; // path → { provides, uses }
for(const rel of FILES){
  const abs = path.join(ROOT, rel);
  const raw = fs.readFileSync(abs, 'utf8');
  const src = stripCommentsAndStrings(raw);
  fileInfo[rel] = {
    provides: extractProvides(src),
    uses: extractUses(src),
  };
}

// Mapa inverso: provider symbol → file(s) que o declaram
const symbolToFile = new Map();
for(const rel of FILES){
  for(const sym of fileInfo[rel].provides){
    if(!symbolToFile.has(sym)) symbolToFile.set(sym, new Set());
    symbolToFile.get(sym).add(rel);
  }
}

// ── 4) Constrói grafo: file → Set(files it depends on) ────────────────────
const deps = {}; // rel → Set(rel)
for(const rel of FILES){ deps[rel] = new Set(); }
for(const rel of FILES){
  const selfProvides = fileInfo[rel].provides;
  for(const sym of fileInfo[rel].uses){
    // Se o arquivo também declara esse símbolo, é self-init (e.g.
    // `window.Schemas = window.Schemas || {}`) — não é dep externa.
    if(selfProvides.has(sym)) continue;
    const owners = symbolToFile.get(sym);
    if(!owners) continue;
    for(const owner of owners){
      if(owner !== rel) deps[rel].add(owner);
    }
  }
}

// ── 5) Tarjan SCC pra detectar ciclos reais ───────────────────────────────
let index = 0;
const stack = [];
const onStack = new Set();
const ids = {};   // node → discovery index
const low = {};   // node → low-link
const sccs = [];

function tarjan(v){
  ids[v] = index; low[v] = index; index++;
  stack.push(v); onStack.add(v);
  for(const w of deps[v]){
    if(ids[w] === undefined){
      tarjan(w);
      low[v] = Math.min(low[v], low[w]);
    } else if(onStack.has(w)){
      low[v] = Math.min(low[v], ids[w]);
    }
  }
  if(low[v] === ids[v]){
    const comp = [];
    let w;
    do { w = stack.pop(); onStack.delete(w); comp.push(w); } while(w !== v);
    sccs.push(comp);
  }
}
for(const rel of FILES){ if(ids[rel] === undefined) tarjan(rel); }

// Filtra SCCs >1 (ciclos verdadeiros) ou self-loops
const cycles = sccs.filter(c => c.length > 1 || (c.length === 1 && deps[c[0]].has(c[0])));

// ── 6) Top-level (sem deps), leaf (ninguém depende), profundidade ─────────
const incoming = {}; for(const rel of FILES) incoming[rel] = 0;
for(const rel of FILES){ for(const d of deps[rel]) incoming[d]++; }
const topLevel = FILES.filter(f => deps[f].size === 0).sort();
const leaves = FILES.filter(f => incoming[f] === 0).sort();

// Profundidade: longest path no DAG quociente (com cap pra ciclos)
function maxDepth(){
  const memo = {};
  function visit(n, seen){
    if(memo[n] !== undefined) return memo[n];
    if(seen.has(n)) return 0;
    seen.add(n);
    let best = 0;
    for(const d of deps[n]){
      const sub = visit(d, seen) + 1;
      if(sub > best) best = sub;
    }
    seen.delete(n);
    memo[n] = best;
    return best;
  }
  let max = 0;
  for(const rel of FILES){
    const d = visit(rel, new Set());
    if(d > max) max = d;
  }
  return max;
}
const depth = maxDepth();
let edgeCount = 0;
for(const rel of FILES) edgeCount += deps[rel].size;

// ── 7) Output ──────────────────────────────────────────────────────────────
if(AS_JSON){
  const out = {
    filesAnalyzed: FILES.length,
    edges: edgeCount,
    cycles: cycles.map(c => c.sort()),
    topLevel,
    leaves,
    maxDepth: depth,
    graph: Object.fromEntries(FILES.map(f => [f, Array.from(deps[f]).sort()])),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  const L = [];
  L.push('# Dependency analysis');
  L.push('');
  L.push('Heurística estática (regex sobre `X.Y` em namespaces conhecidos:');
  L.push('`Modules`, `DB`, `Utils`, `Policies`, `Validators`, `Errors`, `Schemas`,');
  L.push('`Events`, `Logger`, `Config`). Limitações em `DEPENDENCIES.md`.');
  L.push('');
  L.push('## Top-level (no deps from project files)');
  topLevel.length ? topLevel.forEach(f => L.push('- ' + f)) : L.push('- (none)');
  L.push('');
  L.push('## Cycles found (SCCs)');
  if(cycles.length === 0){
    L.push('- None');
  } else {
    cycles.forEach((c, i) => {
      L.push('- Cycle ' + (i+1) + ' (' + c.length + ' files): ' + c.sort().join(', '));
    });
  }
  L.push('');
  L.push('## Leaf nodes (no project file imports them)');
  leaves.length ? leaves.forEach(f => L.push('- ' + f)) : L.push('- (none)');
  L.push('');
  L.push('## Stats');
  L.push('- Files analyzed: ' + FILES.length);
  L.push('- Edges: ' + edgeCount);
  L.push('- Cycles: ' + cycles.length);
  L.push('- Max depth: ' + depth);
  process.stdout.write(L.join('\n') + '\n');
}
