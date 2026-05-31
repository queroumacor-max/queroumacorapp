// tests/conventions.test.js — unit tests pro lint de convenções.
// Verifica que cada check detecta violações conhecidas em fixtures controladas
// e que NÃO reporta false positives em arquivos reais do projeto.
//
// Estratégia: usa um diretório tmp por teste (mkdtempSync) com arquivos
// fixture, passa o caminho pra cada check, e captura via sink local —
// sem poluir o `results` global do script CLI.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkIIFE,
  checkStrict,
  checkConsoleLog,
  checkTodos,
  checkModuleExport,
  checkCacheBust,
  checkShimCoverage,
} from '../scripts/check-conventions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Captura resultados num array local em vez de no global do script.
function makeSink(){
  const out = [];
  return {
    sink: (check, severity, items) => out.push({ check, severity, count: items.length, items }),
    out,
  };
}

describe('check-conventions — detecta violações em fixtures', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'conv-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('CHECK A — flagga arquivo SEM IIFE', () => {
    const bad = join(tmp, 'no-iife.js');
    // Sem `(function(){ ... })();` envelope — só código solto.
    writeFileSync(bad, "'use strict';\nfunction x(){}\nwindow.Modules.x = { x };\n");
    const { sink, out } = makeSink();
    const violations = checkIIFE([bad], sink);
    expect(violations.length).toBe(1);
    expect(violations[0]).toMatch(/abertura IIFE não encontrada/);
    expect(out[0].severity).toBe('FAIL');
  });

  it('CHECK A — passa com IIFE válido', () => {
    const ok = join(tmp, 'good.js');
    writeFileSync(ok, "(function(){\n  'use strict';\n  window.Modules.foo = { x: 1 };\n})();\n");
    const { sink } = makeSink();
    const violations = checkIIFE([ok], sink);
    expect(violations.length).toBe(0);
  });

  it('CHECK E — detecta console.log em módulo', () => {
    const bad = join(tmp, 'has-log.js');
    writeFileSync(bad,
      "(function(){\n  'use strict';\n  console.log('debug');\n  console.warn('ok');\n})();\n");
    // Passa um appJs inexistente pra que o check NÃO leia o app.js real.
    const { sink, out } = makeSink();
    const violations = checkConsoleLog([bad], sink, join(tmp, 'nope.js'));
    expect(violations.length).toBe(1);
    expect(violations[0]).toMatch(/has-log\.js:3/);
    expect(out[0].severity).toBe('WARN');
  });

  it('CHECK E — ignora console.log em comentário e aceita warn/error', () => {
    const ok = join(tmp, 'no-log.js');
    writeFileSync(ok,
      "(function(){\n  'use strict';\n  // console.log('not real')\n  console.warn('ok');\n  console.error('ok');\n})();\n");
    const { sink } = makeSink();
    const violations = checkConsoleLog([ok], sink, join(tmp, 'nope.js'));
    expect(violations.length).toBe(0);
  });

  it('CHECK F — detecta // TODO sem contexto e aceita TODO com data/issue', () => {
    const f = join(tmp, 'todos.js');
    writeFileSync(f,
      "// TODO: fix this later\n" +              // bad (sem contexto)
      "// TODO #42 rebuild parser\n" +           // ok (ref a issue)
      "// FIXME (2026-06-01) refactor when X lands\n" +  // ok (data)
      "// FIXME bare\n");                        // bad
    const { sink, out } = makeSink();
    // Passa lista de extraTargets explícita pra não pegar arquivos reais.
    const violations = checkTodos([], sink, [f]);
    expect(violations.length).toBe(2);
    expect(violations[0]).toMatch(/todos\.js:1/);
    expect(violations[1]).toMatch(/todos\.js:4/);
    expect(out[0].severity).toBe('WARN');
  });

  it('CHECK C — flagga módulo sem export window.Modules.<name>', () => {
    const bad = join(tmp, 'no-export.js');
    writeFileSync(bad, "(function(){ 'use strict'; var x = 1; })();\n");
    const { sink, out } = makeSink();
    const detected = checkModuleExport([bad], sink);
    expect(detected.length).toBe(0);
    expect(out[0].severity).toBe('FAIL');
    expect(out[0].items[0]).toMatch(/nenhum.*window\.Modules/);
  });

  it('CHECK D — flagga <script src> local sem ?v= e ignora externos', () => {
    const html = join(tmp, 'index.html');
    writeFileSync(html,
      '<html><head>\n' +
      '<script src="/app.js"></script>\n' +              // bad: sem ?v=
      '<script src="/head.js?v=20260531a"></script>\n' + // ok
      '<script src="https://cdn.x.com/lib.js"></script>\n' + // ignored: externo
      '</head></html>\n');
    const { sink, out } = makeSink();
    const violations = checkCacheBust(html, sink);
    expect(violations).toEqual(['/app.js']);
    expect(out[0].severity).toBe('FAIL');
  });
});

// Smoke test contra os arquivos reais do repo pra garantir que o script
// não regrediu (não introduzimos false positives). Espera-se que o projeto
// real tenha 0 FAILs (warns podem existir, e tudo bem).
describe('check-conventions — sem false positives nos arquivos reais do projeto', () => {
  it('roda contra o projeto inteiro sem FAILs', async () => {
    const { sink, out } = makeSink();
    const { readdirSync } = await import('node:fs');
    const moduleFiles = readdirSync(join(ROOT, 'modules'))
      .filter(f => f.endsWith('.js'))
      .map(f => join(ROOT, 'modules', f));

    checkIIFE(moduleFiles, sink);
    checkStrict(moduleFiles, sink);
    const detected = checkModuleExport(moduleFiles, sink);
    checkCacheBust(join(ROOT, 'index.html'), sink);
    checkConsoleLog(moduleFiles, sink);
    // Não roda checkTodos aqui pra não bater em arquivos source com TODOs
    // legados (que migrariam pra warn-mode separado).
    checkShimCoverage(detected, join(ROOT, 'shims.js'), sink);

    const fails = out.filter(r => r.severity === 'FAIL');
    if(fails.length > 0){
      // Imprime detalhe pra debugging se quebrar futuramente.
      // eslint-disable-next-line no-console
      console.error('FAILs encontrados:\n' + fails.map(f =>
        `  ${f.check}: ${f.items.slice(0,3).join('; ')}`).join('\n'));
    }
    expect(fails.length).toBe(0);
  });
});
