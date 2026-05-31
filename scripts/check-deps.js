#!/usr/bin/env node
// scripts/check-deps.js — análise estática de dependências entre arquivos JS
// do projeto (vanilla, sem ES modules). Heurística baseada em regex sobre
// namespaces conhecidos. Cobre item #16 do audit. Detalhes em DEPENDENCIES.md.
//
// Uso:
//   node scripts/check-deps.js          # Markdown
//   node scripts/check-deps.js --json   # JSON (integração futura)
//
// LIMITAÇÕES (resumo — completo em DEPENDENCIES.md):
//   • Bare globals (toast, loadFeed, getSupabase) IGNORADOS: em vanilla+IIFE,
//     chamadas dentro de function body são resolvidas em runtime, não criam
//     ciclo de load order.
//   • Múltiplos arquivos podem co-prover o mesmo namespace (e.g. Schemas) —
//     gera arestas "extras" no grafo (ver edge case schemas/index.js).
//   • Ciclos = SCCs (Tarjan) com >1 nó ou self-loop.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AS_JSON = process.argv.includes('--json');

// ── 1) Coleta arquivos do escopo ───────────────────────────────────────────
const ROOT_FILES = ['app.js','head.js','shims.js','db.js','utils.js',
  'policies.js','validators.js','errors.js','logger.js','config.js','events.js'];
const listDir = (rel) => {
  const dir = path.join(ROOT, rel);
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(rel, f))
    : [];
};
const FILES = ROOT_FILES.filter(f => fs.existsSync(path.join(ROOT, f)))
  .concat(listDir('modules')).concat(listDir('schemas'));

const NS_PARENTS = new Set(['Modules','DB','Utils','Policies','Validators',
  'Errors','AppErrors','Logger','Config','Schemas','Events']);

// ── 2) Helpers ─────────────────────────────────────────────────────────────
const stripCommentsAndStrings = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/`(?:\\.|[^`\\])*`/g, '``');

function extractProvides(src){
  const p = new Set();
  let m;
  // window.Modules.foo = ... | window.Modules['foo'] = ...
  const reMod = /\bwindow\.Modules\.([A-Za-z_$][\w$]*)\s*=/g;
  while((m = reMod.exec(src))) p.add('Modules.' + m[1]);
  const reModBr = /\bwindow\.Modules\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]\s*=/g;
  while((m = reModBr.exec(src))) p.add('Modules.' + m[1]);
  // window.NS = ...  (DB, Utils, etc.)
  const reNs = /\bwindow\.([A-Za-z_$][\w$]*)\s*=/g;
  while((m = reNs.exec(src))){ if(NS_PARENTS.has(m[1])) p.add(m[1]); }
  // window.NS.Y = ...
  const reNsDot = /\bwindow\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=/g;
  while((m = reNsDot.exec(src))){ if(NS_PARENTS.has(m[1])) p.add(m[1]+'.'+m[2]); }
  return p;
}

function extractUses(src){
  const u = new Set();
  let m;
  // NS.Y (chamadas) — pra Modules registra só Modules.X, pra resto adiciona
  // também o NS bare (alguns arquivos só fazem `window.DB` sem .Y).
  const re1 = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
  while((m = re1.exec(src))){
    if(!NS_PARENTS.has(m[1])) continue;
    u.add(m[1] + '.' + m[2]);
    if(m[1] !== 'Modules') u.add(m[1]);
  }
  // window.NS — pega `const U = window.Utils;`
  const re2 = /\bwindow\.([A-Za-z_$][\w$]*)/g;
  while((m = re2.exec(src))){
    if(NS_PARENTS.has(m[1]) && m[1] !== 'Modules') u.add(m[1]);
  }
  return u;
}

// ── 3) Lê arquivos, monta provides/uses ───────────────────────────────────
const fileInfo = {};
for(const rel of FILES){
  const src = stripCommentsAndStrings(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  fileInfo[rel] = { provides: extractProvides(src), uses: extractUses(src) };
}

// Mapa inverso: provider symbol → file(s)
const symbolToFile = new Map();
for(const rel of FILES){
  for(const sym of fileInfo[rel].provides){
    if(!symbolToFile.has(sym)) symbolToFile.set(sym, new Set());
    symbolToFile.get(sym).add(rel);
  }
}

// ── 4) Constrói grafo ──────────────────────────────────────────────────────
const deps = {};
for(const rel of FILES) deps[rel] = new Set();
for(const rel of FILES){
  const self = fileInfo[rel].provides;
  for(const sym of fileInfo[rel].uses){
    // self-init: `window.Schemas = window.Schemas || {}` não é dep externa
    if(self.has(sym)) continue;
    const owners = symbolToFile.get(sym);
    if(!owners) continue;
    for(const owner of owners){
      if(owner !== rel) deps[rel].add(owner);
    }
  }
}

// ── 5) Tarjan SCC pra detectar ciclos ─────────────────────────────────────
let idx = 0;
const tStack = [], onStack = new Set(), ids = {}, low = {}, sccs = [];
function tarjan(v){
  ids[v] = idx; low[v] = idx; idx++;
  tStack.push(v); onStack.add(v);
  for(const w of deps[v]){
    if(ids[w] === undefined){ tarjan(w); low[v] = Math.min(low[v], low[w]); }
    else if(onStack.has(w)){ low[v] = Math.min(low[v], ids[w]); }
  }
  if(low[v] === ids[v]){
    const comp = []; let w;
    do { w = tStack.pop(); onStack.delete(w); comp.push(w); } while(w !== v);
    sccs.push(comp);
  }
}
for(const rel of FILES){ if(ids[rel] === undefined) tarjan(rel); }
const cycles = sccs.filter(c => c.length > 1 || (c.length === 1 && deps[c[0]].has(c[0])));

// ── 6) Stats ──────────────────────────────────────────────────────────────
const incoming = {};
for(const rel of FILES) incoming[rel] = 0;
for(const rel of FILES) for(const d of deps[rel]) incoming[d]++;
const topLevel = FILES.filter(f => deps[f].size === 0).sort();
const leaves = FILES.filter(f => incoming[f] === 0).sort();

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
  for(const rel of FILES){ const d = visit(rel, new Set()); if(d > max) max = d; }
  return max;
}
const depth = maxDepth();
let edgeCount = 0;
for(const rel of FILES) edgeCount += deps[rel].size;

// ── 7) Output ──────────────────────────────────────────────────────────────
if(AS_JSON){
  process.stdout.write(JSON.stringify({
    filesAnalyzed: FILES.length, edges: edgeCount,
    cycles: cycles.map(c => c.sort()), topLevel, leaves, maxDepth: depth,
    graph: Object.fromEntries(FILES.map(f => [f, Array.from(deps[f]).sort()])),
  }, null, 2) + '\n');
} else {
  const L = ['# Dependency analysis', '',
    'Heurística estática (regex sobre `NS.X` em namespaces conhecidos:',
    '`Modules`, `DB`, `Utils`, `Policies`, `Validators`, `Errors`, `Schemas`,',
    '`Events`, `Logger`, `Config`). Limitações em `DEPENDENCIES.md`.', '',
    '## Top-level (no deps from project files)'];
  topLevel.length ? topLevel.forEach(f => L.push('- ' + f)) : L.push('- (none)');
  L.push('', '## Cycles found (SCCs)');
  if(cycles.length === 0) L.push('- None');
  else cycles.forEach((c, i) => L.push('- Cycle ' + (i+1) + ' (' + c.length + ' files): ' + c.sort().join(', ')));
  L.push('', '## Leaf nodes (no project file imports them)');
  leaves.length ? leaves.forEach(f => L.push('- ' + f)) : L.push('- (none)');
  L.push('', '## Stats',
    '- Files analyzed: ' + FILES.length,
    '- Edges: ' + edgeCount,
    '- Cycles: ' + cycles.length,
    '- Max depth: ' + depth);
  process.stdout.write(L.join('\n') + '\n');
}
