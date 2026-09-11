// __tests__/lib/secret-hygiene.test.ts — guardas de arquitetura da auditoria
// de segredos (2026-09-11). Cada teste aqui trava um caminho pelo qual um
// segredo de servidor chegaria ao navegador, ao APK/IPA, a um log ou ao repo.
//
// Regra geral (a mesma do CLAUDE.md): regra que ninguém verifica é sugestão.
// Por isso são testes, não comentários.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p);

/** Arquivos que rodam no NAVEGADOR (ou são importáveis por quem roda). */
function clientFiles(): string[] {
  const all = [
    ...walk(join(ROOT, 'app')),
    ...walk(join(ROOT, 'components')),
    ...walk(join(ROOT, 'lib')),
    ...walk(join(ROOT, 'public')),
  ];
  return all.filter((p) => {
    const r = rel(p);
    if (r.startsWith('app/api/')) return false;
    if (r.startsWith('lib/api/')) return false;
    // Route handler fora de /api (ex.: app/pdf/[id]/route.ts) também é servidor.
    if (/(^|\/)route\.ts$/.test(r)) return false;
    // Guards RSC e helpers de servidor explicitamente server-only.
    if (r === 'lib/auth-server.ts') return false;
    if (r.startsWith('public/portal/') && /\.min\.js$/.test(r)) return false;
    if (r === 'public/supabase.js' || r === 'public/portal/xlsx.full.min.js') return false;
    return true;
  });
}

// Nomes de env que são SEGREDO de servidor. Qualquer um deles aparecendo em
// código de cliente é, no mínimo, um leitor de `process.env` que o Next vai
// inlinar como `undefined` — e, no pior caso, o segredo no bundle.
const SERVER_SECRET_ENVS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE',
  'SUPABASE_SERVICE_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_SECRET',
  'DUALHOOK_API_KEY',
  'WHATSAPP_ACCESS_TOKEN',
  'META_APP_SECRET',
  'WHATSAPP_WEBHOOK_URL_SECRET',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'EVOLUTION_API_KEY',
  'EVOLUTION_WEBHOOK_TOKEN',
  'VAPID_PRIVATE_KEY',
  'PUSH_INTERNAL_SECRET',
  'FCM_PRIVATE_KEY',
  'FCM_CLIENT_EMAIL',
  'SENTRY_AUTH_TOKEN',
  'ADMIN_EMAILS',
];

// As ÚNICAS variáveis públicas permitidas no bundle. Cada uma foi analisada:
// URL/anon key do Supabase (segurança é a RLS), DSN do Sentry (público por
// design), chave PÚBLICA do VAPID, marcadores de build. Nome novo aqui = nova
// análise de "isso pode ir pro APK?".
const PUBLIC_ENV_ALLOWLIST = new Set([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'NEXT_PUBLIC_APP_VERSION',
  'NEXT_PUBLIC_BUILD',
]);

describe('segredos de servidor nunca chegam ao código de cliente', () => {
  it('nenhum arquivo de cliente menciona nome de env secreta', () => {
    const ofensores: string[] = [];
    for (const p of clientFiles()) {
      const src = readFileSync(p, 'utf8');
      for (const name of SERVER_SECRET_ENVS) {
        // O portal admin mostra o NOME `SUPABASE_SERVICE_ROLE_KEY` num alert
        // pedindo pra configurar o painel — texto, não leitura. Só reclama de
        // leitura real (`process.env.X` / `getRuntimeEnv('X')`).
        const leitura = new RegExp(`process\\.env\\.${name}\\b|getRuntimeEnv\\(['"]${name}['"]\\)`);
        if (leitura.test(src)) ofensores.push(`${rel(p)} lê ${name}`);
      }
    }
    expect(ofensores).toEqual([]);
  });

  it('todo NEXT_PUBLIC_* referenciado está na allowlist analisada', () => {
    const vistos = new Set<string>();
    for (const p of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'lib'))]) {
      // Só código: comentário pode citar `NEXT_PUBLIC_X` como exemplo.
      const src = readFileSync(p, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      for (const m of src.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) vistos.add(m[0]);
    }
    // `NEXT_PUBLIC_` seco aparece em comentário/regex de teste; não é variável.
    const desconhecidos = [...vistos].filter((v) => v !== 'NEXT_PUBLIC_' && !PUBLIC_ENV_ALLOWLIST.has(v));
    expect(desconhecidos).toEqual([]);
  });

  it('código de cliente não importa lib/api (camada de servidor)', () => {
    const ofensores: string[] = [];
    for (const p of clientFiles()) {
      const r = rel(p);
      if (!/\.(ts|tsx)$/.test(r)) continue;
      const src = readFileSync(p, 'utf8');
      if (/from\s+['"]@\/lib\/api\//.test(src)) ofensores.push(r);
    }
    expect(ofensores).toEqual([]);
  });
});

describe('segredo nunca viaja em query string de fetch de saída', () => {
  it('nenhuma chamada ao Gemini usa `?key=` (vai pro header x-goog-api-key)', () => {
    const ofensores: string[] = [];
    for (const p of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))]) {
      const src = readFileSync(p, 'utf8');
      // Só código, não comentário: procura o padrão dentro de template/string
      // de URL, que é como a chave chegava à URL.
      const linhas = src.split('\n');
      linhas.forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        if (/googleapis\.com[^'"`]*[?&]key=/.test(l) || /[?&]key=\$\{/.test(l)) {
          ofensores.push(`${rel(p)}:${i + 1}`);
        }
      });
    }
    expect(ofensores).toEqual([]);
  });

  it('toda chamada ao Gemini manda a chave no header', () => {
    const arquivos = [...walk(join(ROOT, 'lib'))].filter((p) =>
      /generativelanguage\.googleapis\.com/.test(readFileSync(p, 'utf8')),
    );
    expect(arquivos.length).toBeGreaterThan(0);
    for (const p of arquivos) {
      expect(readFileSync(p, 'utf8'), rel(p)).toMatch(/x-goog-api-key/);
    }
  });
});

describe('.env.example só tem nomes', () => {
  it('nenhuma linha carrega valor', () => {
    const linhas = readFileSync(join(ROOT, '.env.example'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'));
    expect(linhas.length).toBeGreaterThan(10);
    const comValor = linhas.filter((l) => !/^[A-Z0-9_]+=$/.test(l.trim()));
    expect(comValor).toEqual([]);
  });
});

describe('.gitignore cobre toda variação de .env', () => {
  it('raiz e next-app ignoram .env.* e liberam só o .env.example', () => {
    for (const f of [join(ROOT, '.gitignore'), join(ROOT, '..', '.gitignore')]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/^\.env\.\*$/m);
      expect(src, f).toMatch(/^!\.env\.example$/m);
    }
  });
});
