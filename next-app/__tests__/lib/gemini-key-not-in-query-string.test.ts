// Regra de arquitetura (auditoria de segurança Cloudflare, 2026-09-13):
// chamadas à API do Gemini (`generativelanguage.googleapis.com`) nunca
// mandam a API key na QUERY STRING (`?key=...`) — vai sempre no header
// `x-goog-api-key`.
//
// Motivo: a URL de uma requisição é o tipo de dado que mais facilmente
// vaza pra lugares que não deveriam ver segredo — breadcrumb do Sentry
// (que registra a URL de fetch() capturados), log de proxy, Referer de
// uma navegação acidental. Uma varredura achou 8 call sites em 5 arquivos
// usando `?key=${...}` — todos corrigidos pra header nesta auditoria.
//
// Este teste é a trava pra isso não voltar: nenhuma string literal de URL
// do Gemini em `lib/api` pode conter `key=`.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function varrer(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      varrer(caminho, achados);
    } else if (caminho.endsWith('.ts') || caminho.endsWith('.tsx')) {
      achados.push(caminho);
    }
  }
  return achados;
}

describe('regra: chave do Gemini nunca na query string', () => {
  it('nenhuma URL de generativelanguage.googleapis.com tem "key=" em lib/api', () => {
    const arquivos = varrer('lib/api');
    const violacoes: string[] = [];

    for (const arquivo of arquivos) {
      const linhas = readFileSync(arquivo, 'utf8').split('\n');
      linhas.forEach((linha, i) => {
        if (
          linha.includes('generativelanguage.googleapis.com') &&
          /[?&]key=/.test(linha)
        ) {
          violacoes.push(`${arquivo}:${i + 1}`);
        }
      });
    }

    expect(violacoes).toEqual([]);
  });
});
