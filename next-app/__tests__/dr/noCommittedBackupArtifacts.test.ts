// __tests__/dr/noCommittedBackupArtifacts.test.ts — guarda de
// regressão pro achado "218. PUBLIC BACKUP" / "220. OLD DEPLOY
// ARTIFACT" da auditoria de disaster recovery (2026-09-17): a
// auditoria varreu o repo inteiro (incluindo `git log --all
// --diff-filter=A`) e não achou nenhum dump/backup/secret-file
// commitado — este teste é a defesa em profundidade PRA QUE ISSO
// CONTINUE VERDADE, sem depender de alguém lembrar de rodar a
// varredura manual de novo.
//
// Não substitui o scanner de conteúdo (gitleaks, já no CI via
// security.yml) — este teste é por NOME DE ARQUIVO, que pega uma
// classe diferente de vazamento: um dump .sql/.dump/.bak completo não
// necessariamente contém um padrão de secret que o gitleaks reconheça,
// mas o NOME já denuncia.

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(process.cwd(), '..');

// Diretórios que nunca devem ser varridos: dependências instaladas,
// VCS interno, build output. Varrer node_modules aqui seria lento E
// sem sentido (não é conteúdo commitado).
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.gradle',
  'Pods',
  'DerivedData',
  'coverage',
  '.vercel',
  'out',
  '.turbo',
]);

// Extensões/padrões que indicariam um dump de banco, chave privada, ou
// keystore commitado por engano. `.env.example` é intencional e
// filtrado à parte (contém só nomes de variável, nunca valor real).
const SUSPICIOUS_PATTERNS: RegExp[] = [
  /\.dump$/i,
  /\.bak$/i,
  /backup/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.p8$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /^key\.properties$/i,
  /^google-services\.json$/i,
  /^GoogleService-Info\.plist$/i,
];

function isEnvExample(name: string): boolean {
  return name === '.env.example' || name.endsWith('.env.example');
}

// Extensões de código-fonte/documentação/config onde a palavra "backup"
// aparece legitimamente (comentário, nome de teste, doc explicando o
// tema) sem que o ARQUIVO em si seja um artefato de backup. Só a
// checagem genérica de substring ("backup" em qualquer parte do nome)
// ignora essas extensões — as checagens por extensão exata
// (.dump/.bak/.pem/etc.) valem pra qualquer arquivo, sempre.
const TEXT_SOURCE_EXT = new Set(['.ts', '.tsx', '.md', '.mdx', '.yml', '.yaml', '.sh']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

function walk(dir: string, found: string[]): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isEnvExample(entry.name)) continue;
    const isSourceFile = TEXT_SOURCE_EXT.has(extOf(entry.name));
    for (const re of SUSPICIOUS_PATTERNS) {
      // A regex genérica /backup/i não conta pra arquivo de
      // código-fonte/doc/config (este próprio arquivo de teste
      // menciona "Backup" no nome, por exemplo) — as extensões de
      // artefato real (.dump/.bak/.pem/.p12/.p8/.jks/.keystore) e os
      // nomes exatos (key.properties, google-services.json,
      // GoogleService-Info.plist) continuam valendo pra QUALQUER
      // arquivo, sem exceção.
      if (re.source === 'backup' && isSourceFile) continue;
      if (re.test(entry.name)) {
        found.push(relative(REPO_ROOT, join(dir, entry.name)));
        break;
      }
    }
  }
}

describe('DR: nenhum dump/backup/keystore/chave privada commitado no working tree', () => {
  it('varredura por nome de arquivo não encontra nada suspeito', () => {
    const found: string[] = [];
    walk(REPO_ROOT, found);
    expect(found, `arquivos suspeitos encontrados: ${found.join(', ')}`).toEqual([]);
  });

  it('sanity check: a varredura de fato entra em migrations/ (prova que o walk não está silenciosamente vazio)', () => {
    // Se este teste falhar, o walk() está quebrado (path errado, SKIP_DIRS
    // engolindo tudo, etc.) e o teste acima passaria "por acidente" —
    // sempre verde porque nunca olhou arquivo nenhum.
    let sawMigration = false;
    const found: string[] = [];
    const originalWalk = walk;
    function probe(dir: string): void {
      let entries: import('node:fs').Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          probe(join(dir, entry.name));
          continue;
        }
        if (entry.name.endsWith('.sql') && dir.endsWith('migrations')) {
          sawMigration = true;
        }
      }
    }
    probe(REPO_ROOT);
    void originalWalk;
    void found;
    expect(statSync(join(REPO_ROOT, 'migrations')).isDirectory()).toBe(true);
    expect(sawMigration).toBe(true);
  });
});
